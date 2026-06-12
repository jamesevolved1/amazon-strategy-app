// Amazon Ads API OAuth callback.
//
// Flow:
//   1. The frontend opens a popup at https://www.amazon.com/ap/oa?... with
//      state = base64(JSON.stringify({ sb: <user JWT>, app_client_id, app_client_name }))
//   2. The user signs in to their Amazon advertising account and clicks "Allow".
//   3. Amazon redirects to THIS endpoint with ?code=...&state=...
//   4. We POST to https://api.amazon.com/auth/o2/token to exchange the code
//      for a refresh + access token pair.
//   5. We upsert into amazon_connections using the user's JWT (so RLS scopes
//      the row to the right Supabase user).
//   6. We redirect the user's browser back to APP_URL/#/clients?connected=...
//
// Required Edge Function secrets (set in Supabase Dashboard -> Functions -> Secrets):
//   AMAZON_ADS_CLIENT_ID         — from Gabe's "Evolved Commerce" LWA profile
//   AMAZON_ADS_CLIENT_SECRET     — same profile (NEVER paste in chat)
//   AMAZON_OAUTH_REDIRECT_URI    — exact URL registered in Allowed Return URLs
//   APP_URL                      — https://jamesevolved1.github.io/amazon-strategy-app
//
// IMPORTANT: this function must be deployed with JWT verification OFF, because
// Amazon's redirect from the user's browser will not carry a Supabase JWT.
// In the Supabase Dashboard, edit this function and toggle "Verify JWT with
// legacy secret" OFF before saving.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

const AMAZON_TOKEN_URL = "https://api.amazon.com/auth/o2/token"

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const stateRaw = url.searchParams.get("state")
  const errParam = url.searchParams.get("error")
  const errDesc = url.searchParams.get("error_description") ?? errParam ?? ""

  const appUrl = Deno.env.get("APP_URL") ?? "https://jamesevolved1.github.io/amazon-strategy-app"

  if (errParam) {
    return Response.redirect(
      `${appUrl}/#/clients?connect_error=${encodeURIComponent(errDesc)}`,
      302,
    )
  }
  if (!code || !stateRaw) {
    return errorPage("Missing OAuth code or state parameter.")
  }

  let state: { sb?: string; app_client_id?: string; app_client_name?: string }
  try {
    // Pad the base64url back to standard base64 before decoding
    const padded = stateRaw.replace(/-/g, "+").replace(/_/g, "/")
    const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4))
    state = JSON.parse(atob(padded + padding))
  } catch {
    return errorPage("Could not decode the state parameter.")
  }

  if (!state.sb || !state.app_client_id) {
    return errorPage("State is missing required fields (sb, app_client_id).")
  }

  const clientId = Deno.env.get("AMAZON_ADS_CLIENT_ID")
  const clientSecret = Deno.env.get("AMAZON_ADS_CLIENT_SECRET")
  const redirectUri = Deno.env.get("AMAZON_OAUTH_REDIRECT_URI") ?? `${url.origin}${url.pathname}`

  if (!clientId || !clientSecret) {
    return errorPage("Edge Function is missing AMAZON_ADS_CLIENT_ID or AMAZON_ADS_CLIENT_SECRET secrets.")
  }

  // 4. Exchange the authorization code for tokens.
  const tokenResp = await fetch(AMAZON_TOKEN_URL, {
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
    return errorPage(`Amazon token exchange failed: ${msg}`)
  }

  const refreshToken = tokenJson.refresh_token as string | undefined
  const accessToken = tokenJson.access_token as string | undefined
  const expiresIn = (tokenJson.expires_in as number | undefined) ?? 3600

  if (!refreshToken) {
    return errorPage("Amazon response did not include a refresh_token.")
  }

  // 5. Store the tokens using the user's JWT so RLS picks the right user_id.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  if (!supabaseUrl || !anonKey) {
    return errorPage("Edge Function is missing SUPABASE_URL / SUPABASE_ANON_KEY (these are auto-provided by Supabase).")
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${state.sb}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()
  const { error } = await supabase
    .from("amazon_connections")
    .upsert({
      app_client_id: state.app_client_id,
      app_client_name: state.app_client_name ?? null,
      refresh_token: refreshToken,
      access_token: accessToken ?? null,
      access_token_expires_at: expiresAt,
      last_sync_error: null,
    }, { onConflict: "user_id,app_client_id" })

  if (error) {
    return errorPage(`Could not save the connection: ${error.message}`)
  }

  // 6. Success — redirect back to the app with a success flag.
  return Response.redirect(
    `${appUrl}/#/clients?connected=${encodeURIComponent(state.app_client_id)}`,
    302,
  )
})

function errorPage(message: string): Response {
  const safe = message.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Connection error</title>
<style>
  body { font-family: Inter, system-ui, -apple-system, sans-serif; background: #f6f7f9; color: #0f1115;
    margin: 0; padding: 48px; line-height: 1.5; }
  .card { max-width: 560px; margin: 64px auto; padding: 28px 32px; background: #fff;
    border: 1px solid #e7e9ee; border-radius: 14px; box-shadow: 0 1px 2px rgba(15,17,21,.05); }
  h1 { font-size: 18px; margin: 0 0 10px; }
  p { margin: 0 0 14px; color: #5b6068; font-size: 14px; }
  a { color: #0f1115; font-weight: 600; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head><body>
<div class="card">
  <h1>Couldn't complete the Amazon connection</h1>
  <p>${safe}</p>
  <p><a href="https://jamesevolved1.github.io/amazon-strategy-app/#/clients">Return to the app</a></p>
</div>
</body></html>`
  return new Response(html, { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } })
}
