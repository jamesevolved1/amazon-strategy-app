// Frontend caller for the amazon-optimize Edge Function. Two-phase: kick off the
// (slow) performance report, then poll until the joined keyword entities return.

import { getCurrentAccessToken } from './amazon'
import { isSupabaseConfigured } from './supabase'
import type { OptEntity } from '../utils/bidOptimizer'

export interface OptimizerPull {
  entities: OptEntity[]
  keywordBids: number
  perfRows: number
  capped: boolean
}

async function call(body: Record<string, unknown>): Promise<any> {
  const token = await getCurrentAccessToken()
  if (!token) throw new Error('Not signed in.')
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (!supabaseUrl) throw new Error('Missing VITE_SUPABASE_URL.')
  const resp = await fetch(`${supabaseUrl}/functions/v1/amazon-optimize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(j.error || `HTTP ${resp.status}`)
  return j
}

export async function pullOptimizerData(
  clientId: string,
  marketplace: string,
  onProgress?: (msg: string) => void,
): Promise<OptimizerPull> {
  if (!isSupabaseConfigured()) throw new Error('Supabase is not configured.')
  onProgress?.('Requesting performance report from Amazon…')
  const started = await call({ action: 'start', client_id: clientId, marketplace })
  const reportId = started.reportId
  if (!reportId) throw new Error('Could not start the report.')

  onProgress?.('Amazon is generating the report (this takes 1–3 minutes)…')
  const deadline = Date.now() + 5 * 60 * 1000
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 8000))
    const res = await call({ action: 'result', client_id: clientId, marketplace, reportId })
    if (res.status === 'done') {
      onProgress?.('Joining bids to performance…')
      return { entities: res.entities ?? [], keywordBids: res.keywordBids ?? 0, perfRows: res.perfRows ?? 0, capped: !!res.capped }
    }
    if (res.status === 'FAILED') throw new Error('Amazon report failed: ' + (res.failureReason || 'unknown'))
  }
  throw new Error('Timed out waiting for Amazon to generate the report. Try again in a minute.')
}
