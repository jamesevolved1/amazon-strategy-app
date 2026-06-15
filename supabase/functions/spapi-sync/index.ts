// SP-API sync — pulls the Sales & Traffic report (total/ordered product
// sales by day) so the dashboard can show total sales, organic sales
// (total − ad), and TACOS (spend ÷ total sales).
//
// Idempotent, mirrors amazon-sync:
//   1. Refresh access token if expired.
//   2. Resolve marketplace ids from the seller's participations (cached).
//   3. Poll any pending report — when DONE, fetch the document, gunzip,
//      parse salesAndTrafficByDate, merge into synced_data.daily.
//   4. If nothing pending, request a fresh GET_SALES_AND_TRAFFIC_REPORT
//      (daily granularity, last 60 days).
//
// SigV4 is NOT required (Amazon removed it in 2024) — calls authenticate with
// the x-amz-access-token header only.
//
// Secrets reused from the OAuth callback: SPAPI_LWA_CLIENT_ID, SPAPI_LWA_CLIENT_SECRET.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"
import { gunzip } from "https://deno.land/x/compress@v0.4.5/mod.ts"

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token"
const SPAPI_HOST: Record<string, string> = {
  NA: "https://sellingpartnerapi-na.amazon.com",
  EU: "https://sellingpartnerapi-eu.amazon.com",
  FE: "https://sellingpartnerapi-fe.amazon.com",
}
const REPORT_DAYS_BACK = 60

interface PendingReport {
  reportId: string
  status: string
  requestedAt: string
  startDate: string
  endDate: string
  reportDocumentId?: string
  error?: string
}

interface ConnectionRow {
  id: string
  app_client_id: string
  refresh_token: string
  access_token: string | null
  access_token_expires_at: string | null
  selling_partner_id: string | null
  marketplace_ids: string[] | null
  region: string
  pending_reports: PendingReport[]
  synced_data: { daily: any[] } | null
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
  const clientId = Deno.env.get("SPAPI_LWA_CLIENT_ID")
  const clientSecret = Deno.env.get("SPAPI_LWA_CLIENT_SECRET")
  if (!supabaseUrl || !anonKey) return jsonError(500, "Missing Supabase env")
  if (!clientId || !clientSecret) return jsonError(500, "Missing SP-API env (SPAPI_LWA_CLIENT_ID / SPAPI_LWA_CLIENT_SECRET)")

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const url = new URL(req.url)
  const targetClientId = url.searchParams.get("client_id")
  let query = supabase.from("spapi_connections").select("*")
  if (targetClientId) query = query.eq("app_client_id", targetClientId)
  const { data: connections, error } = await query
  if (error) return jsonError(500, `Could not load connections: ${error.message}`)
  if (!connections || connections.length === 0) {
    return json({ synced: 0, pending: 0, results: [], message: "No SP-API connections." })
  }

  const results: Array<Record<string, unknown>> = []
  for (const conn of connections as ConnectionRow[]) {
    try {
      const r = await syncOne(supabase, conn, clientId, clientSecret)
      results.push({ app_client_id: conn.app_client_id, status: "ok", ...r })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error("spapi sync failed", conn.app_client_id, msg)
      await supabase.from("spapi_connections").update({ last_sync_error: msg }).eq("id", conn.id)
      results.push({ app_client_id: conn.app_client_id, status: "error", error: msg })
    }
  }
  const pending = results.reduce((n, r) => n + ((r.pending_count as number) ?? 0), 0)
  return json({ synced: results.filter(r => r.status === "ok").length, pending, total: results.length, results })
})

