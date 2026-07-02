// Background sync for ALL connected clients (Ads API + SP-API).
//
// Runs on a pg_cron schedule. Uses the service-role key to see every
// connection across all users (RLS is bypassed for service role). For each
// connection it advances the same pipeline the per-user sync functions use:
//   refresh token -> poll & ingest ready reports -> request fresh if stale.
//
// Idempotent + time-budgeted: if it can't finish every client in one run, the
// next run continues (connections are processed stalest-first).
//
// Protected by a shared secret. pg_cron must send header:
//   x-cron-secret: <CRON_SECRET>
//
// Required Edge Function secrets (set in Supabase):
//   SUPABASE_SERVICE_ROLE_KEY   (auto-available)
//   CRON_SECRET                 (you pick a random string)
//   AMAZON_ADS_CLIENT_ID / AMAZON_ADS_CLIENT_SECRET   (already set)
//   SPAPI_LWA_CLIENT_ID / SPAPI_LWA_CLIENT_SECRET     (already set)
//
// Deploy with JWT verification OFF (pg_cron uses the secret header, not a JWT).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"
import { gunzip } from "https://deno.land/x/compress@v0.4.5/mod.ts"

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token"
const ADS_API = "https://advertising-api.amazon.com"
const SPAPI_HOST: Record<string, string> = {
  NA: "https://sellingpartnerapi-na.amazon.com",
  EU: "https://sellingpartnerapi-eu.amazon.com",
  FE: "https://sellingpartnerapi-fe.amazon.com",
}
const PRIMARY_MARKETPLACE: Record<string, string> = {
  NA: "ATVPDKIKX0DER", EU: "A1F83G8C2ARO7P", FE: "A1VC38T7YXB528",
}
// SP + SD via v3 async reporting. SB via the v2 API (v3 sbCampaigns silently
// drops legacy non-multi-ad-group SB campaigns — see runSbV2Pipeline / foldSb).
const AD_PRODUCTS = [
  { label: "SP", amazon: "SPONSORED_PRODUCTS", reportTypeId: "spCampaigns" },
  { label: "SD", amazon: "SPONSORED_DISPLAY", reportTypeId: "sdCampaigns" },
]

// ---- PPC-audit reports (SP search term / targeting / placement) ----
// Requested once per AUDIT_STALE_MS as SUMMARY (whole-window totals, no date
// column), tagged kind:"audit" in pending_reports so the campaign pipeline
// never ingests them. Rows are transformed to the app's SearchTermRow /
// TargetingRow / PlacementRow shapes and stored under synced_data.audit.
const AUDIT_STALE_MS = 24 * 60 * 60 * 1000
const AUDIT_REPORTS: Array<{ kind: string; reportTypeId: string; groupBy: string[]; columns: string[] }> = [
  {
    kind: "searchTerm", reportTypeId: "spSearchTerm", groupBy: ["searchTerm"],
    columns: ["searchTerm", "keyword", "matchType", "campaignId", "campaignName", "adGroupId", "adGroupName", "impressions", "clicks", "cost", "sales14d", "purchases14d"],
  },
  {
    kind: "targeting", reportTypeId: "spTargeting", groupBy: ["targeting"],
    columns: ["keyword", "keywordType", "matchType", "campaignId", "campaignName", "adGroupId", "adGroupName", "impressions", "clicks", "cost", "sales14d", "purchases14d"],
  },
  {
    kind: "placement", reportTypeId: "spCampaigns", groupBy: ["campaign", "campaignPlacement"],
    columns: ["campaignId", "campaignName", "placementClassification", "impressions", "clicks", "cost", "sales14d", "purchases14d"],
  },
]

const SB_V2_METRICS = "campaignId,campaignName,cost,impressions,clicks,attributedSales14d,attributedConversions14d"
const SB_RECENT_MUTABLE_DAYS = 4
const SB_REFRESH_MS = 6 * 60 * 60 * 1000
const SB_V2_REQUESTS_PER_RUN = 8
const SB_WINDOW_DAYS = 30

// Pacing / safety
const WALL_BUDGET_MS = 45_000          // stop starting new work past this
const ADS_DOWNLOADS_PER_CONN = 12      // a full client (≤4 profiles × 3 products) in one pass
const SPAPI_DOWNLOADS_PER_CONN = 2
const ADS_DAYS_BACK = 30               // Ads v3 campaign reports cap at 31-day range
const SPAPI_DAYS_BACK = 60             // Sales & Traffic allows a longer window
const STALE_MS = 20 * 60 * 60 * 1000   // refresh reports for data older than 20h
const PORTFOLIO_REFRESH_MS = 12 * 60 * 60 * 1000 // re-fetch campaign→portfolio map every 12h

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("CRON_SECRET")
  const provided = req.headers.get("x-cron-secret")
  if (!cronSecret || provided !== cronSecret) {
    return json({ error: "Unauthorized" }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const adsId = Deno.env.get("AMAZON_ADS_CLIENT_ID")
  const adsSecret = Deno.env.get("AMAZON_ADS_CLIENT_SECRET")
  const spId = Deno.env.get("SPAPI_LWA_CLIENT_ID")
  const spSecret = Deno.env.get("SPAPI_LWA_CLIENT_SECRET")

  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const startedAt = Date.now()
  const elapsed = () => Date.now() - startedAt
  const summary = { ads: { processed: 0, ingested: 0, errors: 0 }, spapi: { processed: 0, ingested: 0, errors: 0 } }

  // ---- Ads connections, stalest first ----
  if (adsId && adsSecret) {
    const { data } = await sb.from("amazon_connections").select("*").order("last_synced_at", { ascending: true, nullsFirst: true })
    for (const conn of (data ?? [])) {
      if (elapsed() > WALL_BUDGET_MS) break
      try {
        const r = await processAds(sb, conn, adsId, adsSecret)
        summary.ads.processed++
        summary.ads.ingested += r.ingested
      } catch (e) {
        summary.ads.errors++
        await sb.from("amazon_connections").update({ last_sync_error: msg(e) }).eq("id", conn.id)
      }
    }
  }

  // ---- SP-API connections, stalest first ----
  if (spId && spSecret) {
    const { data } = await sb.from("spapi_connections").select("*").order("last_synced_at", { ascending: true, nullsFirst: true })
    for (const conn of (data ?? [])) {
      if (elapsed() > WALL_BUDGET_MS) break
      try {
        const r = await processSpapi(sb, conn, spId, spSecret)
        summary.spapi.processed++
        summary.spapi.ingested += r.ingested
      } catch (e) {
        summary.spapi.errors++
        await sb.from("spapi_connections").update({ last_sync_error: msg(e) }).eq("id", conn.id)
      }
    }
  }

  return json({ ok: true, ms: elapsed(), ...summary })
})

