// Amazon Ads sync — Slice A.
//
// For each Amazon connection belonging to the calling user:
//   1. Refresh the access_token using the stored refresh_token.
//   2. List the Amazon Ads profiles the credential grants access to.
//   3. Persist the new access_token, expiry, profile_ids, and last_synced_at
//      back to amazon_connections. Clear last_sync_error on success.
//
// Slice B (next iteration) will add: report request, polling, gzip download,
// schema mapping into app_state.payload.bundles[<id>].reports.bulkCampaigns.
//
// Auth: caller must provide a valid Supabase user JWT in the Authorization
// header. RLS on amazon_connections scopes which rows this function sees.
//
// Query params:
//   client_id  — optional, restrict to a single app_client_id

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const AMAZON_TOKEN_URL = "https://api.amazon.com/auth/o2/token"
const AMAZON_ADS_API = "https://advertising-api.amazon.com"

interface AmazonProfile {
  profileId: number
  countryCode: string
  currencyCode: string
  timezone?: string
  accountInfo?: {
    marketplaceStringId?: string
    id?: string
    type?: string
    name?: string
  }
}

interface ConnectionRow {
  id: string
  app_client_id: string
  app_client_name: string | null
  refresh_token: string
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
  const clientId = Deno.env.get("AMAZON_ADS_CLIENT_ID")
  const clientSecret = Deno.env.get("AMAZON_ADS_CLIENT_SECRET")

  if (!supabaseUrl || !anonKey) return jsonError(500, "Missing Supabase env (SUPABASE_URL / SUPABASE_ANON_KEY)")
  if (!clientId || !clientSecret) return jsonError(500, "Missing Amazon env (AMAZON_ADS_CLIENT_ID / AMAZON_ADS_CLIENT_SECRET)")

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const url = new URL(req.url)
  const targetClientId = url.searchParams.get("client_id")

  let query = supabase.from("amazon_connections")
    .select("id, app_client_id, app_client_name, refresh_token")
  if (targetClientId) query = query.eq("app_client_id", targetClientId)

  const { data: connections, error } = await query
  if (error) return jsonError(500, `Could not load connections: ${error.message}`)
  if (!connections || connections.length === 0) {
    return json({
      synced: 0,
      results: [],
      message: targetClientId
        ? `No connection found for client ${targetClientId}`
        : "No Amazon connections found for this user.",
    })
  }

  const results: Array<{
    app_client_id: string
    status: "ok" | "error"
    profiles_found?: number
    profile_ids?: number[]
    error?: string
  }> = []

  for (const conn of connections as ConnectionRow[]) {
    try {
      const result = await syncOneConnection(supabase, conn, clientId, clientSecret)
      results.push({ app_client_id: conn.app_client_id, status: "ok", ...result })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error("Sync failed for", conn.app_client_id, msg)
      await supabase
        .from("amazon_connections")
        .update({ last_sync_error: msg })
        .eq("id", conn.id)
      results.push({ app_client_id: conn.app_client_id, status: "error", error: msg })
    }
  }

  const okCount = results.filter(r => r.status === "ok").length
  return json({ synced: okCount, total: results.length, results })
})

async function syncOneConnection(
  supabase: ReturnType<typeof createClient>,
  conn: ConnectionRow,
  clientId: string,
  clientSecret: string,
) {
  // 1. Refresh the access token
  const tokenResp = await fetch(AMAZON_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  const tokenJson = await tokenResp.json().catch(() => ({}))
  if (!tokenResp.ok) {
    const msg = tokenJson.error_description ?? tokenJson.error ?? `HTTP ${tokenResp.status}`
    throw new Error(`Token refresh failed: ${msg}`)
  }

  const accessToken = tokenJson.access_token as string | undefined
  const expiresIn = (tokenJson.expires_in as number | undefined) ?? 3600
  if (!accessToken) throw new Error("Token refresh succeeded but returned no access_token")

  // 2. List Amazon Ads profiles
  const profilesResp = await fetch(`${AMAZON_ADS_API}/v2/profiles`, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": clientId,
      "Accept": "application/json",
    },
  })

  if (!profilesResp.ok) {
    const body = await profilesResp.text()
    throw new Error(`Profile list failed (${profilesResp.status}): ${body.slice(0, 200)}`)
  }

  const profiles: AmazonProfile[] = await profilesResp.json()
  const profileIds = profiles.map(p => p.profileId)

  // 3. Persist the refresh result
  const accessTokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
  const { error: updateError } = await supabase
    .from("amazon_connections")
    .update({
      access_token: accessToken,
      access_token_expires_at: accessTokenExpiresAt,
      amazon_profile_ids: profileIds,
      last_synced_at: new Date().toISOString(),
      last_sync_error: null,
    })
    .eq("id", conn.id)

  if (updateError) throw new Error(`DB update failed: ${updateError.message}`)

  return { profiles_found: profileIds.length, profile_ids: profileIds }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  })
}

function jsonError(status: number, message: string): Response {
  return json({ error: message }, status)
}
