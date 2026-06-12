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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"
import { gunzip } from "https://deno.land/x/compress@v0.4.5/mod.ts"

const AMAZON_TOKEN_URL = "https://api.amazon.com/auth/o2/token"
const AMAZON_ADS_API = "https://advertising-api.amazon.com"

// Cap how many pending reports we process per invocation to keep wall clock
// comfortably below the 50-second free-tier limit. Each download is a few
// hundred KB to a few MB; 4 is conservative.
const MAX_DOWNLOADS_PER_RUN = 4

// Number of days back to request. 60 gives enough history for custom date
// ranges while keeping report generation reasonably fast.
const REPORT_DAYS_BACK = 60

// Map our short ad-product label to Amazon's enum + report type.
const AD_PRODUCTS = [
  { label: 'SP' as const, amazon: 'SPONSORED_PRODUCTS', reportTypeId: 'spCampaigns' },
  { label: 'SB' as const, amazon: 'SPONSORED_BRANDS',  reportTypeId: 'sbCampaigns' },
  { label: 'SD' as const, amazon: 'SPONSORED_DISPLAY', reportTypeId: 'sdCampaigns' },
]

interface PendingReport {
  reportId: string
  profileId: number
  adProduct: 'SP' | 'SB' | 'SD'
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'INGESTED'
  requestedAt: string
  startDate: string
  endDate: string
  error?: string
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
  synced_data: { campaigns: any[]; daily?: any[] } | null
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
  supabase: ReturnType<typeof createClient>,
  conn: ConnectionRow,
  adsClientId: string,
  adsClientSecret: string,
) {
  // 1. Make sure we have a valid access_token
  const accessToken = await ensureAccessToken(supabase, conn, adsClientId, adsClientSecret)

  // 2. Make sure we have a profile list
  let profileIds = conn.amazon_profile_ids ?? []
  if (profileIds.length === 0) {
    profileIds = await listProfiles(accessToken, adsClientId)
  }

  // 3. Process pending reports: poll status, ingest completed ones
  const pending: PendingReport[] = Array.isArray(conn.pending_reports) ? [...conn.pending_reports] : []
  let downloads = 0
  const ingestedRows: AmazonReportRow[] = []

  // Track which to keep in pending vs remove
  const stillPending: PendingReport[] = []
  for (const p of pending) {
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
          ingestedRows.push({ ...r, _profileId: p.profileId, _adProduct: p.adProduct })
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
  let synced = conn.synced_data ?? { campaigns: [], daily: [] }
  if (ingestedRows.length > 0) {
    synced = mergeReportRows(synced, ingestedRows)
    // Enrich campaigns with portfolio names. The report columns can't carry
    // portfolioId (Amazon rejects it), so we fetch the campaign→portfolio
    // mapping separately. Resilient: failure leaves campaigns unenriched.
    try {
      const portfolioMap = await buildPortfolioMap(profileIds, accessToken, adsClientId)
      if (portfolioMap.size > 0) {
        synced.campaigns = synced.campaigns.map((c: any) => {
          const name = c.campaignId ? portfolioMap.get(String(c.campaignId)) : undefined
          return name ? { ...c, portfolio: name } : c
        })
      }
    } catch (e) {
      console.error("portfolio enrich failed", e instanceof Error ? e.message : String(e))
    }
  }

  // 5. If no pending reports left, request a fresh batch
  let newPending: PendingReport[] = []
  if (stillPending.length === 0 && downloads === 0 && pending.length === 0) {
    newPending = await requestFreshReports(profileIds, accessToken, adsClientId)
  }

  const finalPending = [...stillPending, ...newPending]
  const allDone = finalPending.length === 0 && ingestedRows.length > 0

  // 6. Save back
  const updates: Record<string, unknown> = {
    access_token: accessToken,
    amazon_profile_ids: profileIds,
    pending_reports: finalPending,
    last_synced_at: new Date().toISOString(),
    last_sync_error: null,
  }
  if (ingestedRows.length > 0) {
    updates.synced_data = synced
    updates.synced_data_at = new Date().toISOString()
  }
  await supabase.from("amazon_connections").update(updates).eq("id", conn.id)

  return {
    profiles_found: profileIds.length,
    pending_count: finalPending.length,
    ingested_reports: downloads,
    campaigns_after_sync: synced.campaigns.length,
    all_done: allDone,
  }
}

// ---------- Token + profiles ----------

async function ensureAccessToken(
  supabase: ReturnType<typeof createClient>,
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
  const resp = await fetch(`${AMAZON_ADS_API}/v2/profiles`, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": clientId,
      "Accept": "application/json",
    },
  })
  if (!resp.ok) throw new Error(`Profile list failed: ${resp.status}`)
  const profiles = await resp.json() as Array<{ profileId: number }>
  return profiles.map(p => p.profileId)
}