async function syncOne(
  supabase: ReturnType<typeof createClient>,
  conn: ConnectionRow,
  clientId: string,
  clientSecret: string,
) {
  const host = SPAPI_HOST[conn.region] ?? SPAPI_HOST.NA
  const accessToken = await ensureAccessToken(supabase, conn, clientId, clientSecret)

  // Resolve marketplace ids if we don't have them.
  let marketplaceIds = conn.marketplace_ids ?? []
  if (marketplaceIds.length === 0) {
    marketplaceIds = await getMarketplaceIds(host, accessToken)
  }
  if (marketplaceIds.length === 0) throw new Error("No marketplace participations found for this seller.")

  const pending: PendingReport[] = Array.isArray(conn.pending_reports) ? [...conn.pending_reports] : []
  let synced = conn.synced_data ?? { daily: [] }
  let ingested = 0
  const stillPending: PendingReport[] = []

  for (const p of pending) {
    const status = await getReportStatus(host, p.reportId, accessToken)
    if (status.processingStatus === "DONE" && status.reportDocumentId) {
      try {
        const rows = await downloadAndParse(host, status.reportDocumentId, accessToken)
        synced = mergeDaily(synced, rows)
        ingested++
      } catch (e: unknown) {
        console.error("spapi download failed", p.reportId, e instanceof Error ? e.message : String(e))
      }
    } else if (["CANCELLED", "FATAL"].includes(status.processingStatus)) {
      console.error("spapi report failed", p.reportId, status.processingStatus)
    } else {
      stillPending.push({ ...p, status: status.processingStatus })
    }
  }

  // Request a fresh report only when nothing is pending and nothing ingested
  // this run (so we don't re-request mid-cycle).
  let newPending: PendingReport[] = []
  if (stillPending.length === 0 && ingested === 0 && pending.length === 0) {
    newPending = [await requestReport(host, accessToken, marketplaceIds)]
  }
  const finalPending = [...stillPending, ...newPending]

  const updates: Record<string, unknown> = {
    access_token: accessToken,
    marketplace_ids: marketplaceIds,
    pending_reports: finalPending,
    last_synced_at: new Date().toISOString(),
    last_sync_error: null,
  }
  if (ingested > 0) {
    updates.synced_data = synced
    updates.synced_data_at = new Date().toISOString()
  }
  await supabase.from("spapi_connections").update(updates).eq("id", conn.id)

  return {
    pending_count: finalPending.length,
    ingested_reports: ingested,
    days_after_sync: synced.daily.length,
    all_done: finalPending.length === 0 && ingested > 0,
  }
}

