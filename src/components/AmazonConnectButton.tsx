// "Connect Amazon Ads" button + connection-state UI per client.
//
// States rendered:
//   - Not configured (Supabase not wired)       → muted, locked
//   - Not signed in                              → muted, prompt sign-in
//   - No connection yet                          → ink "Connect" button
//   - Connected + healthy                        → mint pill + "Disconnect"
//   - Connected + last sync errored              → gold "Re-authorize" + reason

import React, { useState } from 'react'
import { Link2, Link2Off, RefreshCcw, AlertTriangle, CheckCircle2, Lock } from 'lucide-react'
import { Pill, Button, cx } from './ui'
import {
  buildAuthorizeUrl, deleteConnection, getCurrentAccessToken, type AmazonConnection,
} from '../lib/amazon'
import { isSupabaseConfigured } from '../lib/supabase'
import { relativeTime } from '../lib/format'
import type { Client } from '../types'

export function AmazonConnectButton({
  client, connection, onChanged,
}: {
  client: Client
  connection: AmazonConnection | undefined
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!isSupabaseConfigured()) {
    return (
      <span title="Amazon connection requires Supabase auth. Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY at build time.">
        <Pill tone="mute">
          <Lock className="w-3 h-3" />
          Local-only
        </Pill>
      </span>
    )
  }

  const startConnect = async () => {
    setBusy(true)
    setErr(null)
    try {
      const accessToken = await getCurrentAccessToken()
      if (!accessToken) {
        setErr('Sign in to your Supabase account first.')
        return
      }
      const url = buildAuthorizeUrl({
        supabaseAccessToken: accessToken,
        appClientId: client.id,
        appClientName: client.name,
      })
      // Redirect in the current tab — Amazon doesn't allow embedding the auth
      // page in popups for some flows, and a same-tab redirect plays nicer
      // with mobile + password managers.
      window.location.assign(url)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const startDisconnect = async () => {
    if (!confirm(`Disconnect Amazon Ads for ${client.name}? You can reconnect at any time.`)) return
    setBusy(true)
    setErr(null)
    const { error } = await deleteConnection(client.id)
    if (error) setErr(error)
    onChanged()
    setBusy(false)
  }

  if (!connection) {
    return (
      <div className="flex items-center gap-2">
        <Button
          onClick={startConnect}
          disabled={busy}
          icon={<Link2 className="w-3.5 h-3.5" />}
        >
          Connect Amazon Ads
        </Button>
        {err && (
          <span className="text-2xs text-[#9c4651]" title={err}>
            <AlertTriangle className="w-3 h-3 inline" /> {err}
          </span>
        )}
      </div>
    )
  }

  const hasError = Boolean(connection.last_sync_error)
  const lastSyncedLabel = connection.last_synced_at
    ? `synced ${relativeTime(connection.last_synced_at)}`
    : 'awaiting first sync'

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {hasError ? (
        <Pill tone="gold">
          <AlertTriangle className="w-3 h-3" />
          Re-auth needed
        </Pill>
      ) : (
        <Pill tone="mint">
          <CheckCircle2 className="w-3 h-3" />
          Connected
        </Pill>
      )}
      <span className="text-2xs text-ink-faint tnum">{lastSyncedLabel}</span>
      {hasError && (
        <Button
          onClick={startConnect}
          variant="secondary"
          icon={<RefreshCcw className="w-3.5 h-3.5" />}
          disabled={busy}
        >
          Re-authorize
        </Button>
      )}
      <button
        onClick={startDisconnect}
        disabled={busy}
        className="text-ink-faint hover:text-[#9c4651] p-1.5 rounded-md disabled:opacity-50"
        title="Disconnect"
        aria-label="Disconnect Amazon Ads"
      >
        <Link2Off className="w-3.5 h-3.5" />
      </button>
      {err && (
        <span className="text-2xs text-[#9c4651]" title={err}>
          <AlertTriangle className="w-3 h-3 inline" /> {err}
        </span>
      )}
      {connection.last_sync_error && (
        <span className="block w-full text-2xs text-[#8b6a18] mt-1">
          Last sync error: {connection.last_sync_error}
        </span>
      )}
    </div>
  )
}

// Used inline by the App shell to display a one-time toast when the user
// returns from the OAuth flow (?connected=<id> or ?connect_error=<msg>).
export function ConnectionResultBanner({
  status, clientName, errorMessage, onDismiss,
}: {
  status: 'success' | 'error'
  clientName?: string
  errorMessage?: string
  onDismiss: () => void
}) {
  return (
    <div
      className={cx(
        'rounded-xl2 border px-4 py-3 flex items-start gap-3',
        status === 'success'
          ? 'border-accent-mint/40 bg-accent-mintSoft/60'
          : 'border-accent-blush/40 bg-accent-blushSoft/60',
      )}
    >
      {status === 'success'
        ? <CheckCircle2 className="w-4 h-4 text-[#1f7a4a] mt-0.5 shrink-0" />
        : <AlertTriangle className="w-4 h-4 text-[#9c4651] mt-0.5 shrink-0" />
      }
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink">
          {status === 'success'
            ? `Amazon Ads connected for ${clientName ?? 'this client'}`
            : `Amazon connection failed`}
        </div>
        <div className="text-xs text-ink-mute mt-0.5">
          {status === 'success'
            ? 'First sync runs within the next 6 hours, or trigger it now from the Reporting Dashboard.'
            : (errorMessage ?? 'Amazon returned an error. Try again or check the logs.')}
        </div>
      </div>
      <button onClick={onDismiss} className="text-ink-faint hover:text-ink text-2xs">
        Dismiss
      </button>
    </div>
  )
}