// ===================== Ads =====================

async function processAds(sb: any, conn: any, clientId: string, clientSecret: string) {
  const token = await refreshAds(sb, "amazon_connections", conn, clientId, clientSecret)
  // Fetch profile metadata (country + currency) so data splits by marketplace.
  let profileMeta: any[] = []
  try {
    const resp = await fetch(`${ADS_API}/v2/profiles`, {
      headers: { Authorization: `Bearer ${token}`, "Amazon-Advertising-API-ClientId": clientId, Accept: "application/json" },
    })
    if (resp.ok) profileMeta = ((await resp.json()) as any[]).map(p => ({ profileId: p.profileId, marketplace: p.countryCode ?? "US", currency: p.currencyCode ?? "USD", marketplaceId: p.accountInfo?.marketplaceStringId ?? "" }))
  } catch { /* ignore */ }
  const profileIds: number[] = profileMeta.length > 0 ? profileMeta.map(p => p.profileId) : (conn.amazon_profile_ids ?? [])
  const profileMap = new Map<number, any>(profileMeta.map(p => [p.profileId, p]))

  const allPending: any[] = Array.isArray(conn.pending_reports) ? [...conn.pending_reports] : []
  const pending = allPending.filter(p => p.kind !== "audit")
  const auditPending = allPending.filter(p => p.kind === "audit")
  let synced = conn.synced_data ?? { campaigns: [], daily: [] }
  const ingestedRows: any[] = []
  const stillPending: any[] = []
  let downloads = 0

  for (const p of pending) {
    if (downloads >= ADS_DOWNLOADS_PER_CONN) { stillPending.push(p); continue }
    const s = await adsReportStatus(p.reportId, p.profileId, token, clientId)
    if (s.status === "COMPLETED" && s.url) {
      try {
        const rows = await downloadGzipJson(s.url)
        for (const r of rows) ingestedRows.push({ ...r, _profileId: p.profileId, _adProduct: p.adProduct, _batchId: p.batchId })
        downloads++
      } catch { stillPending.push({ ...p, status: "FAILED" }) }
    } else if (s.status === "FAILED") { /* drop */ }
    else stillPending.push({ ...p, status: s.status })
  }

  // ---- PPC-audit reports: poll, transform, fold into synced.audit ----
  const auditStillPending: any[] = []
  const auditIngested: Record<string, any[]> = {}
  for (const p of auditPending) {
    if (downloads >= ADS_DOWNLOADS_PER_CONN) { auditStillPending.push(p); continue }
    const s = await adsReportStatus(p.reportId, p.profileId, token, clientId)
    if (s.status === "COMPLETED" && s.url) {
      try {
        const rows = await downloadGzipJson(s.url)
        const shaped = transformAuditRows(p.reportKind, rows)
        ;(auditIngested[p.reportKind] ??= []).push({ batchId: p.batchId, window: { start: p.startDate, end: p.endDate }, rows: shaped })
        downloads++
      } catch { auditStillPending.push({ ...p, status: "FAILED" }) }
    } else if (s.status === "FAILED") { /* drop */ }
    else auditStillPending.push({ ...p, status: s.status })
  }
  if (Object.keys(auditIngested).length > 0) {
    synced.audit = synced.audit ?? {}
    for (const [kind, batches] of Object.entries(auditIngested)) {
      for (const b of batches) {
        const cur = synced.audit[kind]
        // New batch replaces the old dataset for that kind; same batch
        // (another profile's report) appends.
        if (!cur || cur.batchId !== b.batchId) {
          synced.audit[kind] = { batchId: b.batchId, window: b.window, updatedAt: new Date().toISOString(), rows: b.rows }
        } else {
          cur.rows = [...cur.rows, ...b.rows]
          cur.updatedAt = new Date().toISOString()
        }
      }
    }
  }

  // SP+SD live in the v3 "base" fields; SB comes from the v2 pipeline and is
  // folded in afterward. Seed base from legacy fields on first run (strip old SB).
  if (!synced.baseCampaigns) {
    synced.baseCampaigns = (synced.campaigns ?? []).filter((c: any) => c.type !== "SB")
    synced.baseDaily = synced.daily ?? []
    synced.baseDailyByMkt = synced.dailyByMkt ?? []
  }
  if (ingestedRows.length > 0) {
    const batchId = ingestedRows[0]._batchId
    if (batchId && synced.batchId !== batchId) { synced.baseCampaigns = []; synced.baseDaily = []; synced.baseDailyByMkt = [] }
    const merged = mergeAds({ campaigns: synced.baseCampaigns, daily: synced.baseDaily, dailyByMkt: synced.baseDailyByMkt }, ingestedRows, profileMap)
    synced.baseCampaigns = merged.campaigns; synced.baseDaily = merged.daily; synced.baseDailyByMkt = merged.dailyByMkt
    if (batchId) synced.batchId = batchId
  }

  // Sponsored Brands (v2) pipeline — poll/ingest/request cached day-reports.
  try { synced.sbV2 = await runSbV2Pipeline(synced.sbV2, profileMeta, token, clientId) }
  catch (e) { console.error("sbV2", e instanceof Error ? e.message : String(e)) }
  const sbDownloads = synced.sbV2?.lastDownloads ?? 0

  if (profileMeta.length > 0) synced.profiles = profileMeta

  // Back-fill campaign→portfolio labels on the SP+SD base.
  const lastCheck = synced.portfolioCheckedAt ? new Date(synced.portfolioCheckedAt).getTime() : 0
  const mapIsStale = Date.now() - lastCheck > PORTFOLIO_REFRESH_MS
  if ((synced.baseCampaigns?.length ?? 0) > 0 && profileIds.length > 0 && (ingestedRows.length > 0 || mapIsStale)) {
    try {
      const map = await buildPortfolioMap(profileIds, token, clientId)
      if (map.size > 0) {
        synced.baseCampaigns = synced.baseCampaigns.map((c: any) => {
          const name = c.campaignId ? map.get(String(c.campaignId)) : undefined
          return name ? { ...c, portfolio: name } : c
        })
      }
      synced.portfolioCheckedAt = new Date().toISOString()
    } catch (e) {
      console.error("portfolio enrich", e instanceof Error ? e.message : String(e))
    }
  }

  // Fold SB-v2 into the base → the combined arrays the frontend reads.
  {
    const folded = foldSb({ campaigns: synced.baseCampaigns ?? [], daily: synced.baseDaily ?? [], dailyByMkt: synced.baseDailyByMkt ?? [] }, synced.sbV2?.byDate ?? {})
    synced.campaigns = folded.campaigns; synced.daily = folded.daily; synced.dailyByMkt = folded.dailyByMkt
  }

  // Request fresh SP/SD reports when stale. Tracked separately from
  // synced_data_at (which SB downloads bump) so v3 still refreshes on schedule.
  let newPending: any[] = []
  const adsStale = !synced.adsRefreshedAt || (Date.now() - synced.adsRefreshedAt > STALE_MS)
  if (stillPending.length === 0 && pending.length === 0 && adsStale && profileIds.length > 0) {
    newPending = await requestAdsReports(profileIds, token, clientId)
    if (newPending.length > 0) synced.adsRefreshedAt = Date.now()
  }

  // Request fresh audit reports once per AUDIT_STALE_MS.
  let newAuditPending: any[] = []
  const auditStale = !synced.auditRefreshedAt || (Date.now() - synced.auditRefreshedAt > AUDIT_STALE_MS)
  if (auditStillPending.length === 0 && auditPending.length === 0 && auditStale && profileIds.length > 0) {
    newAuditPending = await requestAuditReports(profileIds, token, clientId)
    if (newAuditPending.length > 0) synced.auditRefreshedAt = Date.now()
  }

  const updates: any = {
    access_token: token, amazon_profile_ids: profileIds,
    pending_reports: [...stillPending, ...newPending, ...auditStillPending, ...newAuditPending],
    last_synced_at: new Date().toISOString(), last_sync_error: null,
    synced_data: synced,
  }
  if (ingestedRows.length > 0 || sbDownloads > 0) updates.synced_data_at = new Date().toISOString()
  await sb.from("amazon_connections").update(updates).eq("id", conn.id)
  return { ingested: downloads + sbDownloads }
}

