// Amazon Ads sync — Slice A + B.
//
// One idempotent function that, on every invocation:
//   1. Refreshes the access_token if expired.
//   2. Lists Ads API profiles if we don't have them yet.
//   3. Polls any pending Amazon reports — downloads + ingests completed ones.
//   4. If no pending reports left, requests a fresh batch (one report per
//      profile per ad product: SP/SB/SD).
//   5. Persists everything back to amazon_connections.
//
// Returns a summary with `pending_count` so the frontend can auto-poll until
// it hits zero.
//
// Auth: caller must provide a valid Supabase user JWT in Authorization.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"
import { gunzip } from "https://deno.land/x/compress@v0.4.5/mod.ts"

const AMAZON_TOKEN_URL = "https://api.amazon.com/auth/o2/token"
const AMAZON_ADS_API = "https://advertising-api.amazon.com"

// Cap how many pending reports we process per invocation to keep wall clock
// comfortably below the 50-second free-tier limit. Each download is a few
// hundred KB to a few MB; 4 is conservative.
const MAX_DOWNLOADS_PER_RUN = 4

// Amazon Ads v3 campaign reports cap the date range at 31 days per report, so
// we request the last 30. (Total sales via SP-API uses a longer window.)
const REPORT_DAYS_BACK = 30

// How often to re-fetch the campaign→portfolio map. Portfolios change rarely
// and the lookup costs several API calls per profile, so we cache the result
// inside synced_data and only refresh it every 12 hours (or when fresh report
// data arrives). This also back-fills already-synced clients on the next run.
const PORTFOLIO_REFRESH_MS = 12 * 60 * 60 * 1000

// Map our short ad-product label to Amazon's enum + report type.
// Sponsored Products + Sponsored Display go through the v3 async reporting API.
// Sponsored Brands is handled SEPARATELY via the v2 reporting API (see the
// SB-v2 pipeline below): the v3 sbCampaigns report silently DROPS legacy
// (non-multi-ad-group) SB campaigns, which undercounts spend AND sales. v2
// returns every SB campaign, so we pull SB from v2 and fold it in.
const AD_PRODUCTS = [
  { label: 'SP' as const, amazon: 'SPONSORED_PRODUCTS', reportTypeId: 'spCampaigns' },
  { label: 'SD' as const, amazon: 'SPONSORED_DISPLAY', reportTypeId: 'sdCampaigns' },
]

// ----- Sponsored Brands via v2 reporting -----
// v2 reports are per-DAY, so we cache each settled day in synced_data.sbV2.byDate
// and only re-request days that are missing or still mutable (recent). This keeps
// the per-sync Amazon report volume bounded.
const SB_V2_METRICS = "campaignId,campaignName,cost,impressions,clicks,attributedSales14d,attributedConversions14d"
const SB_RECENT_MUTABLE_DAYS = 4   // re-fetch the last N days each refresh (attribution still settling)
const SB_REFRESH_MS = 6 * 60 * 60 * 1000  // re-pull recent SB days at most every 6h
const SB_V2_REQUESTS_PER_RUN = 8   // cap new v2 report requests per invocation (throttle-safe)
const SB_WINDOW_DAYS = REPORT_DAYS_BACK

interface PendingReport {
  reportId: string
  profileId: number
  adProduct: 'SP' | 'SB' | 'SD'
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'INGESTED'
  requestedAt: string
  startDate: string
  endDate: string
  error?: string
  batchId?: string  // all reports requested together share one id; a new batch
                    // = a fresh 30-day pull, so we REPLACE rather than accumulate
}

interface ConnectionRow {
  id: string
  app_client_id: string
  app_client_name: string | null
  refresh_token: string
  access_token: string | null
  access_token_expires_at: string | null
  amazon_profile_ids: number[] | null
  pending_reports: PendingReport[]
  synced_data: { campaigns: any[]; daily?: any[]; dailyByMkt?: any[]; profiles?: any[]; portfolioCheckedAt?: string; portfolioDebug?: any } | null
  last_synced_at: string | null
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })

  const authHeader = req.headers.get("Authorization")
  if (!authHeader) return jsonError(401, "Missing Authorization header")

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  const adsClientId = Deno.env.get("AMAZON_ADS_CLIENT_ID")
  const adsClientSecret = Deno.env.get("AMAZON_ADS_CLIENT_SECRET")

  if (!supabaseUrl || !anonKey) return jsonError(500, "Missing Supabase env")
  if (!adsClientId || !adsClientSecret) return jsonError(500, "Missing Amazon env")

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const url = new URL(req.url)
  const targetClientId = url.searchParams.get("client_id")

  let query = supabase.from("amazon_connections").select("*")
  if (targetClientId) query = query.eq("app_client_id", targetClientId)
  const { data: connections, error } = await query
  if (error) return jsonError(500, `Could not load connections: ${error.message}`)
  if (!connections || connections.length === 0) {
    return json({
      synced: 0, pending: 0, results: [],
      message: targetClientId ? `No connection found for client ${targetClientId}` : "No connections.",
    })
  }

  const results: Array<{
    app_client_id: string
    status: "ok" | "error"
    profiles_found?: number
    pending_count?: number
    ingested_reports?: number
    campaigns_after_sync?: number
    error?: string
  }> = []

  for (const conn of connections as ConnectionRow[]) {
    try {
      const result = await syncOne(supabase, conn, adsClientId, adsClientSecret)
      results.push({ app_client_id: conn.app_client_id, status: "ok", ...result })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error("sync failed", conn.app_client_id, msg)
      await supabase.from("amazon_connections").update({ last_sync_error: msg }).eq("id", conn.id)
      results.push({ app_client_id: conn.app_client_id, status: "error", error: msg })
    }
  }

  const totalPending = results.reduce((n, r) => n + (r.pending_count ?? 0), 0)
  return json({
    synced: results.filter(r => r.status === "ok").length,
    pending: totalPending,
    total: results.length,
    results,
  })
})

