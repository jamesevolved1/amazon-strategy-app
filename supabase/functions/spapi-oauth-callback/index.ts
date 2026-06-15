// SP-API OAuth callback.
//
// Seller Central's consent flow redirects here after a client authorizes the
// app:  ?spapi_oauth_code=...&state=...&selling_partner_id=...
//
// We exchange the code for a refresh token (same LWA token endpoint the Ads
// API uses, but with the SP-API app's own client_id/secret) and store it in
// spapi_connections.
//
// Required Edge Function secrets:
//   SPAPI_LWA_CLIENT_ID       — SP-API app's LWA client id (Seller Central → Develop Apps)
//   SPAPI_LWA_CLIENT_SECRET   — SP-API app's LWA client secret
//   SPAPI_OAUTH_REDIRECT_URI  — this function's URL, registered on the SP-API app
//   APP_URL                   — https://jamesevolved1.github.io/amazon-strategy-app
//
// Deploy with JWT verification OFF — Seller Central's browser redirect carries
// no Supabase JWT (the user's JWT travels inside `state` instead).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token"

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get("spapi_oauth_code")
  const stateRaw = url.searchParams.get("state")
  const sellingPartnerId = url.searchParams.get("selling_partner_id")
  const errParam = url.searchParams.get("error")

  const appUrl = Deno.env.get("APP_URL") ?? "https://jamesevolved1.github.io/amazon-strategy-app"

  if (errParam) {
    return Response.redirect(`${appUrl}/#/clients?spapi_error=${encodeURIComponent(errParam)}`, 302)
  }
  if (!code || !stateRaw) {
    return errorPage("Missing SP-API OAuth code or state parameter.")
  }

  let state: { sb?: string; app_client_id?: string; app_client_name?: string; region?: string }
  try {
    const padded = stateRaw.replace(/-/g, "+").replace(/_/g, "/")
    const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4))
    state = JSON.parse(atob(padded + padding))
  } catch {
    return errorPage("Could not decode the state parameter.")
  }
  if (!state.sb || !state.app_client_id) {
    return errorPage("State is missing required fields (sb, app_client_id).")
  }

  const clientId = Deno.env.get("SPAPI_LWA_CLIENT_ID")
  const clientSecret = Deno.env.get("SPAPI_LWA_CLIENT_SECRET")
  const redirectUri = Deno.env.get("SPAPI_OAUTH_REDIRECT_URI") ?? `${url.origin}${url.pathname}`
  if (!clientId || !clientSecret) {
    return errorPage("Edge Function is missing SPAPI_LWA_CLIENT_ID or SPAPI_LWA_CLIENT_SECRET secrets.")
  }

  // Exchange the authorization code for tokens.
  const tokenResp = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  const tokenJson: Record<string, unknown> = await tokenResp.json().catch(() => ({}))
  if (!tokenResp.ok) {
    const msg = (tokenJson.error_description ?? tokenJson.error ?? `HTTP ${tokenResp.status}`) as string
    return errorPage(`SP-API token exchange failed: ${msg}`)
  }
  const refreshToken = tokenJson.refresh_token as string | undefined
  const accessToken = tokenJson.access_token as string | undefined
  const expiresIn = (tokenJson.expires_in as number | undefined) ?? 3600
  if (!refreshToken) return errorPage("SP-API response did not include a refresh_token.")

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  if (!supabaseUrl || !anonKey) return errorPage("Edge Function missing SUPABASE_URL / SUPABASE_ANON_KEY.")

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${state.sb}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error } = await supabase
    .from("spapi_connections")
    .upsert({
      app_client_id: state.app_client_id,
      app_client_name: state.app_client_name ?? null,
      selling_partner_id: sellingPartnerId ?? null,
      region: state.region ?? "NA",
      refresh_token: refreshToken,
      access_token: accessToken ?? null,
      access_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      last_sync_error: null,
    }, { onConflict: "user_id,app_client_id" })

  if (error) return errorPage(`Could not save the SP-API connection: ${error.message}`)

  return Response.redirect(`${appUrl}/#/clients?spapi_connected=${encodeURIComponent(state.app_client_id)}`, 302)
})

function errorPage(message: string): Response {
  const safe = message.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>SP-API connection error</title>
<style>
  body { font-family: Inter, system-ui, sans-serif; background:#f6f7f9; color:#0f1115; margin:0; padding:48px; line-height:1.5; }
  .card { max-width:560px; margin:64px auto; padding:28px 32px; background:#fff; border:1px solid #e7e9ee; border-radius:14px; }
  h1 { font-size:18px; margin:0 0 10px; }
  p { margin:0 0 14px; color:#5b6068; font-size:14px; }
  a { color:#0f1115; font-weight:600; }
</style></head><body>
<div class="card">
  <h1>Couldn't complete the Seller Central connection</h1>
  <p>${safe}</p>
  <p><a href="https://jamesevolved1.github.io/amazon-strategy-app/#/clients">Return to the app</a></p>
</div></body></html>`
  return new Response(html, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } })
}