async function requestAdsReports(profileIds: number[], token: string, clientId: string) {
  const end = new Date(), start = new Date(Date.now() - ADS_DAYS_BACK * 86_400_000)
  const startIso = isoDate(start), endIso = isoDate(end)
  const out: any[] = []
  const batchId = crypto.randomUUID()
  for (const profileId of profileIds) {
    for (const product of AD_PRODUCTS) {
      try {
        const cols = adsColumns(product.label)
        const resp = await fetch(`${ADS_API}/reporting/reports`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Amazon-Advertising-API-ClientId": clientId,
            "Amazon-Advertising-API-Scope": String(profileId),
            Accept: "application/vnd.createasyncreportresponse.v3+json",
            "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
          },
          body: JSON.stringify({
            name: `${product.label} ${startIso}..${endIso}`,
            startDate: startIso, endDate: endIso,
            configuration: { adProduct: product.amazon, groupBy: ["campaign"], columns: cols, reportTypeId: product.reportTypeId, timeUnit: "DAILY", format: "GZIP_JSON" },
          }),
        })
        if (resp.ok) {
          const j = await resp.json()
          out.push({ reportId: j.reportId, profileId, adProduct: product.label, status: "PENDING", requestedAt: new Date().toISOString(), startDate: startIso, endDate: endIso, batchId })
        }
      } catch { /* skip */ }
    }
  }
  return out
}