// ---------- Portfolio mapping ----------
//
// Reports can't carry portfolioId, so we build a campaignId -> portfolio name
// map from the v2 portfolios endpoint (id -> name) joined with the SP
// campaigns list (campaignId -> portfolioId). Covers Sponsored Products, where
// portfolios are most commonly used. Resilient — every call is wrapped so a
// failure for one profile/product doesn't break the others.
async function buildPortfolioMap(
  profileIds: number[],
  accessToken: string,
  clientId: string,
): Promise<Map<string, string>> {
  const campaignToPortfolio = new Map<string, string>()

  for (const profileId of profileIds) {
    try {
      // 1. portfolioId -> name
      const portResp = await fetch(`${AMAZON_ADS_API}/v2/portfolios`, {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Amazon-Advertising-API-ClientId": clientId,
          "Amazon-Advertising-API-Scope": String(profileId),
          "Accept": "application/json",
        },
      })
      if (!portResp.ok) continue
      const portfolios = await portResp.json() as Array<{ portfolioId: number; name: string }>
      if (!Array.isArray(portfolios) || portfolios.length === 0) continue
      const portfolioName = new Map(portfolios.map(p => [String(p.portfolioId), p.name]))

      // 2. campaignId -> portfolioId (SP). Paginate up to a few pages.
      let nextToken: string | undefined = undefined
      let pages = 0
      do {
        const body: Record<string, unknown> = {
          maxResults: 500,
          stateFilter: { include: ["ENABLED", "PAUSED", "ARCHIVED"] },
        }
        if (nextToken) body.nextToken = nextToken
        const campResp = await fetch(`${AMAZON_ADS_API}/sp/campaigns/list`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Amazon-Advertising-API-ClientId": clientId,
            "Amazon-Advertising-API-Scope": String(profileId),
            "Content-Type": "application/vnd.spCampaign.v3+json",
            "Accept": "application/vnd.spCampaign.v3+json",
          },
          body: JSON.stringify(body),
        })
        if (!campResp.ok) break
        const data = await campResp.json() as {
          campaigns?: Array<{ campaignId: string | number; portfolioId?: string | number }>
          nextToken?: string
        }
        for (const c of data.campaigns ?? []) {
          const pid = c.portfolioId != null ? String(c.portfolioId) : ""
          const name = pid ? portfolioName.get(pid) : undefined
          if (name) campaignToPortfolio.set(String(c.campaignId), name)
        }
        nextToken = data.nextToken
        pages++
      } while (nextToken && pages < 6)
    } catch (e) {
      console.error("portfolio map profile", profileId, e instanceof Error ? e.message : String(e))
    }
  }

  return campaignToPortfolio
}

// ---------- Report request ----------

async function requestFreshReports(
  profileIds: number[],
  accessToken: string,
  clientId: string,
): Promise<PendingReport[]> {
  const endDate = new Date()
  const startDate = new Date(endDate.getTime() - REPORT_DAYS_BACK * 86_400_000)
  const startIso = isoDate(startDate)
  const endIso = isoDate(endDate)

  const pending: PendingReport[] = []

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
        })
      } catch (e: unknown) {
        console.error("report request failed", profileId, product.label, e instanceof Error ? e.message : String(e))
        // Skip but don't fail the whole sync.
      }
    }
  }
  return pending
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
    // SP uses the 7-day attribution windows.
    return [...base, "sales7d", "purchases7d"]
  }
  // SB and SD use the plain sales / purchases columns.
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
  sales?: number
  purchases7d?: number
  purchases?: number
  clickThroughRate?: number
  costPerClick?: number
  roasClicks7d?: number
  _profileId?: number
  _adProduct?: 'SP' | 'SB' | 'SD'
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
  impressions: number
  clicks: number
  spend: number
  adSales: number
  orders: number
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
  existing: { campaigns: any[]; daily?: any[] },
  newRows: AmazonReportRow[],
): { campaigns: any[]; daily: any[] } {
  // Index existing for upsert
  const campaignMap = new Map<string, CampaignAccum>()
  for (const c of existing.campaigns ?? []) {
    const key = `${c.type}:${c.campaignId ?? c.campaign}`
    campaignMap.set(key, {
      campaign: c.campaign,
      campaignId: String(c.campaignId ?? ''),
      type: c.type,
      portfolioId: c.portfolioId,
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

  // Aggregate new rows
  for (const r of newRows) {
    const product = r._adProduct ?? 'SP'
    const cid = String(r.campaignId ?? '')
    if (!cid) continue
    const key = `${product}:${cid}`
    const sales = r.sales7d ?? r.sales ?? 0
    const orders = r.purchases7d ?? r.purchases ?? 0
    const existing = campaignMap.get(key) ?? {
      campaign: r.campaignName ?? cid,
      campaignId: cid,
      type: product,
      portfolioId: r.portfolioId ? String(r.portfolioId) : undefined,
      impressions: 0, clicks: 0, spend: 0, adSales: 0, orders: 0,
    }
    existing.impressions += r.impressions ?? 0
    existing.clicks += r.clicks ?? 0
    existing.spend += r.cost ?? 0
    existing.adSales += sales
    existing.orders += orders
    campaignMap.set(key, existing)

    if (r.date) {
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

  return { campaigns, daily }
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
function jsonError(status: number, message: string): Response {
  return json({ error: message }, status)
}
