// SP-API (Selling Partner API) client-side wiring.
//
// - Builds the Seller Central consent URL we redirect a client to
// - Reads spapi_connections state
// - triggerSpapiSync() calls the spapi-sync Edge Function

import { useEffect, useState } from 'react'
import { getSupabase, isSupabaseConfigured } from './supabase'

// SP-API application id — our own "Team James - Strategy Dashboard" app
// (independent of the coworker's app). Public — appears in the consent URL.
// Env var overrides if needed.
export const SPAPI_APPLICATION_ID =
  (import.meta.env.VITE_SPAPI_APPLICATION_ID as string | undefined) ??
  'amzn1.sp.solution.7542a1ea-a9f8-456c-9c0d-0960daf571ca'

// The app is in Draft. Draft apps require version=beta on the consent URL and
// can only authorize seller accounts the developer's own login can access —
// which covers the brands managed under the Evolved Commerce solution-provider
// login. Flip to false once the app is Published (lifts the authorization cap).
export const SPAPI_DRAFT_MODE =
  (import.meta.env.VITE_SPAPI_DRAFT_MODE as string | undefined) !== 'false'

export const SPAPI_REDIRECT_URI =
  'https://txksmxlttdlzultcbxkf.supabase.co/functions/v1/spapi-oauth-callback'

// Seller Central consent host by region. NA covers US/CA/MX.
const CONSENT_HOST: Record<string, string> = {
  NA: 'https://sellercentral.amazon.com',
  EU: 'https://sellercentral-europe.amazon.com',
  FE: 'https://sellercentral.amazon.co.jp',
}

export interface SpApiSyncedDaily {
  date: string
  totalSales: number
  orders: number
  units: number
  sessions: number
  pageViews: number
}

// Actual settled fees over a trailing window (SP-API Finances API).
export interface SpApiFees {
  principal: number      // gross product sales (item Principal charges)
  referralFees: number   // Amazon commission / referral
  fbaFees: number        // FBA fulfillment fees
  otherFees: number      // everything else (variable closing, etc.)
  refunds: number        // principal refunded
  promotions: number     // promotion / coupon discounts
  windowDays: number
  updatedAt: string
}

// Per-SKU FBA inventory (SP-API FBA Inventory API).
export interface SpApiInventoryItem {
  sku: string
  asin: string
  fnSku: string
  name: string
  available: number
  inbound: number
  reserved: number
  total: number
}

export interface SpApiConnection {
  id: string
  app_client_id: string
  app_client_name: string | null
  selling_partner_id: string | null
  marketplace_ids: string[] | null
  region: string
  refresh_token: string
  pending_reports: Array<{ reportId: string; status: string; startDate: string; endDate: string }>
  synced_data: {
    daily: SpApiSyncedDaily[]
    fees?: SpApiFees
    inventory?: SpApiInventoryItem[]
  } | null
  synced_data_at: string | null
  last_synced_at: string | null
  last_sync_error: string | null
  created_at: string
  updated_at: string
}

export function isSpApiConfigured(): boolean {
  return Boolean(SPAPI_APPLICATION_ID)
}

/**
 * Builds the Seller Central consent URL. The seller signs in, picks the
 * account, and approves; Amazon redirects to our Edge Function with
 * spapi_oauth_code + selling_partner_id.
 *
 * `draftMode` appends version=beta, required while the SP-API app is in draft
 * (self-authorization). Published apps omit it.
 */
export function buildConsentUrl(opts: {
  supabaseAccessToken: string
  appClientId: string
  appClientName?: string
  region?: 'NA' | 'EU' | 'FE'
  draftMode?: boolean
}): string {
  const region = opts.region ?? 'NA'
  const state = base64UrlEncode(JSON.stringify({
    sb: opts.supabaseAccessToken,
    app_client_id: opts.appClientId,
    app_client_name: opts.appClientName ?? null,
    region,
  }))
  const params = new URLSearchParams({
    application_id: SPAPI_APPLICATION_ID,
    state,
    redirect_uri: SPAPI_REDIRECT_URI,
  })
  if (opts.draftMode) params.set('version', 'beta')
  const host = CONSENT_HOST[region] ?? CONSENT_HOST.NA
  return `${host}/apps/authorize/consent?${params.toString()}`
}

function base64UrlEncode(s: string): string {
  const utf8 = unescape(encodeURIComponent(s))
  const b64 = typeof window !== 'undefined' && typeof window.btoa === 'function' ? window.btoa(utf8) : ''
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function fetchSpApiConnections(): Promise<SpApiConnection[]> {
  if (!isSupabaseConfigured()) return []
  const sb = getSupabase()
  if (!sb) return []
  const { data, error } = await sb.from('spapi_connections').select('*').order('updated_at', { ascending: false })
  if (error || !data) return []
  return data as SpApiConnection[]
}

export async function deleteSpApiConnection(appClientId: string): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured()) return { error: 'Supabase not configured.' }
  const sb = getSupabase()
  if (!sb) return { error: 'Supabase client unavailable.' }
  const { error } = await sb.from('spapi_connections').delete().eq('app_client_id', appClientId)
  return { error: error?.message ?? null }
}

async function getAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null
  const sb = getSupabase()
  if (!sb) return null
  const { data } = await sb.auth.getSession()
  return data.session?.access_token ?? null
}

export interface SpApiSyncResponse {
  synced: number
  pending?: number
  total: number
  results: Array<{
    app_client_id: string
    status: 'ok' | 'error'
    pending_count?: number
    ingested_reports?: number
    days_after_sync?: number
    all_done?: boolean
    error?: string
  }>
  message?: string
  error?: string
}

export async function triggerSpApiSync(appClientId?: string): Promise<SpApiSyncResponse> {
  if (!isSupabaseConfigured()) return { synced: 0, total: 0, results: [], error: 'Supabase not configured.' }
  const accessToken = await getAccessToken()
  if (!accessToken) return { synced: 0, total: 0, results: [], error: 'Not signed in.' }
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!supabaseUrl) return { synced: 0, total: 0, results: [], error: 'Missing VITE_SUPABASE_URL.' }
  const url = new URL(`${supabaseUrl}/functions/v1/spapi-sync`)
  if (appClientId) url.searchParams.set('client_id', appClientId)
  try {
    const resp = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    })
    const body = await resp.json().catch(() => ({}))
    if (!resp.ok) return { synced: 0, total: 0, results: [], error: (body && (body.error || body.message)) || `HTTP ${resp.status}` }
    return body as SpApiSyncResponse
  } catch (e: unknown) {
    return { synced: 0, total: 0, results: [], error: e instanceof Error ? e.message : String(e) }
  }
}

export function useSpApiConnections(): { connections: SpApiConnection[]; loading: boolean; refresh: () => Promise<void> } {
  const [connections, setConnections] = useState<SpApiConnection[]>([])
  const [loading, setLoading] = useState(false)
  const refresh = async () => {
    setLoading(true)
    setConnections(await fetchSpApiConnections())
    setLoading(false)
  }
  useEffect(() => {
    refresh()
    if (!isSupabaseConfigured()) return
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    const t = setInterval(refresh, 30_000)
    return () => { window.removeEventListener('focus', onFocus); clearInterval(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { connections, loading, refresh }
}