function adsColumns(p: string): string[] {
  const base = ["date", "campaignId", "campaignName", "campaignStatus", "impressions", "clicks", "cost"]
  if (p === "SP") return [...base, "sales14d", "purchases14d"]  // 14-day attribution (Amazon console default)
  return [...base, "sales", "purchases"]
}

// ---- PPC-audit report request + row transforms ----

async function requestAuditReports(profileIds: number[], token: string, clientId: string) {
  const end = new Date(), start = new Date(Date.now() - ADS_DAYS_BACK * 86_400_000)
  const startIso = isoDate(start), endIso = isoDate(end)
  const out: any[] = []
  for (const spec of AUDIT_REPORTS) {
    const batchId = crypto.randomUUID()   // one batch per kind — profiles of the same batch append
    for (const profileId of profileIds) {
      try {
        const resp = await fetch(`${ADS_API}/reporting/reports`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Amazon-Advertising-API-ClientId": clientId,
            "Amazon-Advertising-API-Scope": String(profileId),
            Accept: "application/vnd.createasyncreportresponse.v3+json",
            "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
          },
          body: JSON.stringify({
            name: `audit ${spec.kind} ${startIso}..${endIso}`,
            startDate: startIso, endDate: endIso,
            configuration: {
              adProduct: "SPONSORED_PRODUCTS",
              groupBy: spec.groupBy,
              columns: spec.columns,
              reportTypeId: spec.reportTypeId,
              timeUnit: "SUMMARY",
              format: "GZIP_JSON",
            },
          }),
        })
        if (resp.ok) {
          const j = await resp.json()
          out.push({
            kind: "audit", reportKind: spec.kind,
            reportId: j.reportId, profileId, status: "PENDING",
            requestedAt: new Date().toISOString(), startDate: startIso, endDate: endIso, batchId,
          })
        } else {
          console.error("audit report request", spec.kind, profileId, resp.status, await resp.text().catch(() => ""))
        }
      } catch (e) { console.error("audit report request", spec.kind, profileId, msg(e)) }
    }
  }
  return out
}

// Shape raw v3 report rows into the app's SearchTermRow/TargetingRow/PlacementRow.
function transformAuditRows(kind: string, rows: any[]): any[] {
  const n = (v: any) => (typeof v === "number" && isFinite(v) ? v : 0)
  const ratios = (impressions: number, clicks: number, spend: number, sales: number) => ({
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    roas: spend > 0 ? sales / spend : 0,
    acos: sales > 0 ? (spend / sales) * 100 : 0,
  })
  if (kind === "searchTerm") {
    return rows
      .filter(r => n(r.clicks) > 0 || n(r.purchases14d) > 0)   // storage guard: zero-signal rows dropped
      .map(r => {
        const impressions = n(r.impressions), clicks = n(r.clicks), spend = n(r.cost)
        const sales = n(r.sales14d), orders = n(r.purchases14d)
        return {
          campaignName: String(r.campaignName ?? ""), adGroupName: String(r.adGroupName ?? ""),
          targeting: String(r.keyword ?? ""), matchType: String(r.matchType ?? ""),
          searchTerm: String(r.searchTerm ?? ""),
          impressions, clicks, spend, sales, orders,
          ...ratios(impressions, clicks, spend, sales),
        }
      })
  }
  if (kind === "targeting") {
    return rows.map(r => {
      const impressions = n(r.impressions), clicks = n(r.clicks), spend = n(r.cost)
      const sales = n(r.sales14d), orders = n(r.purchases14d)
      const { ctr: _ctr, ...rest } = ratios(impressions, clicks, spend, sales)
      return {
        campaignName: String(r.campaignName ?? ""), adGroupName: String(r.adGroupName ?? ""),
        targeting: String(r.keyword ?? ""), matchType: String(r.matchType ?? r.keywordType ?? ""),
        impressions, clicks, spend, sales, orders,
        ...rest,
      }
    })
  }
  if (kind === "placement") {
    return rows.map(r => {
      const impressions = n(r.impressions), clicks = n(r.clicks), spend = n(r.cost)
      const sales = n(r.sales14d), orders = n(r.purchases14d)
      const { ctr: _ctr, acos: _acos, ...rest } = ratios(impressions, clicks, spend, sales)
      return {
        campaignName: String(r.campaignName ?? ""),
        placement: String(r.placementClassification ?? ""),
        biddingStrategy: "",
        impressions, clicks, spend, sales, orders,
        ...rest,
      }
    })
  }
  return []
}

async function adsReportStatus(reportId: string, profileId: number, token: string, clientId: string) {
  const resp = await fetch(`${ADS_API}/reporting/reports/${reportId}`, {
    headers: { Authorization: `Bearer ${token}`, "Amazon-Advertising-API-ClientId": clientId, "Amazon-Advertising-API-Scope": String(profileId), Accept: "application/vnd.getasyncreportresponse.v3+json" },
  })
  if (!resp.ok) return { status: "IN_PROGRESS" }
  return await resp.json()
}