async function ensureAccessToken(
  supabase: ReturnType<typeof createClient>,
  conn: ConnectionRow,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const valid = conn.access_token && conn.access_token_expires_at &&
    new Date(conn.access_token_expires_at).getTime() - Date.now() > 5 * 60 * 1000
  if (valid) return conn.access_token!

  const resp = await fetch(LWA_TOKEN_URL, {
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
  await supabase.from("spapi_connections").update({
    access_token: token,
    access_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
  }).eq("id", conn.id)
  return token
}

async function getMarketplaceIds(host: string, accessToken: string): Promise<string[]> {
  const resp = await fetch(`${host}/sellers/v1/marketplaceParticipations`, {
    headers: { "x-amz-access-token": accessToken, "Accept": "application/json" },
  })
  if (!resp.ok) {
    const t = await resp.text()
    throw new Error(`marketplaceParticipations ${resp.status}: ${t.slice(0, 200)}`)
  }
  const data = await resp.json() as { payload?: Array<{ marketplace: { id: string } }> }
  return (data.payload ?? []).map(p => p.marketplace.id).filter(Boolean)
}

async function requestReport(host: string, accessToken: string, marketplaceIds: string[]): Promise<PendingReport> {
  const end = new Date()
  const start = new Date(end.getTime() - REPORT_DAYS_BACK * 86_400_000)
  // SP-API wants RFC3339; day boundaries are fine.
  const startIso = start.toISOString()
  const endIso = end.toISOString()
  const resp = await fetch(`${host}/reports/2021-06-30/reports`, {
    method: "POST",
    headers: {
      "x-amz-access-token": accessToken,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      reportType: "GET_SALES_AND_TRAFFIC_REPORT",
      marketplaceIds,
      dataStartTime: startIso,
      dataEndTime: endIso,
      reportOptions: { dateGranularity: "DAY", asinGranularity: "PARENT" },
    }),
  })
  if (!resp.ok) {
    const t = await resp.text()
    throw new Error(`createReport ${resp.status}: ${t.slice(0, 250)}`)
  }
  const j = await resp.json() as { reportId: string }
  return {
    reportId: j.reportId,
    status: "IN_QUEUE",
    requestedAt: new Date().toISOString(),
    startDate: startIso.slice(0, 10),
    endDate: endIso.slice(0, 10),
  }
}

async function getReportStatus(host: string, reportId: string, accessToken: string) {
  const resp = await fetch(`${host}/reports/2021-06-30/reports/${reportId}`, {
    headers: { "x-amz-access-token": accessToken, "Accept": "application/json" },
  })
  if (!resp.ok) {
    const t = await resp.text()
    throw new Error(`getReport ${reportId}: ${resp.status} ${t.slice(0, 200)}`)
  }
  return await resp.json() as { processingStatus: string; reportDocumentId?: string }
}

interface SalesTrafficRow {
  date?: string
  salesByDate?: {
    orderedProductSales?: { amount?: number }
    unitsOrdered?: number
    totalOrderItems?: number
  }
  trafficByDate?: {
    sessions?: number
    pageViews?: number
  }
}

async function downloadAndParse(host: string, reportDocumentId: string, accessToken: string): Promise<SalesTrafficRow[]> {
  const metaResp = await fetch(`${host}/reports/2021-06-30/documents/${reportDocumentId}`, {
    headers: { "x-amz-access-token": accessToken, "Accept": "application/json" },
  })
  if (!metaResp.ok) {
    const t = await metaResp.text()
    throw new Error(`getDocument ${reportDocumentId}: ${metaResp.status} ${t.slice(0, 200)}`)
  }
  const meta = await metaResp.json() as { url: string; compressionAlgorithm?: string }
  const docResp = await fetch(meta.url)
  if (!docResp.ok) throw new Error(`document download ${docResp.status}`)
  const ab = await docResp.arrayBuffer()
  let text: string
  if (meta.compressionAlgorithm === "GZIP") {
    text = new TextDecoder().decode(gunzip(new Uint8Array(ab)))
  } else {
    text = new TextDecoder().decode(new Uint8Array(ab))
  }
  const parsed = JSON.parse(text) as { salesAndTrafficByDate?: SalesTrafficRow[] }
  return parsed.salesAndTrafficByDate ?? []
}

function mergeDaily(existing: { daily: any[] }, rows: SalesTrafficRow[]): { daily: any[] } {
  const map = new Map<string, { date: string; totalSales: number; orders: number; units: number; sessions: number; pageViews: number }>()
  for (const d of existing.daily ?? []) {
    map.set(d.date, { date: d.date, totalSales: d.totalSales ?? 0, orders: d.orders ?? 0, units: d.units ?? 0, sessions: d.sessions ?? 0, pageViews: d.pageViews ?? 0 })
  }
  for (const r of rows) {
    if (!r.date) continue
    const date = r.date.slice(0, 10)
    const totalSales = r.salesByDate?.orderedProductSales?.amount ?? 0
    const orders = r.salesByDate?.totalOrderItems ?? 0
    const units = r.salesByDate?.unitsOrdered ?? 0
    const sessions = r.trafficByDate?.sessions ?? 0
    const pageViews = r.trafficByDate?.pageViews ?? 0
    // SP-API reports are authoritative for total sales — overwrite, don't sum.
    map.set(date, { date, totalSales, orders, units, sessions, pageViews })
  }
  const daily = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
  return { daily }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } })
}
function jsonError(status: number, message: string): Response {
  return json({ error: message }, status)
}