async function syncOne(
  supabase: SupabaseClient,
  conn: ConnectionRow,
  adsClientId: string,
  adsClientSecret: string,
) {
  // 1. Make sure we have a valid access_token
  const accessToken = await ensureAccessToken(supabase, conn, adsClientId, adsClientSecret)

  // 2. Fetch profile metadata (country + currency) so synced data can be split
  //    by marketplace. Falls back to the cached id list if the call fails.
  let profileMeta: ProfileMeta[] = []
  try {
    profileMeta = await fetchProfileMeta(accessToken, adsClientId)
  } catch (e) {
    console.error("profile meta fetch failed", e instanceof Error ? e.message : String(e))
  }
  let profileIds = profileMeta.length > 0 ? profileMeta.map(p => p.profileId) : (conn.amazon_profile_ids ?? [])
  if (profileIds.length === 0) {
    profileIds = await listProfiles(accessToken, adsClientId)
  }
  const profileMap = new Map(profileMeta.map(p => [p.profileId, p]))

  // 3. Process pending reports: poll status, ingest completed ones
  const pending: PendingReport[] = Array.isArray(conn.pending_reports) ? [...conn.pending_reports] : []
  let downloads = 0
  const ingestedRows: AmazonReportRow[] = []

  // Track which to keep in pending vs remove
  const stillPending: PendingReport[] = []
  for (const p of pending) {
    // PPC-audit reports (search term / targeting / placement) belong to the
    // cron pipeline — preserve them untouched; ingesting them here would
    // pollute the campaign dataset with keyword-level rows.
    if ((p as any).kind === 'audit') {
      stillPending.push(p)
      continue
    }
    if (downloads >= MAX_DOWNLOADS_PER_RUN) {
      stillPending.push(p)
      continue
    }
    if (p.status === 'COMPLETED' || p.status === 'INGESTED') {
      // Already done — should have been removed; treat as ingested.
      continue
    }
    const statusResp = await getReportStatus(p.reportId, p.profileId, accessToken, adsClientId)
    if (statusResp.status === 'COMPLETED' && statusResp.url) {
      try {
        const rows = await downloadReport(statusResp.url)
        // Tag each row with profile + ad product for downstream mapping
        for (const r of rows) {
          ingestedRows.push({ ...r, _profileId: p.profileId, _adProduct: p.adProduct, _batchId: p.batchId })
        }
        downloads++
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error("download failed", p.reportId, msg)
        stillPending.push({ ...p, status: 'FAILED', error: `download: ${msg}` })
      }
    } else if (statusResp.status === 'FAILED') {
      // Drop failed reports — log error
      console.error("report failed", p.reportId, statusResp.failureReason)
    } else {
      // Still in flight
      stillPending.push({ ...p, status: statusResp.status })
    }
  }

  // 4. Merge ingested data with existing synced_data (so unfinished profile
  //    reports from earlier sync waves don't get clobbered).
  let sideDataChangedMkt = false
  const synced: any = conn.synced_data ?? { campaigns: [], daily: [] }
  // SP+SD live in the v3 "base" fields. SB comes from the v2 pipeline and is
  // folded in afterward. Seed base from legacy fields on first run after deploy
  // (strip any old SB so it isn't double-counted once v2 SB lands).
  if (!synced.baseCampaigns) {
    synced.baseCampaigns = (synced.campaigns ?? []).filter((c: any) => c.type !== 'SB')
    synced.baseDaily = synced.daily ?? []
    synced.baseDailyByMkt = synced.dailyByMkt ?? []
  }
  if (ingestedRows.length > 0) {
    const batchId = ingestedRows[0]._batchId as string | undefined
    // A new report batch = a fresh 30-day pull. Clear the previous window's
    // base totals before merging so we REPLACE rather than accumulate. Within a
    // batch (reports trickle in over a few runs), the id matches, so SP/SD
    // across profiles still combine correctly.
    if (batchId && synced.batchId !== batchId) {
      synced.baseCampaigns = []; synced.baseDaily = []; synced.baseDailyByMkt = []
    }
    const merged = mergeReportRows(
      { campaigns: synced.baseCampaigns, daily: synced.baseDaily, dailyByMkt: synced.baseDailyByMkt },
      ingestedRows, profileMap,
    )
    synced.baseCampaigns = merged.campaigns
    synced.baseDaily = merged.daily
    synced.baseDailyByMkt = merged.dailyByMkt
    if (batchId) synced.batchId = batchId
  }

  // ----- Sponsored Brands (v2) pipeline: poll/ingest/request cached day-reports -----
  try {
    synced.sbV2 = await runSbV2Pipeline(synced.sbV2, profileMeta, accessToken, adsClientId)
  } catch (e) {
    console.error("sbV2 pipeline failed", e instanceof Error ? e.message : String(e))
  }
  const sbDownloads = (synced.sbV2?.lastDownloads ?? 0) as number
  // Always keep the profile→marketplace map fresh on the synced blob (cheap,
  // and the frontend marketplace selector reads it).
  if (profileMeta.length > 0) {
    synced.profiles = profileMeta
    sideDataChangedMkt = true
  }

  // Enrich campaigns with portfolio names. The report columns can't carry
  // portfolioId (Amazon rejects it), so we fetch the campaign→portfolio map
  // separately (SP/SB/SD) and back-fill. We run this when fresh data arrives,
  // OR when existing campaigns still lack labels and the cached map is stale —
  // so clients synced before portfolio support get back-filled on the next run
  // without waiting for a whole new report batch. Resilient: a failure just
  // leaves campaigns unenriched.
  let enriched = false
  const lastCheck = synced.portfolioCheckedAt ? new Date(synced.portfolioCheckedAt).getTime() : 0
  const mapIsStale = Date.now() - lastCheck > PORTFOLIO_REFRESH_MS
  const hasCampaigns = (synced.baseCampaigns?.length ?? 0) > 0
  if (hasCampaigns && profileIds.length > 0 && (ingestedRows.length > 0 || mapIsStale)) {
    try {
      const { map: portfolioMap, debug } = await buildPortfolioMap(profileIds, accessToken, adsClientId)
      if (portfolioMap.size > 0) {
        synced.baseCampaigns = synced.baseCampaigns.map((c: any) => {
          const name = c.campaignId ? portfolioMap.get(String(c.campaignId)) : undefined
          return name ? { ...c, portfolio: name } : c
        })
        // Only cache the check time on a SUCCESSFUL map — so an empty/failed
        // lookup keeps retrying on the next sync instead of going quiet for 12h.
        synced.portfolioCheckedAt = new Date().toISOString()
      }
      synced.portfolioDebug = {
        ...debug,
        sampleSyncedCampaignIds: (synced.baseCampaigns ?? []).slice(0, 3).map((c: any) => String(c.campaignId)),
      }
      enriched = true
    } catch (e) {
      console.error("portfolio enrich failed", e instanceof Error ? e.message : String(e))
    }
  }

  // Fold cached SB-v2 data into the SP+SD base → the combined campaigns/daily/
  // dailyByMkt the frontend reads. Rebuilt every sync, so it never double-counts.
  {
    const folded = foldSb(
      { campaigns: synced.baseCampaigns ?? [], daily: synced.baseDaily ?? [], dailyByMkt: synced.baseDailyByMkt ?? [] },
      synced.sbV2?.byDate ?? {},
    )
    synced.campaigns = folded.campaigns
    synced.daily = folded.daily
    synced.dailyByMkt = folded.dailyByMkt
  }

  // 5. If no pending reports left, request a fresh batch. Audit-kind entries
  // (owned by the cron pipeline) are excluded from the counts so a lingering
  // audit report never blocks fresh campaign reports.
  let newPending: PendingReport[] = []
  let requestErrors: string[] = []
  const nonAuditStill = stillPending.filter(p => (p as any).kind !== 'audit')
  const nonAuditPending = pending.filter(p => (p as any).kind !== 'audit')
  if (nonAuditStill.length === 0 && downloads === 0 && nonAuditPending.length === 0) {
    const r = await requestFreshReports(profileIds, accessToken, adsClientId)
    newPending = r.pending
    requestErrors = r.errors
  }

  const finalPending = [...stillPending, ...newPending]
  const allDone = finalPending.filter(p => (p as any).kind !== 'audit').length === 0 && ingestedRows.length > 0

  // Surface report-request failures: if we tried to request reports and got
  // nothing back, store the reasons so they show up in the UI / diagnostics.
  const reqError = (newPending.length === 0 && requestErrors.length > 0)
    ? `Report request failed — ${requestErrors.slice(0, 4).join(' | ')}`
    : null

  // 6. Save back
  const updates: Record<string, unknown> = {
    access_token: accessToken,
    amazon_profile_ids: profileIds,
    pending_reports: finalPending,
    last_synced_at: new Date().toISOString(),
    last_sync_error: reqError,
  }
  // The SB-v2 pipeline + fold run on every invocation, so always persist.
  void enriched; void sideDataChangedMkt
  updates.synced_data = synced
  if (ingestedRows.length > 0 || sbDownloads > 0) {
    updates.synced_data_at = new Date().toISOString()
  }
  await supabase.from("amazon_connections").update(updates).eq("id", conn.id)

  if (reqError) throw new Error(reqError)

  return {
    profiles_found: profileIds.length,
    // Include SB-v2 backfill so the frontend keeps polling until SB is complete.
    pending_count: finalPending.length + (synced.sbV2?.pending?.length ?? 0),
    ingested_reports: downloads,
    campaigns_after_sync: synced.campaigns.length,
    all_done: allDone,
  }
}