function mergeAds(existing: any, rows: any[], profileMap: Map<number, any>) {
  const cmap = new Map<string, any>()
  for (const c of existing.campaigns ?? []) cmap.set(`${c.type}:${c.campaignId}`, { ...c })
  const dmap = new Map<string, any>()
  for (const d of existing.daily ?? []) dmap.set(d.date, { ...d })
  const dmkt = new Map<string, any>()
  for (const d of existing.dailyByMkt ?? []) dmkt.set(`${d.marketplace}:${d.date}`, { ...d })
  for (const r of rows) {
    const product = r._adProduct ?? "SP"
    const cid = String(r.campaignId ?? "")
    if (!cid) continue
    const sales = r.sales14d ?? r.sales7d ?? r.sales ?? 0, orders = r.purchases14d ?? r.purchases7d ?? r.purchases ?? 0
    const meta = r._profileId != null ? profileMap.get(r._profileId) : undefined
    const mkt = meta?.marketplace ?? "US"
    const k = `${product}:${cid}`
    const c = cmap.get(k) ?? { campaign: r.campaignName ?? cid, campaignId: cid, type: product, impressions: 0, clicks: 0, spend: 0, adSales: 0, orders: 0 }
    if (meta) { c.profileId = r._profileId; c.marketplace = mkt; c.currency = meta.currency }
    const st = String(r.campaignStatus ?? "").toLowerCase()
    if (st === "enabled" || st === "paused" || st === "archived") c.state = st
    c.impressions += r.impressions ?? 0; c.clicks += r.clicks ?? 0; c.spend += r.cost ?? 0; c.adSales += sales; c.orders += orders
    cmap.set(k, c)
    if (r.date) {
      const mk = `${mkt}:${r.date}`
      const dm = dmkt.get(mk) ?? { marketplace: mkt, date: r.date, spend: 0, adSales: 0, orders: 0, impressions: 0, clicks: 0 }
      dm.spend += r.cost ?? 0; dm.adSales += sales; dm.orders += orders; dm.impressions += r.impressions ?? 0; dm.clicks += r.clicks ?? 0
      dmkt.set(mk, dm)
      const d = dmap.get(r.date) ?? { date: r.date, spend: 0, adSales: 0, orders: 0, impressions: 0, clicks: 0 }
      d.spend += r.cost ?? 0; d.adSales += sales; d.orders += orders; d.impressions += r.impressions ?? 0; d.clicks += r.clicks ?? 0
      dmap.set(r.date, d)
    }
  }
  const ratios = (x: any) => ({
    ...x,
    ctr: x.impressions ? (x.clicks / x.impressions) * 100 : 0,
    cvr: x.clicks ? (x.orders / x.clicks) * 100 : 0,
  })
  const campaigns = Array.from(cmap.values()).map(c => ({
    ...c,
    ctr: c.impressions ? (c.clicks / c.impressions) * 100 : 0,
    cvr: c.clicks ? (c.orders / c.clicks) * 100 : 0,
    roas: c.spend > 0 ? c.adSales / c.spend : 0,
    acos: c.adSales > 0 ? (c.spend / c.adSales) * 100 : 0,
    cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
  }))
  const daily = Array.from(dmap.values()).map(ratios).sort((a, b) => a.date.localeCompare(b.date))
  const dailyByMkt = Array.from(dmkt.values()).map(ratios).sort((a, b) => a.date.localeCompare(b.date))
  return { campaigns, daily, dailyByMkt }
}

// Build campaignId -> portfolio name across SP (v3), SB (v4), SD (v3). Reports
// can't carry portfolioId, so we join the v3 portfolios list (id -> name) with
// each product's campaign list. Every call is isolated so one failure doesn't
// break the rest; an account with no portfolios yields an empty map.
async function buildPortfolioMap(profileIds: number[], token: string, clientId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const profileId of profileIds) {
    const authBase = {
      Authorization: `Bearer ${token}`,
      "Amazon-Advertising-API-ClientId": clientId,
      "Amazon-Advertising-API-Scope": String(profileId),
    }
    // portfolioId -> name. GET /v2/portfolios returns 404 "Method Not Found" on
    // current accounts; portfolios moved to v3 POST /portfolios/list.
    const names = new Map<string, string>()
    try {
      let nextToken: string | undefined = undefined, pages = 0
      do {
        const body = nextToken ? { nextToken } : {}
        const r = await fetch(`${ADS_API}/portfolios/list`, {
          method: "POST",
          headers: { ...authBase, "Content-Type": "application/vnd.spPortfolio.v3+json", Accept: "application/vnd.spPortfolio.v3+json" },
          body: JSON.stringify(body),
        })
        if (!r.ok) break
        const d = await r.json() as { portfolios?: Array<{ portfolioId: number | string; name: string }>; nextToken?: string }
        for (const p of d.portfolios ?? []) names.set(String(p.portfolioId), p.name)
        nextToken = d.nextToken; pages++
      } while (nextToken && pages < 6)
    } catch (e) { console.error("portfolios", profileId, e instanceof Error ? e.message : String(e)) }
    if (names.size === 0) continue

    const record = (cid: unknown, pid: unknown) => {
      const key = pid != null ? String(pid) : ""
      const name = key ? names.get(key) : undefined
      if (name && cid != null) out.set(String(cid), name)
    }

    // SP (v3) + SB (v4): paginated POST
    for (const cfg of [
      { url: `${ADS_API}/sp/campaigns/list`, ct: "application/vnd.spCampaign.v3+json", body: { maxResults: 500, stateFilter: { include: ["ENABLED", "PAUSED", "ARCHIVED"] } } as Record<string, unknown> },
      { url: `${ADS_API}/sb/v4/campaigns/list`, ct: "application/vnd.sbcampaignresource.v4+json", body: { maxResults: 500 } as Record<string, unknown> },
    ]) {
      try {
        let nextToken: string | undefined = undefined, pages = 0
        do {
          const body = { ...cfg.body, ...(nextToken ? { nextToken } : {}) }
          const r = await fetch(cfg.url, { method: "POST", headers: { ...authBase, "Content-Type": cfg.ct, Accept: cfg.ct }, body: JSON.stringify(body) })
          if (!r.ok) break
          const d = await r.json() as { campaigns?: Array<{ campaignId: string | number; portfolioId?: string | number }>; nextToken?: string }
          for (const c of d.campaigns ?? []) record(c.campaignId, c.portfolioId)
          nextToken = d.nextToken; pages++
        } while (nextToken && pages < 6)
      } catch (e) { console.error("campaigns list", profileId, e instanceof Error ? e.message : String(e)) }
    }

    // SD (v3): GET, plain array
    try {
      const r = await fetch(`${ADS_API}/sd/campaigns?stateFilter=enabled,paused,archived&count=500`, { headers: { ...authBase, Accept: "application/json" } })
      if (r.ok) {
        const d = await r.json() as Array<{ campaignId: string | number; portfolioId?: string | number }>
        if (Array.isArray(d)) for (const c of d) record(c.campaignId, c.portfolioId)
      }
    } catch (e) { console.error("sd campaigns", profileId, e instanceof Error ? e.message : String(e)) }
  }
  return out
}

