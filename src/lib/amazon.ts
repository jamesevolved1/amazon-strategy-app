// Amazon Ads API OAuth client-side wiring.
//
// - Builds the authorize URL we redirect the user to
// - Reads connection state from the amazon_connections table
// - Exposes a useAmazonConnections() hook for components to subscribe to changes

import { useEffect, useState } from 'react'
import { getSupabase, isSupabaseConfigured } from './supabase'

/** The Login-with-Amazon Client ID for the Evolved Commerce security profile. */
export const AMAZON_CLIENT_ID = 'amzn1.application-oa2-client.8c3a820fcbcd47c58e7a45427d9b5644'

/** Default OAuth redirect URI — the Supabase Edge Function callback. */
export const AMAZON_REDIRECT_URI =
  'https://txksmxlttdlzultcbxkf.supabase.co/functions/v1/amazon-oauth-callback'

/** Ads API scopes we request when a client authorizes. */
export const AMAZON_ADS_SCOPES = ['advertising::campaign_management']

export interface PendingReport {
  reportId: string
  profileId: number
  adProduct: 'SP' | 'SB' | 'SD'
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'INGESTED'
  requestedAt: string
  startDate: string
  endDate: string
  error?: string
}

export interface SyncedCampaign {
  campaign: string
  campaignId?: string
  type: 'SP' | 'SB' | 'SD' | 'OTHER'
  portfolioId?: string
  portfolio?: string
  impressions: number
  clicks: number
  spend: number
  adSales: number
  orders: number
  ctr: number
  cvr: number
  roas: number
  acos: number
  cpc: number
}

export interface SyncedDaily {
  date: string
  impressions: number
  clicks: number
  spend: number
  adSales: number
  orders: number
  ctr?: number
  cvr?: number
}

export interface AmazonConnection {
  id: string
  app_client_id: string
  app_client_name: string | null
  refresh_token: string
  access_token: string | null
  access_token_expires_at: string | null
  amazon_profile_ids: number[] | null
  pending_reports: PendingReport[]
  synced_data: { campaigns: SyncedCampaign[]; daily?: SyncedDaily[] } | null
  synced_data_at: string | null
  last_synced_at: string | null
  last_sync_error: string | null
  created_at: string
  updated_at: string
}

/**
 * Builds the URL we redirect the user to when they click "Connect Amazon Ads".
 * The state parameter encodes the Supabase JWT + which app client we're
 * connecting so the Edge Function knows where to store the resulting tokens.
 */
export function buildAuthorizeUrl(opts: {
  supabaseAccessToken: string
  appClientId: string
  appClientName?: string
}): string {
  const state = base64UrlEncode(
    JSON.stringify({
      sb: opts.supabaseAccessToken,
      app_client_id: opts.appClientId,
      app_client_name: opts.appClientName ?? null,
    }),
  )
  const params = new URLSearchParams({
    client_id: AMAZON_CLIENT_ID,
    scope: AMAZON_ADS_SCOPES.join(' '),
    response_type: 'code',
    redirect_uri: AMAZON_REDIRECT_URI,
    state,
  })
  return `https://www.amazon.com/ap/oa?${params.toString()}`
}

function base64UrlEncode(s: string): string {
  // unicode-safe base64
  const utf8 = unescape(encodeURIComponent(s))
  const b64 = typeof window !== 'undefined' && typeof window.btoa === 'function' ? window.btoa(utf8) : ''
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Fetches the current user's Amazon connections from Supabase. */
export async function fetchConnections(): Promise<AmazonConnection[]> {
  if (!isSupabaseConfigured()) return []
  const sb = getSupabase()
  if (!sb) return []
  const { data, error } = await sb
    .from('amazon_connections')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error || !data) return []
  return data as AmazonConnection[]
}

/** Deletes a connection. Frontend-initiated disconnect. */
export async function deleteConnection(appClientId: string): Promise<{ error: string | null }> {
  if (!isSupabaseConfigured()) return { error: 'Supabase is not configured.' }
  const sb = getSupabase()
  if (!sb) return { error: 'Supabase client unavailable.' }
  const { error } = await sb.from('amazon_connections').delete().eq('app_client_id', appClientId)
  return { error: error?.message ?? null }
}

/** Returns the current user's Supabase access token, or null if not signed in. */
export async function getCurrentAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null
  const sb = getSupabase()
  if (!sb) return null
  const { data } = await sb.auth.getSession()
  return data.session?.access_token ?? null
}

export interface SyncResultRow {
  app_client_id: string
  status: 'ok' | 'error'
  profiles_found?: number
  profile_ids?: number[]
  pending_count?: number
  ingested_reports?: number
  campaigns_after_sync?: number
  all_done?: boolean
  error?: string
}

export interface SyncResponse {
  synced: number
  pending?: number
  total: number
  results: SyncResultRow[]
  message?: string
  error?: string
}

/**
 * Triggers the amazon-sync Edge Function for the current user. If
 * appClientId is provided, only that client is synced; otherwise all
 * connections.
 */
export async function triggerSync(appClientId?: string): Promise<SyncResponse> {
  if (!isSupabaseConfigured()) {
    return { synced: 0, total: 0, results: [], error: 'Supabase is not configured.' }
  }
  const sb = getSupabase()
  if (!sb) return { synced: 0, total: 0, results: [], error: 'Supabase client unavailable.' }

  const accessToken = await getCurrentAccessToken()
  if (!accessToken) return { synced: 0, total: 0, results: [], error: 'Not signed in.' }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!supabaseUrl) return { synced: 0, total: 0, results: [], error: 'Missing VITE_SUPABASE_URL.' }

  const url = new URL(`${supabaseUrl}/functions/v1/amazon-sync`)
  if (appClientId) url.searchParams.set('client_id', appClientId)

  try {
    const resp = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    })
    const body = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      return {
        synced: 0,
        total: 0,
        results: [],
        error: (body && (body.error || body.message)) || `HTTP ${resp.status}`,
      }
    }
    return body as SyncResponse
  } catch (e: unknown) {
    return {
      synced: 0,
      total: 0,
      results: [],
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * React hook: subscribes to the user's Amazon connections.
 * Polls every 30s and on `window.focus` so the UI stays in sync after the user
 * returns from an OAuth flow in another tab.
 */
export function useAmazonConnections(): {
  connections: AmazonConnection[]
  loading: boolean
  refresh: () => Promise<void>
} {
  const [connections, setConnections] = useState<AmazonConnection[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    const c = await fetchConnections()
    setConnections(c)
    setLoading(false)
  }

  useEffect(() => {
    refresh()
    if (!isSupabaseConfigured()) return
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    const t = setInterval(refresh, 30_000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { connections, loading, refresh }
}