// ---------- Token + profiles ----------

async function ensureAccessToken(
  supabase: SupabaseClient,
  conn: ConnectionRow,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const stillValid = conn.access_token && conn.access_token_expires_at &&
    new Date(conn.access_token_expires_at).getTime() - Date.now() > 5 * 60 * 1000
  if (stillValid) return conn.access_token!

  const resp = await fetch(AMAZON_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  const j = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(`Token refresh failed: ${j.error_description ?? j.error ?? resp.status}`)
  const token = j.access_token as string
  const expiresIn = (j.expires_in as number | undefined) ?? 3600
  await supabase
    .from("amazon_connections")
    .update({
      access_token: token,
      access_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    })
    .eq("id", conn.id)
  return token
}

async function listProfiles(accessToken: string, clientId: string): Promise<number[]> {
  const metas = await fetchProfileMeta(accessToken, clientId)
  return metas.map(p => p.profileId)
}

interface ProfileMeta {
  profileId: number
  marketplace: string   // countryCode, e.g. "US" / "CA" / "MX"
  currency: string      // currencyCode, e.g. "USD" / "CAD" / "MXN"
  marketplaceId: string // Amazon marketplace string id
}

// Fetch each Ads profile's country + currency so synced data can be split by
// marketplace (a seller with US/CA/MX profiles must not be summed into one
// mixed-currency number).
async function fetchProfileMeta(accessToken: string, clientId: string): Promise<ProfileMeta[]> {
  const resp = await fetch(`${AMAZON_ADS_API}/v2/profiles`, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": clientId,
      "Accept": "application/json",
    },
  })
  if (!resp.ok) throw new Error(`Profile list failed: ${resp.status}`)
  const profiles = await resp.json() as Array<{
    profileId: number
    countryCode?: string
    currencyCode?: string
    accountInfo?: { marketplaceStringId?: string }
  }>
  return profiles.map(p => ({
    profileId: p.profileId,
    marketplace: p.countryCode ?? "US",
    currency: p.currencyCode ?? "USD",
    marketplaceId: p.accountInfo?.marketplaceStringId ?? "",
  }))
}