// ===================== SP-API =====================

async function processSpapi(sb: any, conn: any, clientId: string, clientSecret: string) {
  const host = SPAPI_HOST[conn.region] ?? SPAPI_HOST.NA
  const token = await refreshAds(sb, "spapi_connections", conn, clientId, clientSecret)
  let marketplaceIds: string[] = conn.marketplace_ids ?? []
  if (marketplaceIds.length === 0) {
    const resp = await fetch(`${host}/sellers/v1/marketplaceParticipations`, { headers: { "x-amz-access-token": token, Accept: "application/json" } })
    if (resp.ok) marketplaceIds = (((await resp.json()) as any).payload ?? []).map((p: any) => p.marketplace.id)
  }
  if (marketplaceIds.length === 0) throw new Error("No marketplace participations.")

  const pending: any[] = Array.isArray(conn.pending_reports) ? [...conn.pending_reports] : []
  let synced = conn.synced_data ?? { daily: [] }
  let downloads = 0
  const stillPending: any[] = []

  for (const p of pending) {
    if (downloads >= SPAPI_DOWNLOADS_PER_CONN) { stillPending.push(p); continue }
    const resp = await fetch(`${host}/reports/2021-06-30/reports/${p.reportId}`, { headers: { "x-amz-access-token": token, Accept: "application/json" } })
    if (!resp.ok) { stillPending.push(p); continue }
    const st = await resp.json()
    if (st.processingStatus === "DONE" && st.reportDocumentId) {
      try { synced = mergeSpapi(synced, await downloadSpapiDoc(host, st.reportDocumentId, token)); downloads++ }
      catch { /* keep, retry next run */ stillPending.push(p) }
    } else if (["CANCELLED", "FATAL"].includes(st.processingStatus)) { /* drop */ }
    else stillPending.push({ ...p, status: st.processingStatus })
  }

  let newPending: any[] = []
  const stale = !conn.synced_data_at || (Date.now() - new Date(conn.synced_data_at).getTime() > STALE_MS)
  if (stillPending.length === 0 && pending.length === 0 && stale) {
    const marketplaceId = marketplaceIds.includes(PRIMARY_MARKETPLACE[conn.region] ?? PRIMARY_MARKETPLACE.NA)
      ? (PRIMARY_MARKETPLACE[conn.region] ?? PRIMARY_MARKETPLACE.NA) : marketplaceIds[0]
    newPending = [await requestSpapiReport(host, token, marketplaceId)]
  }

  const updates: any = {
    access_token: token, marketplace_ids: marketplaceIds,
    pending_reports: [...stillPending, ...newPending],
    last_synced_at: new Date().toISOString(), last_sync_error: null,
  }
  if (downloads > 0) { updates.synced_data = synced; updates.synced_data_at = new Date().toISOString() }
  await sb.from("spapi_connections").update(updates).eq("id", conn.id)
  return { ingested: downloads }
}

