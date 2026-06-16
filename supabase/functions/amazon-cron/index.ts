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
const AD_PRODUCTS = [
  { label: "SP", amazon: "SPONSORED_PRODUCTS", reportTypeId: "spCampaigns" },
  { label: "SB", amazon: "SPONSORED_BRANDS",  reportTypeId: "sbCampaigns" },
  { label: "SD", amazon: "SPONSORED_DISPLAY", reportTypeId: "sdCampaigns" },
]

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
  let profileIds: number[] = conn.amazon_profile_ids ?? []
  if (profileIds.length === 0) {
    const resp = await fetch(`${ADS_API}/v2/profiles`, {
      headers: { Authorization: `Bearer ${token}`, "Amazon-Advertising-API-ClientId": clientId, Accept: "application/json" },
    })
    if (resp.ok) profileIds = ((await resp.json()) as any[]).map(p => p.profileId)
  }

  const pending: any[] = Array.isArray(conn.pending_reports) ? [...conn.pending_reports] : []
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
        for (const r of rows) ingestedRows.push({ ...r, _profileId: p.profileId, _adProduct: p.adProduct })
        downloads++
      } catch { stillPending.push({ ...p, status: "FAILED" }) }
    } else if (s.status === "FAILED") { /* drop */ }
    else stillPending.push({ ...p, status: s.status })
  }

  if (ingestedRows.length > 0) synced = mergeAds(synced, ingestedRows)

  // Back-fill campaign→portfolio labels. Reports can't carry portfolioId, so we
  // fetch it separately (SP/SB/SD). Runs on fresh data OR when existing
  // campaigns lack labels and the cached map is stale — so clients synced
  // before portfolio support get labeled within one cron cycle.
  let enriched = false
  const lastCheck = synced.portfolioCheckedAt ? new Date(synced.portfolioCheckedAt).getTime() : 0
  const mapIsStale = Date.now() - lastCheck > PORTFOLIO_REFRESH_MS
  if ((synced.campaigns?.length ?? 0) > 0 && profileIds.length > 0 && (ingestedRows.length > 0 || mapIsStale)) {
    try {
      const map = await buildPortfolioMap(profileIds, token, clientId)
      if (map.size > 0) {
        synced.campaigns = synced.campaigns.map((c: any) => {
          const name = c.campaignId ? map.get(String(c.campaignId)) : undefined
          return name ? { ...c, portfolio: name } : c
        })
      }
      synced.portfolioCheckedAt = new Date().toISOString()
      enriched = true
    } catch (e) {
      console.error("portfolio enrich", e instanceof Error ? e.message : String(e))
    }
  }

  // Request fresh when nothing pending and data is stale.
  let newPending: any[] = []
  const stale = !conn.synced_data_at || (Date.now() - new Date(conn.synced_data_at).getTime() > STALE_MS)
  if (stillPending.length === 0 && pending.length === 0 && stale && profileIds.length > 0) {
    newPending = await requestAdsReports(profileIds, token, clientId)
  }

  const updates: any = {
    access_token: token, amazon_profile_ids: profileIds,
    pending_reports: [...stillPending, ...newPending],
    last_synced_at: new Date().toISOString(), last_sync_error: null,
  }
  if (ingestedRows.length > 0 || enriched) updates.synced_data = synced
  if (ingestedRows.length > 0) updates.synced_data_at = new Date().toISOString()
  await sb.from("amazon_connections").update(updates).eq("id", conn.id)
  return { ingested: downloads }
}

async function requestAdsReports(profileIds: number[], token: string, clientId: string) {
  const end = new Date(), start = new Date(Date.now() - ADS_DAYS_BACK * 86_400_000)
  const startIso = isoDate(start), endIso = isoDate(end)
  const out: any[] = []
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
          out.push({ reportId: j.reportId, profileId, adProduct: product.label, status: "PENDING", requestedAt: new Date().toISOString(), startDate: startIso, endDate: endIso })
        }
      } catch { /* skip */ }
    }
  }
  return out
}

function adsColumns(p: string): string[] {
  const base = ["date", "campaignId", "campaignName", "campaignStatus", "impressions", "clicks", "cost"]
  if (p === "SP") return [...base, "sales7d", "purchases7d"]
  return [...base, "sales", "purchases"]
}

async function adsReportStatus(reportId: string, profileId: number, token: string, clientId: string) {
  const resp = await fetch(`${ADS_API}/reporting/reports/${reportId}`, {
    headers: { Authorization: `Bearer ${token}`, "Amazon-Advertising-API-ClientId": clientId, "Amazon-Advertising-API-Scope": String(profileId), Accept: "application/vnd.getasyncreportresponse.v3+json" },
  })
  if (!resp.ok) return { status: "IN_PROGRESS" }
  return await resp.json()
}

function mergeAds(existing: any, rows: any[]) {
  const cmap = new Map<string, any>()
  for (const c of existing.campaigns ?? []) cmap.set(`${c.type}:${c.campaignId}`, { ...c })
  const dmap = new Map<string, any>()
  for (const d of existing.daily ?? []) dmap.set(d.date, { ...d })
  for (const r of rows) {
    const product = r._adProduct ?? "SP"
    const cid = String(r.campaignId ?? "")
    if (!cid) continue
    const sales = r.sales7d ?? r.sales ?? 0, orders = r.purchases7d ?? r.purchases ?? 0
    const k = `${product}:${cid}`
    const c = cmap.get(k) ?? { campaign: r.campaignName ?? cid, campaignId: cid, type: product, impressions: 0, clicks: 0, spend: 0, adSales: 0, orders: 0 }
    const st = String(r.campaignStatus ?? "").toLowerCase()
    if (st === "enabled" || st === "paused" || st === "archived") c.state = st
    c.impressions += r.impressions ?? 0; c.clicks += r.clicks ?? 0; c.spend += r.cost ?? 0; c.adSales += sales; c.orders += orders
    cmap.set(k, c)
    if (r.date) {
      const d = dmap.get(r.date) ?? { date: r.date, spend: 0, adSales: 0, orders: 0, impressions: 0, clicks: 0 }
      d.spend += r.cost ?? 0; d.adSales += sales; d.orders += orders; d.impressions += r.impressions ?? 0; d.clicks += r.clicks ?? 0
      dmap.set(r.date, d)
    }
  }
  const campaigns = Array.from(cmap.values()).map(c => ({
    ...c,
    ctr: c.impressions ? (c.clicks / c.impressions) * 100 : 0,
    cvr: c.clicks ? (c.orders / c.clicks) * 100 : 0,
    roas: c.spend > 0 ? c.adSales / c.spend : 0,
    acos: c.adSales > 0 ? (c.spend / c.adSales) * 100 : 0,
    cpc: c.clicks > 0 ? c.spend / c.clicks : 0,
  }))
  const daily = Array.from(dmap.values()).map(d => ({ ...d, ctr: d.impressions ? (d.clicks / d.impressions) * 100 : 0, cvr: d.clicks ? (d.orders / d.clicks) * 100 : 0 })).sort((a, b) => a.date.localeCompare(b.date))
  return { campaigns, daily }
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

function isoDate(d: Date) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}` }
function msg(e: unknown) { return e instanceof Error ? e.message : String(e) }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }) }
