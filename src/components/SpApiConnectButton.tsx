// "Connect Seller Central" button per client — SP-API authorization.
// Mirrors AmazonConnectButton but for the Selling Partner API.

import React, { useState } from 'react'
import { Store, Link2Off, AlertTriangle, CheckCircle2, Lock } from 'lucide-react'
import { Pill, Button } from './ui'
import {
  buildConsentUrl, deleteSpApiConnection, isSpApiConfigured, SPAPI_DRAFT_MODE, type SpApiConnection,
} from '../lib/spapi'
import { getSupabase, isSupabaseConfigured } from '../lib/supabase'
import { relativeTime } from '../lib/format'
import type { Client } from '../types'

export function SpApiConnectButton({
  client, connection, onChanged,
}: {
  client: Client
  connection: SpApiConnection | undefined
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (!isSupabaseConfigured()) {
    return <Pill tone="mute"><Lock className="w-3 h-3" />Local-only</Pill>
  }
  if (!isSpApiConfigured()) {
    return (
      <span title="Set VITE_SPAPI_APPLICATION_ID (the SP-API app id from Seller Central) to enable Seller Central connections.">
        <Pill tone="mute"><Lock className="w-3 h-3" />Not configured</Pill>
      </span>
    )
  }

  const startConnect = async () => {
    setBusy(true); setErr(null)
    try {
      const sb = getSupabase()
      const { data } = await sb!.auth.getSession()
      const token = data.session?.access_token
      if (!token) { setErr('Sign in first.'); setBusy(false); return }
      const url = buildConsentUrl({
        supabaseAccessToken: token,
        appClientId: client.id,
        appClientName: client.name,
        region: 'NA',
        draftMode: SPAPI_DRAFT_MODE,
      })
      window.location.assign(url)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const startDisconnect = async () => {
    if (!confirm(`Disconnect Seller Central for ${client.name}?`)) return
    setBusy(true); setErr(null)
    const { error } = await deleteSpApiConnection(client.id)
    if (error) setErr(error)
    onChanged()
    setBusy(false)
  }

  if (!connection) {
    return (
      <div className="flex items-center gap-2">
        <Button onClick={startConnect} disabled={busy} variant="secondary" icon={<Store className="w-3.5 h-3.5" />}>
          Connect Seller Central
        </Button>
        {err && <span className="text-2xs text-[#9c4651]" title={err}><AlertTriangle className="w-3 h-3 inline" /> {err}</span>}
      </div>
    )
  }

  const hasError = Boolean(connection.last_sync_error)
  const label = connection.last_synced_at ? `synced ${relativeTime(connection.last_synced_at)}` : 'awaiting first sync'

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {hasError ? (
        <Pill tone="gold"><AlertTriangle className="w-3 h-3" />Re-auth needed</Pill>
      ) : (
        <Pill tone="mint"><CheckCircle2 className="w-3 h-3" />Seller Central</Pill>
      )}
      <span className="text-2xs text-ink-faint tnum">{label}</span>
      {hasError && (
        <Button onClick={startConnect} variant="secondary" disabled={busy} icon={<Store className="w-3.5 h-3.5" />}>
          Re-authorize
        </Button>
      )}
      <button onClick={startDisconnect} disabled={busy} className="text-ink-faint hover:text-[#9c4651] p-1.5 rounded-md disabled:opacity-50" title="Disconnect" aria-label="Disconnect Seller Central">
        <Link2Off className="w-3.5 h-3.5" />
      </button>
      {connection.last_sync_error && (
        <span className="block w-full text-2xs text-[#8b6a18] mt-1">Last sync error: {connection.last_sync_error}</span>
      )}
    </div>
  )
}