async function requestSpapiReport(host: string, token: string, marketplaceId: string) {
  const end = new Date(), start = new Date(Date.now() - SPAPI_DAYS_BACK * 86_400_000)
  const resp = await fetch(`${host}/reports/2021-06-30/reports`, {
    method: "POST",
    headers: { "x-amz-access-token": token, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ reportType: "GET_SALES_AND_TRAFFIC_REPORT", marketplaceIds: [marketplaceId], dataStartTime: start.toISOString(), dataEndTime: end.toISOString(), reportOptions: { dateGranularity: "DAY", asinGranularity: "PARENT" } }),
  })
  if (!resp.ok) throw new Error(`createReport ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
  const j = await resp.json()
  return { reportId: j.reportId, status: "IN_QUEUE", requestedAt: new Date().toISOString() }
}

async function downloadSpapiDoc(host: string, docId: string, token: string) {
  const metaResp = await fetch(`${host}/reports/2021-06-30/documents/${docId}`, { headers: { "x-amz-access-token": token, Accept: "application/json" } })
  if (!metaResp.ok) throw new Error(`getDocument ${metaResp.status}`)
  const meta = await metaResp.json()
  const docResp = await fetch(meta.url)
  const ab = await docResp.arrayBuffer()
  const text = meta.compressionAlgorithm === "GZIP" ? new TextDecoder().decode(gunzip(new Uint8Array(ab))) : new TextDecoder().decode(new Uint8Array(ab))
  return (JSON.parse(text).salesAndTrafficByDate ?? [])
}

function mergeSpapi(existing: any, rows: any[]) {
  const map = new Map<string, any>()
  for (const d of existing.daily ?? []) map.set(d.date, { ...d })
  for (const r of rows) {
    if (!r.date) continue
    const date = String(r.date).slice(0, 10)
    map.set(date, {
      date,
      totalSales: r.salesByDate?.orderedProductSales?.amount ?? 0,
      orders: r.salesByDate?.totalOrderItems ?? 0,
      units: r.salesByDate?.unitsOrdered ?? 0,
      sessions: r.trafficByDate?.sessions ?? 0,
      pageViews: r.trafficByDate?.pageViews ?? 0,
    })
  }
  return { daily: Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date)) }
}

// ===================== shared =====================

async function refreshAds(sb: any, table: string, conn: any, clientId: string, clientSecret: string) {
  const valid = conn.access_token && conn.access_token_expires_at && new Date(conn.access_token_expires_at).getTime() - Date.now() > 5 * 60 * 1000
  if (valid) return conn.access_token
  const resp = await fetch(LWA_TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token, client_id: clientId, client_secret: clientSecret }),
  })
  const j = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(`Token refresh failed: ${j.error_description ?? j.error ?? resp.status}`)
  const token = j.access_token
  await sb.from(table).update({ access_token: token, access_token_expires_at: new Date(Date.now() + ((j.expires_in ?? 3600) * 1000)).toISOString() }).eq("id", conn.id)
  return token
}

async function downloadGzipJson(url: string): Promise<any[]> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`download ${resp.status}`)
  const text = new TextDecoder().decode(gunzip(new Uint8Array(await resp.arrayBuffer())))
  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : []
}

// ===================== Sponsored Brands via v2 reporting =====================
function windowDatesIso(daysBack: number): string[] {
  const out: string[] = []
  const today = new Date()
  for (let i = 0; i < daysBack; i++) out.push(isoDate(new Date(today.getTime() - i * 86_400_000)))
  return out
}
const isoToYmd = (iso: string) => iso.replace(/-/g, "")

async function getActiveSbProfiles(profileMeta: any[], token: string, clientId: string) {
  const active: { profileId: number; mkt: string; currency: string }[] = []
  for (const p of profileMeta) {
    try {
      const r = await fetch(`${ADS_API}/sb/v4/campaigns/list`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Amazon-Advertising-API-ClientId": clientId, "Amazon-Advertising-API-Scope": String(p.profileId), Accept: "application/vnd.sbcampaignresource.v4+json", "Content-Type": "application/vnd.sbcampaignresource.v4+json" },
        body: JSON.stringify({ maxResults: 100 }),
      })
      if (!r.ok) continue
      const j = await r.json()
      if ((j.campaigns?.length ?? 0) > 0) active.push({ profileId: p.profileId, mkt: p.marketplace, currency: p.currency })
    } catch { /* ignore */ }
  }
  return active
}

async function requestSbV2Report(reportDate: string, profileId: number, token: string, clientId: string): Promise<string> {
  const resp = await fetch(`${ADS_API}/v2/hsa/campaigns/report`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Amazon-Advertising-API-ClientId": clientId, "Amazon-Advertising-API-Scope": String(profileId), "Content-Type": "application/json" },
    body: JSON.stringify({ reportDate: isoToYmd(reportDate), metrics: SB_V2_METRICS, creativeType: "all" }),
  })
  if (resp.status !== 202 && resp.status !== 200) throw new Error(`sbV2 ${resp.status}`)
  return (await resp.json()).reportId as string
}

async function getSbV2Status(reportId: string, profileId: number, token: string, clientId: string): Promise<{ status: string; location?: string }> {
  const resp = await fetch(`${ADS_API}/v2/reports/${reportId}`, {
    headers: { Authorization: `Bearer ${token}`, "Amazon-Advertising-API-ClientId": clientId, "Amazon-Advertising-API-Scope": String(profileId) },
  })
  if (!resp.ok) return { status: "PENDING" }
  return await resp.json()
}

async function downloadSbV2(location: string, profileId: number, token: string, clientId: string): Promise<any[]> {
  const resp = await fetch(location, {
    headers: { Authorization: `Bearer ${token}`, "Amazon-Advertising-API-ClientId": clientId, "Amazon-Advertising-API-Scope": String(profileId) },
  })
  if (!resp.ok) throw new Error(`sbV2 dl ${resp.status}`)
  const ab = new Uint8Array(await resp.arrayBuffer())
  let text: string
  try { text = new TextDecoder().decode(gunzip(ab)) } catch { text = new TextDecoder().decode(ab) }
  const safe = text.replace(/"campaignId":\s*(\d{16,})/g, '"campaignId":"$1"')
  const parsed = JSON.parse(safe)
  return Array.isArray(parsed) ? parsed : []
}

async function runSbV2Pipeline(sbV2In: any, profileMeta: any[], token: string, clientId: string): Promise<any> {
  const sbV2: any = sbV2In ?? { byDate: {}, pending: [], refreshedAt: 0 }
  sbV2.byDate = sbV2.byDate ?? {}
  sbV2.pending = sbV2.pending ?? []

  if (!sbV2.activeProfiles || (Date.now() - (sbV2.activeCheckedAt ?? 0)) > 24 * 60 * 60 * 1000) {
    try { sbV2.activeProfiles = await getActiveSbProfiles(profileMeta, token, clientId); sbV2.activeCheckedAt = Date.now() } catch { /* keep */ }
  }
  const activeProfiles = sbV2.activeProfiles ?? []

  const now = Date.now()
  let downloads = 0
  const stillPending: any[] = []
  for (const p of sbV2.pending) {
    if (p.requestedAt && now - p.requestedAt > 8 * 60_000) continue  // expire stuck → re-requested as missing
    if (downloads >= SB_V2_REQUESTS_PER_RUN) { stillPending.push(p); continue }
    try {
      const st = await getSbV2Status(p.reportId, p.profileId, token, clientId)
      if (st.status === "SUCCESS" && st.location) {
        const raw = await downloadSbV2(st.location, p.profileId, token, clientId)
        sbV2.byDate[`${p.mkt}:${p.reportDate}`] = raw.map((r: any) => ({
          campaignId: String(r.campaignId), campaignName: r.campaignName ?? String(r.campaignId),
          mkt: p.mkt, currency: p.currency,
          cost: Number(r.cost ?? 0), sales: Number(r.attributedSales14d ?? 0), orders: Number(r.attributedConversions14d ?? 0),
          impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0),
        }))
        downloads++
      } else if (st.status === "FAILURE") { /* drop */ }
      else stillPending.push(p)
    } catch { stillPending.push(p) }
  }
  sbV2.pending = stillPending

  // Top up requests up to the per-run cap (a slow report no longer blocks backfill).
  if (activeProfiles.length > 0 && sbV2.pending.length < SB_V2_REQUESTS_PER_RUN) {
    const dates = windowDatesIso(SB_WINDOW_DAYS)
    const recentCutoff = dates.slice(0, SB_RECENT_MUTABLE_DAYS)
    const refreshDue = (now - (sbV2.refreshedAt ?? 0)) > SB_REFRESH_MS
    const inFlight = new Set(sbV2.pending.map((p: any) => `${p.mkt}:${p.reportDate}`))
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
          const reportId = await requestSbV2Report(iso, prof.profileId, token, clientId)
          sbV2.pending.push({ reportId, reportDate: iso, profileId: prof.profileId, mkt: prof.mkt, currency: prof.currency, requestedAt: now })
          inFlight.add(key); slots--
          if (isRecent) touchedRecent = true
        } catch { /* retry next run */ }
      }
      if (slots <= 0) break
    }
    if (refreshDue && touchedRecent) sbV2.refreshedAt = now
  }

  const keep = new Set(windowDatesIso(SB_WINDOW_DAYS + 2))
  for (const k of Object.keys(sbV2.byDate)) { if (!keep.has(k.split(":")[1])) delete sbV2.byDate[k] }
  sbV2.lastDownloads = downloads
  return sbV2
}

function foldSb(base: any, byDate: any): { campaigns: any[]; daily: any[]; dailyByMkt: any[] } {
  const sbCamp = new Map<string, any>(), sbDaily = new Map<string, any>(), sbDailyMkt = new Map<string, any>()
  for (const [key, rows] of Object.entries(byDate ?? {})) {
    const date = key.split(":")[1]
    for (const r of rows as any[]) {
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
  const withR = (c: any) => ({ ...c, ctr: c.impressions ? (c.clicks / c.impressions) * 100 : 0, cvr: c.clicks ? (c.orders / c.clicks) * 100 : 0, roas: c.spend > 0 ? c.adSales / c.spend : 0, acos: c.adSales > 0 ? (c.spend / c.adSales) * 100 : 0, cpc: c.clicks > 0 ? c.spend / c.clicks : 0 })
  const dRatios = (d: any) => ({ ...d, ctr: d.impressions ? (d.clicks / d.impressions) * 100 : 0, cvr: d.clicks ? (d.orders / d.clicks) * 100 : 0 })
  const campaigns = [...(base.campaigns ?? []), ...Array.from(sbCamp.values()).map(withR)]
  const dmap = new Map<string, any>()
  for (const d of base.daily ?? []) dmap.set(d.date, { ...d })
  for (const [date, s] of sbDaily) {
    const d = dmap.get(date) ?? { date, spend: 0, adSales: 0, orders: 0, impressions: 0, clicks: 0 }
    d.spend = (d.spend ?? 0) + s.spend; d.adSales = (d.adSales ?? 0) + s.adSales; d.orders = (d.orders ?? 0) + s.orders; d.impressions = (d.impressions ?? 0) + s.impressions; d.clicks = (d.clicks ?? 0) + s.clicks
    dmap.set(date, d)
  }
  const dmkt = new Map<string, any>()
  for (const d of base.dailyByMkt ?? []) dmkt.set(`${d.marketplace}:${d.date}`, { ...d })
  for (const [mk, s] of sbDailyMkt) {
    const d = dmkt.get(mk) ?? { marketplace: s.marketplace, date: s.date, spend: 0, adSales: 0, orders: 0, impressions: 0, clicks: 0 }
    d.spend = (d.spend ?? 0) + s.spend; d.adSales = (d.adSales ?? 0) + s.adSales; d.orders = (d.orders ?? 0) + s.orders; d.impressions = (d.impressions ?? 0) + s.impressions; d.clicks = (d.clicks ?? 0) + s.clicks
    dmkt.set(mk, d)
  }
  const daily = Array.from(dmap.values()).map(dRatios).sort((a, b) => a.date.localeCompare(b.date))
  const dailyByMkt = Array.from(dmkt.values()).map(dRatios).sort((a, b) => a.date.localeCompare(b.date))
  return { campaigns, daily, dailyByMkt }
}

function isoDate(d: Date) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}` }
function msg(e: unknown) { return e instanceof Error ? e.message : String(e) }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }) }