// ---------- Portfolio mapping ----------
//
// Reports can't carry portfolioId, so we build a campaignId -> portfolio name
// map from the v2 portfolios endpoint (id -> name) joined with each ad
// product's campaign list (campaignId -> portfolioId). Covers Sponsored
// Products (v3), Sponsored Brands (v4), and Sponsored Display (v3). Resilient —
// every call is isolated so a failure for one profile/product doesn't break the
// others, and an account with no portfolios just yields an empty map.
async function buildPortfolioMap(
  profileIds: number[],
  accessToken: string,
  clientId: string,
): Promise<{ map: Map<string, string>; debug: any }> {
  const campaignToPortfolio = new Map<string, string>()
  const debugProfiles: any[] = []

  for (const profileId of profileIds) {
    const authBase = {
      "Authorization": `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": clientId,
      "Amazon-Advertising-API-Scope": String(profileId),
    }
    const dbg: any = { profileId }

    // 1. portfolioId -> name (shared by all three ad products).
    //    The old GET /v2/portfolios returns 404 "Method Not Found" on current
    //    accounts — portfolios moved to the v3 POST /portfolios/list endpoint.
    const portfolioName = new Map<string, string>()
    try {
      let nextToken: string | undefined = undefined
      let pages = 0
      do {
        const body: Record<string, unknown> = {}
        if (nextToken) body.nextToken = nextToken
        const portResp = await fetch(`${AMAZON_ADS_API}/portfolios/list`, {
          method: "POST",
          headers: {
            ...authBase,
            "Content-Type": "application/vnd.spPortfolio.v3+json",
            "Accept": "application/vnd.spPortfolio.v3+json",
          },
          body: JSON.stringify(body),
        })
        dbg.portfoliosStatus = portResp.status
        if (!portResp.ok) { dbg.portfoliosBody = (await portResp.text()).slice(0, 200); break }
        const data = await portResp.json() as {
          portfolios?: Array<{ portfolioId: number | string; name: string }>
          nextToken?: string
        }
        for (const p of data.portfolios ?? []) portfolioName.set(String(p.portfolioId), p.name)
        nextToken = data.nextToken
        pages++
      } while (nextToken && pages < 6)
    } catch (e) {
      dbg.portfoliosError = e instanceof Error ? e.message : String(e)
    }
    dbg.portfoliosCount = portfolioName.size
    if (portfolioName.size === 0) { debugProfiles.push(dbg); continue }

    let withPid = 0
    let sampleListId: string | undefined
    const record = (campaignId: unknown, portfolioId: unknown) => {
      if (sampleListId === undefined && campaignId != null) sampleListId = String(campaignId)
      const pid = portfolioId != null ? String(portfolioId) : ""
      if (pid) withPid++
      const name = pid ? portfolioName.get(pid) : undefined
      if (name && campaignId != null) campaignToPortfolio.set(String(campaignId), name)
    }

    // 2. Sponsored Products campaigns (v3, paginated POST)
    let spCount = 0
    try {
      let nextToken: string | undefined = undefined
      let pages = 0
      do {
        const body: Record<string, unknown> = {
          maxResults: 500,
          stateFilter: { include: ["ENABLED", "PAUSED", "ARCHIVED"] },
        }
        if (nextToken) body.nextToken = nextToken
        const resp = await fetch(`${AMAZON_ADS_API}/sp/campaigns/list`, {
          method: "POST",
          headers: {
            ...authBase,
            "Content-Type": "application/vnd.spCampaign.v3+json",
            "Accept": "application/vnd.spCampaign.v3+json",
          },
          body: JSON.stringify(body),
        })
        dbg.spStatus = resp.status
        if (!resp.ok) { dbg.spBody = (await resp.text()).slice(0, 200); break }
        const data = await resp.json() as {
          campaigns?: Array<{ campaignId: string | number; portfolioId?: string | number }>
          nextToken?: string
        }
        for (const c of data.campaigns ?? []) { record(c.campaignId, c.portfolioId); spCount++ }
        nextToken = data.nextToken
        pages++
      } while (nextToken && pages < 6)
    } catch (e) {
      dbg.spError = e instanceof Error ? e.message : String(e)
    }
    dbg.spCount = spCount

    // 3. Sponsored Brands campaigns (v4, paginated POST)
    let sbCount = 0
    try {
      let nextToken: string | undefined = undefined
      let pages = 0
      do {
        const body: Record<string, unknown> = { maxResults: 500 }
        if (nextToken) body.nextToken = nextToken
        const resp = await fetch(`${AMAZON_ADS_API}/sb/v4/campaigns/list`, {
          method: "POST",
          headers: {
            ...authBase,
            "Content-Type": "application/vnd.sbcampaignresource.v4+json",
            "Accept": "application/vnd.sbcampaignresource.v4+json",
          },
          body: JSON.stringify(body),
        })
        dbg.sbStatus = resp.status
        if (!resp.ok) { dbg.sbBody = (await resp.text()).slice(0, 200); break }
        const data = await resp.json() as {
          campaigns?: Array<{ campaignId: string | number; portfolioId?: string | number }>
          nextToken?: string
        }
        for (const c of data.campaigns ?? []) { record(c.campaignId, c.portfolioId); sbCount++ }
        nextToken = data.nextToken
        pages++
      } while (nextToken && pages < 6)
    } catch (e) {
      dbg.sbError = e instanceof Error ? e.message : String(e)
    }
    dbg.sbCount = sbCount

    // 4. Sponsored Display campaigns (v3 GET, plain array response)
    let sdCount = 0
    try {
      const resp = await fetch(
        `${AMAZON_ADS_API}/sd/campaigns?stateFilter=enabled,paused,archived&count=500`,
        { headers: { ...authBase, "Accept": "application/json" } },
      )
      dbg.sdStatus = resp.status
      if (resp.ok) {
        const data = await resp.json() as Array<{ campaignId: string | number; portfolioId?: string | number }>
        if (Array.isArray(data)) {
          for (const c of data) { record(c.campaignId, c.portfolioId); sdCount++ }
        }
      } else {
        dbg.sdBody = (await resp.text()).slice(0, 200)
      }
    } catch (e) {
      dbg.sdError = e instanceof Error ? e.message : String(e)
    }
    dbg.sdCount = sdCount
    dbg.campaignsWithPortfolioId = withPid
    dbg.sampleListCampaignId = sampleListId
    debugProfiles.push(dbg)
  }

  return {
    map: campaignToPortfolio,
    debug: { profiles: debugProfiles, mapSize: campaignToPortfolio.size },
  }
}

// ---------- Report request ----------

async function requestFreshReports(
  profileIds: number[],
  accessToken: string,
  clientId: string,
): Promise<{ pending: PendingReport[]; errors: string[] }> {
  const endDate = new Date()
  const startDate = new Date(endDate.getTime() - REPORT_DAYS_BACK * 86_400_000)
  const startIso = isoDate(startDate)
  const endIso = isoDate(endDate)

  const pending: PendingReport[] = []
  const errors: string[] = []
  const batchId = crypto.randomUUID()

  for (const profileId of profileIds) {
    for (const product of AD_PRODUCTS) {
      try {
        const reportId = await createReport(profileId, product, startIso, endIso, accessToken, clientId)
        pending.push({
          reportId,
          profileId,
          adProduct: product.label,
          status: 'PENDING',
          requestedAt: new Date().toISOString(),
          startDate: startIso,
          endDate: endIso,
          batchId,
        })
      } catch (e: unknown) {
        const m = e instanceof Error ? e.message : String(e)
        console.error("report request failed", profileId, product.label, m)
        errors.push(`p${profileId}/${product.label}: ${m}`)
      }
    }
  }
  return { pending, errors }
}

async function createReport(
  profileId: number,
  product: typeof AD_PRODUCTS[number],
  startDate: string,
  endDate: string,
  accessToken: string,
  clientId: string,
): Promise<string> {
  const columns = columnsFor(product.label)
  const body = {
    name: `${product.label} campaigns ${startDate}..${endDate}`,
    startDate,
    endDate,
    configuration: {
      adProduct: product.amazon,
      groupBy: ["campaign"],
      columns,
      reportTypeId: product.reportTypeId,
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  }
  const resp = await fetch(`${AMAZON_ADS_API}/reporting/reports`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": clientId,
      "Amazon-Advertising-API-Scope": String(profileId),
      "Accept": "application/vnd.createasyncreportresponse.v3+json",
      "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
    },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const txt = await resp.text()
    throw new Error(`createReport ${profileId}/${product.label}: ${resp.status} ${txt.slice(0, 200)}`)
  }
  const j = await resp.json()
  return j.reportId as string
}

function columnsFor(adProduct: 'SP' | 'SB' | 'SD'): string[] {
  // Request raw metrics only. CTR / CVR / ROAS / CPC are computed client-side
  // in mergeReportRows after aggregating across days + products (ratios can't
  // be summed). Amazon's v3 API rejects the whole request if any column is
  // invalid for the ad product, so we keep each list minimal and known-good.
  const base = [
    "date",
    "campaignId", "campaignName", "campaignStatus",
    "impressions", "clicks", "cost",
  ]
  if (adProduct === 'SP') {
    // 14-day attribution to match the Amazon Ads console default.
    return [...base, "sales14d", "purchases14d"]
  }
  // SB and SD use the plain sales / purchases columns (already 14-day).
  return [...base, "sales", "purchases"]
}

// ---------- Report status + download ----------

interface ReportStatusResponse {
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
  url?: string
  failureReason?: string
}

async function getReportStatus(
  reportId: string,
  profileId: number,
  accessToken: string,
  clientId: string,
): Promise<ReportStatusResponse> {
  const resp = await fetch(`${AMAZON_ADS_API}/reporting/reports/${reportId}`, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": clientId,
      "Amazon-Advertising-API-Scope": String(profileId),
      "Accept": "application/vnd.getasyncreportresponse.v3+json",
    },
  })
  if (!resp.ok) {
    const txt = await resp.text()
    throw new Error(`getReportStatus ${reportId}: ${resp.status} ${txt.slice(0, 200)}`)
  }
  return await resp.json() as ReportStatusResponse
}

interface AmazonReportRow {
  date?: string
  campaignId?: number | string
  campaignName?: string
  campaignStatus?: string
  portfolioId?: number | string
  impressions?: number
  clicks?: number
  cost?: number
  sales7d?: number
  sales14d?: number
  sales?: number
  purchases7d?: number
  purchases14d?: number
  purchases?: number
  clickThroughRate?: number
  costPerClick?: number
  roasClicks7d?: number
  _profileId?: number
  _adProduct?: 'SP' | 'SB' | 'SD'
  _batchId?: string
}

async function downloadReport(downloadUrl: string): Promise<AmazonReportRow[]> {
  const resp = await fetch(downloadUrl)
  if (!resp.ok) throw new Error(`download ${resp.status}`)
  const ab = await resp.arrayBuffer()
  const gzipped = new Uint8Array(ab)
  const decoded = gunzip(gzipped)
  const text = new TextDecoder().decode(decoded)
  const parsed = JSON.parse(text)
  if (Array.isArray(parsed)) return parsed as AmazonReportRow[]
  return []
}

// ---------- Data mapping ----------

interface CampaignAccum {
  campaign: string
  campaignId: string
  type: 'SP' | 'SB' | 'SD'
  portfolioId?: string
  state?: 'enabled' | 'paused' | 'archived'
  profileId?: number
  marketplace?: string
  currency?: string
  impressions: number
  clicks: number
  spend: number
  adSales: number
  orders: number
}

// Normalize Amazon's campaignStatus ("ENABLED"/"PAUSED"/"ARCHIVED") to our
// lowercase enum. Returns undefined for anything unexpected.
function normalizeState(s: unknown): 'enabled' | 'paused' | 'archived' | undefined {
  const v = String(s ?? '').toLowerCase()
  return v === 'enabled' || v === 'paused' || v === 'archived' ? v : undefined
}

interface DailyAccum {
  date: string
  spend: number
  adSales: number
  orders: number
  impressions: number
  clicks: number
}

function mergeReportRows(
  existing: { campaigns: any[]; daily?: any[]; dailyByMkt?: any[] },
  newRows: AmazonReportRow[],
  profileMap: Map<number, ProfileMeta>,
): { campaigns: any[]; daily: any[]; dailyByMkt: any[] } {
  // Index existing for upsert
  const campaignMap = new Map<string, CampaignAccum>()
  for (const c of existing.campaigns ?? []) {
    const key = `${c.type}:${c.campaignId ?? c.campaign}`
    campaignMap.set(key, {
      campaign: c.campaign,
      campaignId: String(c.campaignId ?? ''),
      type: c.type,
      portfolioId: c.portfolioId,
      state: c.state,
      profileId: c.profileId,
      marketplace: c.marketplace,
      currency: c.currency,
      impressions: c.impressions ?? 0,
      clicks: c.clicks ?? 0,
      spend: c.spend ?? 0,
      adSales: c.adSales ?? 0,
      orders: c.orders ?? 0,
    })
  }
  const dailyMap = new Map<string, DailyAccum>()
  for (const d of existing.daily ?? []) {
    dailyMap.set(d.date, {
      date: d.date,
      spend: d.spend ?? 0,
      adSales: d.adSales ?? 0,
      orders: d.orders ?? 0,
      impressions: d.impressions ?? 0,
      clicks: d.clicks ?? 0,
    })
  }
  // Per-marketplace daily, keyed "<marketplace>:<date>".
  const dailyMktMap = new Map<string, DailyAccum & { marketplace: string }>()
  for (const d of existing.dailyByMkt ?? []) {
    dailyMktMap.set(`${d.marketplace}:${d.date}`, {
      marketplace: d.marketplace, date: d.date,
      spend: d.spend ?? 0, adSales: d.adSales ?? 0, orders: d.orders ?? 0,
      impressions: d.impressions ?? 0, clicks: d.clicks ?? 0,
    })
  }

  // Aggregate new rows
  for (const r of newRows) {
    const product = r._adProduct ?? 'SP'
    const cid = String(r.campaignId ?? '')
    if (!cid) continue
    const key = `${product}:${cid}`
    const sales = r.sales14d ?? r.sales7d ?? r.sales ?? 0
    const orders = r.purchases14d ?? r.purchases7d ?? r.purchases ?? 0
    const meta = r._profileId != null ? profileMap.get(r._profileId) : undefined
    const mkt = meta?.marketplace ?? 'US'
    const existing = campaignMap.get(key) ?? {
      campaign: r.campaignName ?? cid,
      campaignId: cid,
      type: product,
      portfolioId: r.portfolioId ? String(r.portfolioId) : undefined,
      profileId: r._profileId,
      marketplace: mkt,
      currency: meta?.currency ?? 'USD',
      impressions: 0, clicks: 0, spend: 0, adSales: 0, orders: 0,
    }
    // Keep marketplace/currency current even for pre-existing campaigns.
    if (meta) { existing.profileId = r._profileId; existing.marketplace = mkt; existing.currency = meta.currency }
    const st = normalizeState(r.campaignStatus)
    if (st) existing.state = st
    existing.impressions += r.impressions ?? 0
    existing.clicks += r.clicks ?? 0
    existing.spend += r.cost ?? 0
    existing.adSales += sales
    existing.orders += orders
    campaignMap.set(key, existing)

    if (r.date) {
      const mk = `${mkt}:${r.date}`
      const dm = dailyMktMap.get(mk) ?? { marketplace: mkt, date: r.date, spend: 0, adSales: 0, orders: 0, impressions: 0, clicks: 0 }
      dm.spend += r.cost ?? 0; dm.adSales += sales; dm.orders += orders
      dm.impressions += r.impressions ?? 0; dm.clicks += r.clicks ?? 0
      dailyMktMap.set(mk, dm)

      const day = dailyMap.get(r.date) ?? { date: r.date, spend: 0, adSales: 0, orders: 0, impressions: 0, clicks: 0 }
      day.spend += r.cost ?? 0
      day.adSales += sales
      day.orders += orders
      day.impressions += r.impressions ?? 0
      day.clicks += r.clicks ?? 0
      dailyMap.set(r.date, day)
    }
  }

  // Derive ratios for output
  const campaigns = Array.from(campaignMap.values()).map(c => {
    const ctr = c.impressions ? (c.clicks / c.impressions) * 100 : 0
    const cvr = c.clicks ? (c.orders / c.clicks) * 100 : 0
    const roas = c.spend > 0 ? c.adSales / c.spend : 0
    const acos = c.adSales > 0 ? (c.spend / c.adSales) * 100 : 0
    const cpc = c.clicks > 0 ? c.spend / c.clicks : 0
    return {
      campaign: c.campaign,
      campaignId: c.campaignId,
      type: c.type,
      portfolioId: c.portfolioId,
      state: c.state,
      marketplace: c.marketplace,
      currency: c.currency,
      impressions: c.impressions, clicks: c.clicks, spend: c.spend,
      adSales: c.adSales, orders: c.orders,
      ctr, cvr, roas, acos, cpc,
    }
  })
  const daily = Array.from(dailyMap.values())
    .map(d => ({
      ...d,
      ctr: d.impressions ? (d.clicks / d.impressions) * 100 : 0,
      cvr: d.clicks ? (d.orders / d.clicks) * 100 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const dailyByMkt = Array.from(dailyMktMap.values())
    .map(d => ({
      ...d,
      ctr: d.impressions ? (d.clicks / d.impressions) * 100 : 0,
      cvr: d.clicks ? (d.orders / d.clicks) * 100 : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return { campaigns, daily, dailyByMkt }
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// ===================== Sponsored Brands via v2 reporting =====================
// The v3 sbCampaigns report omits legacy (non-multi-ad-group) SB campaigns,
// undercounting both spend and sales. v2 returns every SB campaign but reports
// one day at a time, so we cache settled days and only re-fetch recent ones.

interface SbV2Pending { reportId: string; reportDate: string; profileId: number; mkt: string; currency: string; requestedAt?: number }
interface SbV2Row { campaignId: string; campaignName: string; mkt: string; currency: string; cost: number; sales: number; orders: number; impressions: number; clicks: number }
interface SbV2State {
  byDate: Record<string, SbV2Row[]>   // key: "<mkt>:<YYYY-MM-DD>"
  pending: SbV2Pending[]
  refreshedAt?: number
  activeProfiles?: { profileId: number; mkt: string; currency: string }[]
  activeCheckedAt?: number
}

function emptySbV2(): SbV2State { return { byDate: {}, pending: [], refreshedAt: 0, activeProfiles: undefined, activeCheckedAt: 0 } }

function windowDatesIso(daysBack: number): string[] {
  const out: string[] = []
  const today = new Date()
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(today.getTime() - i * 86_400_000)
    out.push(isoDate(d))
  }
  return out  // most-recent first
}
const isoToYmd = (iso: string) => iso.replace(/-/g, "")

// Which profiles actually run Sponsored Brands? Avoids firing v2 reports at
// profiles with no SB campaigns. Cheap v4 list call per profile, cached ~24h.
async function getActiveSbProfiles(profileMeta: ProfileMeta[], accessToken: string, clientId: string) {
  const active: { profileId: number; mkt: string; currency: string }[] = []
  for (const p of profileMeta) {
    try {
      const r = await fetch(`${AMAZON_ADS_API}/sb/v4/campaigns/list`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Amazon-Advertising-API-ClientId": clientId,
          "Amazon-Advertising-API-Scope": String(p.profileId),
          "Accept": "application/vnd.sbcampaignresource.v4+json",
          "Content-Type": "application/vnd.sbcampaignresource.v4+json",
        },
        body: JSON.stringify({ maxResults: 100 }),
      })
      if (!r.ok) continue
      const j = await r.json()
      if ((j.campaigns?.length ?? 0) > 0) active.push({ profileId: p.profileId, mkt: p.marketplace, currency: p.currency })
    } catch { /* ignore */ }
  }
  return active
}

async function requestSbV2Report(reportDate: string, profileId: number, accessToken: string, clientId: string): Promise<string> {
  const resp = await fetch(`${AMAZON_ADS_API}/v2/hsa/campaigns/report`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": clientId,
      "Amazon-Advertising-API-Scope": String(profileId),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ reportDate: isoToYmd(reportDate), metrics: SB_V2_METRICS, creativeType: "all" }),
  })
  if (resp.status !== 202 && resp.status !== 200) {
    throw new Error(`sbV2 request ${resp.status}: ${(await resp.text()).slice(0, 120)}`)
  }
  return (await resp.json()).reportId as string
}

async function getSbV2Status(reportId: string, profileId: number, accessToken: string, clientId: string): Promise<{ status: string; location?: string }> {
  const resp = await fetch(`${AMAZON_ADS_API}/v2/reports/${reportId}`, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": clientId,
      "Amazon-Advertising-API-Scope": String(profileId),
    },
  })
  if (!resp.ok) return { status: "PENDING" }
  return await resp.json()
}

async function downloadSbV2(location: string, profileId: number, accessToken: string, clientId: string): Promise<any[]> {
  // The v2 report `location` is an advertising-api URL that requires auth headers.
  const resp = await fetch(location, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": clientId,
      "Amazon-Advertising-API-Scope": String(profileId),
    },
  })
  if (!resp.ok) throw new Error(`sbV2 download ${resp.status}`)
  const ab = new Uint8Array(await resp.arrayBuffer())
  let text: string
  try { text = new TextDecoder().decode(gunzip(ab)) } catch { text = new TextDecoder().decode(ab) }
  // Preserve 18-digit campaign IDs (beyond JS safe-int) by quoting them before parse.
  const safe = text.replace(/"campaignId":\s*(\d{16,})/g, '"campaignId":"$1"')
  const parsed = JSON.parse(safe)
  return Array.isArray(parsed) ? parsed : []
}

// One SB-v2 step per sync: poll pending day-reports, ingest completed ones, then
// request any missing/stale days (bounded per run). Mutates + returns sbV2.
async function runSbV2Pipeline(
  sbV2In: SbV2State | undefined,
  profileMeta: ProfileMeta[],
  accessToken: string,
  clientId: string,
): Promise<SbV2State> {
  const sbV2: SbV2State = sbV2In ?? emptySbV2()
  sbV2.byDate = sbV2.byDate ?? {}
  sbV2.pending = sbV2.pending ?? []

  // Refresh the list of SB-active profiles ~daily.
  if (!sbV2.activeProfiles || (Date.now() - (sbV2.activeCheckedAt ?? 0)) > 24 * 60 * 60 * 1000) {
    try {
      sbV2.activeProfiles = await getActiveSbProfiles(profileMeta, accessToken, clientId)
      sbV2.activeCheckedAt = Date.now()
    } catch { /* keep prior */ }
  }
  const activeProfiles = sbV2.activeProfiles ?? []

  // 1) Poll pending day-reports (cap downloads per run).
  const now = Date.now()
  let downloads = 0
  const stillPending: SbV2Pending[] = []
  for (const p of sbV2.pending) {
    if (p.requestedAt && now - p.requestedAt > 8 * 60_000) continue  // expire stuck → re-requested as missing
    if (downloads >= SB_V2_REQUESTS_PER_RUN) { stillPending.push(p); continue }
    try {
      const st = await getSbV2Status(p.reportId, p.profileId, accessToken, clientId)
      if (st.status === "SUCCESS" && st.location) {
        const raw = await downloadSbV2(st.location, p.profileId, accessToken, clientId)
        sbV2.byDate[`${p.mkt}:${p.reportDate}`] = raw.map((r: any) => ({
          campaignId: String(r.campaignId), campaignName: r.campaignName ?? String(r.campaignId),
          mkt: p.mkt, currency: p.currency,
          cost: Number(r.cost ?? 0), sales: Number(r.attributedSales14d ?? 0), orders: Number(r.attributedConversions14d ?? 0),
          impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0),
        }))
        downloads++
      } else if (st.status === "FAILURE") {
        // drop — will be re-requested if still in the window
      } else {
        stillPending.push(p)
      }
    } catch { stillPending.push(p) }
  }
  sbV2.pending = stillPending

  // 2) Top up requests up to the per-run cap (a slow report no longer blocks backfill).
  if (activeProfiles.length > 0 && sbV2.pending.length < SB_V2_REQUESTS_PER_RUN) {
    const dates = windowDatesIso(SB_WINDOW_DAYS)  // recent-first
    const recentCutoff = dates.slice(0, SB_RECENT_MUTABLE_DAYS)
    const refreshDue = (now - (sbV2.refreshedAt ?? 0)) > SB_REFRESH_MS
    const inFlight = new Set(sbV2.pending.map((p) => `${p.mkt}:${p.reportDate}`))
    let slots = SB_V2_REQUESTS_PER_RUN - sbV2.pending.length
    let touchedRecent = false
    for (const prof of activeProfiles) {
      for (const iso of dates) {
        if (slots <= 0) break
        const key = `${prof.mkt}:${iso}`
        if (inFlight.has(key)) continue
        const isRecent = recentCutoff.includes(iso)
        if (sbV2.byDate[key] && !(isRecent && refreshDue)) continue
        try {
          const reportId = await requestSbV2Report(iso, prof.profileId, accessToken, clientId)
          sbV2.pending.push({ reportId, reportDate: iso, profileId: prof.profileId, mkt: prof.mkt, currency: prof.currency, requestedAt: now })
          inFlight.add(key); slots--
          if (isRecent) touchedRecent = true
        } catch { /* throttle/err — retry next run */ }
      }
      if (slots <= 0) break
    }
    if (refreshDue && touchedRecent) sbV2.refreshedAt = now
  }

  // 3) Prune cached days outside the window.
  const keep = new Set(windowDatesIso(SB_WINDOW_DAYS + 2))
  for (const k of Object.keys(sbV2.byDate)) {
    const day = k.split(":")[1]
    if (!keep.has(day)) delete sbV2.byDate[k]
  }

  ;(sbV2 as any).lastDownloads = downloads
  return sbV2
}

// Fold cached SB-v2 daily data into the SP+SD base, producing the combined
// campaigns/daily/dailyByMkt the frontend reads. Idempotent: always rebuilt
// from the base + cache, so it never double-counts across syncs.
function foldSb(
  base: { campaigns: any[]; daily: any[]; dailyByMkt: any[] },
  byDate: Record<string, SbV2Row[]>,
): { campaigns: any[]; daily: any[]; dailyByMkt: any[] } {
  const sbCamp = new Map<string, any>()
  const sbDaily = new Map<string, any>()
  const sbDailyMkt = new Map<string, any>()
  for (const [key, rows] of Object.entries(byDate ?? {})) {
    const date = key.split(":")[1]
    for (const r of rows) {
      const ck = `SB:${r.campaignId}`
      const c = sbCamp.get(ck) ?? { campaign: r.campaignName, campaignId: r.campaignId, type: "SB", marketplace: r.mkt, currency: r.currency, impressions: 0, clicks: 0, spend: 0, adSales: 0, orders: 0 }
      c.impressions += r.impressions; c.clicks += r.clicks; c.spend += r.cost; c.adSales += r.sales; c.orders += r.orders
      sbCamp.set(ck, c)
      const d = sbDaily.get(date) ?? { date, spend: 0, adSales: 0, orders: 0, impressions: 0, clicks: 0 }
      d.spend += r.cost; d.adSales += r.sales; d.orders += r.orders; d.impressions += r.impressions; d.clicks += r.clicks
      sbDaily.set(date, d)
      const mk = `${r.mkt}:${date}`
      const dm = sbDailyMkt.get(mk) ?? { marketplace: r.mkt, date, spend: 0, adSales: 0, orders: 0, impressions: 0, clicks: 0 }
      dm.spend += r.cost; dm.adSales += r.sales; dm.orders += r.orders; dm.impressions += r.impressions; dm.clicks += r.clicks
      sbDailyMkt.set(mk, dm)
    }
  }
  const ratios = (c: any) => ({
    ...c,
    ctr: c.impressions ? (c.clicks / c.impressions) * 100 : 0,
    cvr: c.clicks ? (c.orders / c.clicks) * 100 : 0,
    roas: c.spend > 0 ? c.adSales / c.spend : 0,
    acos: c.adSales > 0 ? (c.spend / c.adSales) * 100 : 0,
    cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
  })
  const campaigns = [...(base.campaigns ?? []), ...Array.from(sbCamp.values()).map(ratios)]
  const dailyMap = new Map<string, any>()
  for (const d of base.daily ?? []) dailyMap.set(d.date, { ...d })
  for (const [date, s] of sbDaily) {
    const d = dailyMap.get(date) ?? { date, spend: 0, adSales: 0, orders: 0, impressions: 0, clicks: 0 }
    d.spend = (d.spend ?? 0) + s.spend; d.adSales = (d.adSales ?? 0) + s.adSales; d.orders = (d.orders ?? 0) + s.orders
    d.impressions = (d.impressions ?? 0) + s.impressions; d.clicks = (d.clicks ?? 0) + s.clicks
    dailyMap.set(date, d)
  }
  const daily = Array.from(dailyMap.values())
    .map(d => ({ ...d, ctr: d.impressions ? (d.clicks / d.impressions) * 100 : 0, cvr: d.clicks ? (d.orders / d.clicks) * 100 : 0 }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const dmMap = new Map<string, any>()
  for (const d of base.dailyByMkt ?? []) dmMap.set(`${d.marketplace}:${d.date}`, { ...d })
  for (const [mk, s] of sbDailyMkt) {
    const d = dmMap.get(mk) ?? { marketplace: s.marketplace, date: s.date, spend: 0, adSales: 0, orders: 0, impressions: 0, clicks: 0 }
    d.spend = (d.spend ?? 0) + s.spend; d.adSales = (d.adSales ?? 0) + s.adSales; d.orders = (d.orders ?? 0) + s.orders
    d.impressions = (d.impressions ?? 0) + s.impressions; d.clicks = (d.clicks ?? 0) + s.clicks
    dmMap.set(mk, d)
  }
  const dailyByMkt = Array.from(dmMap.values())
    .map(d => ({ ...d, ctr: d.impressions ? (d.clicks / d.impressions) * 100 : 0, cvr: d.clicks ? (d.orders / d.clicks) * 100 : 0 }))
    .sort((a, b) => a.date.localeCompare(b.date))
  return { campaigns, daily, dailyByMkt }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
function jsonError(status: number, message: string): Response {
  return json({ error: message }, status)
}
