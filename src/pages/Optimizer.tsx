// Optimizer — on-demand bid optimization. Pulls live keyword bids + performance,
// runs the ROAS engine, lets you review/edit/approve each change, then exports an
// Amazon bulk upload sheet + a reverse (rollback) sheet and logs every change.

import React, { useMemo, useState } from 'react'
import { Wand2, TrendingUp, TrendingDown, Ban, Download, RotateCcw, Play, Check, X, History } from 'lucide-react'
import { Panel, EmptyState, Button, Pill, cx, NumberField } from '../components/ui'
import { useStore, cryptoRandomId } from '../lib/store'
import { useClientCampaigns } from '../lib/campaignData'
import { pullOptimizerData } from '../lib/optimize'
import { optimizeBids, defaultSettings, type OptEntity, type OptSettings, type BidChange } from '../utils/bidOptimizer'
import { downloadBulkSheet, downloadReverseSheet } from '../utils/optimizerExport'
import { currency, currencyWhole, multiplier, num } from '../lib/format'
import type { ChangeLogEntry, Currency } from '../types'

type Phase = 'idle' | 'running' | 'ready' | 'error'
interface Decision { denied?: boolean; override?: number; note?: string }

const ACTION_META = {
  raise:  { label: 'Raise',  icon: <TrendingUp className="w-4 h-4" />,   chip: 'bg-accent-mintSoft text-[#1f7a4a]' },
  lower:  { label: 'Lower',  icon: <TrendingDown className="w-4 h-4" />, chip: 'bg-accent-goldSoft text-[#8b6a18]' },
  negate: { label: 'Pause',  icon: <Ban className="w-4 h-4" />,          chip: 'bg-accent-blushSoft text-[#9c4651]' },
} as const

export function Optimizer() {
  const { currentClient, currentBundle, addChangeLogEntries } = useStore()
  const campaigns = useClientCampaigns()

  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [entities, setEntities] = useState<OptEntity[]>([])
  const [meta, setMeta] = useState<{ keywordBids: number; perfRows: number; capped: boolean } | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [exported, setExported] = useState<number | null>(null)
  const [settings, setSettings] = useState<OptSettings>(() => defaultSettings(currentBundle?.goals.targetRoas ?? 4))
  const [brandText, setBrandText] = useState('')

  const ccy = currentClient?.currency ?? 'USD'
  const campName = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of campaigns) if (c.campaignId) m.set(String(c.campaignId), c.campaign)
    return m
  }, [campaigns])

  const effSettings: OptSettings = useMemo(
    () => ({ ...settings, brandTerms: brandText.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) }),
    [settings, brandText],
  )
  const result = useMemo(() => optimizeBids(entities, effSettings), [entities, effSettings])

  if (!currentClient || !currentBundle) return <EmptyState title="No client selected" />
  const client = currentClient
  const bundle = currentBundle

  async function run() {
    setPhase('running'); setErrorMsg(''); setExported(null); setDecisions({})
    try {
      const pull = await pullOptimizerData(client.id, client.marketplace, setProgress)
      setEntities(pull.entities)
      setMeta({ keywordBids: pull.keywordBids, perfRows: pull.perfRows, capped: pull.capped })
      setPhase('ready')
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e)); setPhase('error')
    }
  }

  const setDec = (id: string, patch: Decision) => setDecisions(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  const approvedChanges = result.changes.filter(c => !decisions[c.id]?.denied)

  function exportChanges() {
    const finals: BidChange[] = approvedChanges.map(c => ({
      ...c,
      newBid: c.action === 'negate' ? null : (decisions[c.id]?.override ?? c.newBid),
    }))
    if (!finals.length) return
    const slug = client.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client'
    const stamp = new Date().toISOString().slice(0, 10)
    const batchId = cryptoRandomId()
    downloadBulkSheet(finals, `${slug}-bid-changes-${stamp}.xlsx`)
    downloadReverseSheet(finals, `${slug}-REVERSE-${stamp}.xlsx`)
    const log: ChangeLogEntry[] = finals.map(c => ({
      id: cryptoRandomId(), date: new Date().toISOString(), marketplace: client.marketplace,
      entityKind: c.kind, campaignId: c.campaignId, text: c.text, matchType: c.matchType,
      action: c.action as 'raise' | 'lower' | 'negate', fromBid: c.currentBid, toBid: c.newBid, note: decisions[c.id]?.note, batchId,
    }))
    addChangeLogEntries(log)
    setExported(finals.length)
  }

  const groups: Array<{ key: 'negate' | 'raise' | 'lower'; title: string }> = [
    { key: 'negate', title: 'Pause — wasted spend' },
    { key: 'raise', title: 'Raise — underbid winners' },
    { key: 'lower', title: 'Lower — overbid' },
  ]

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-xs text-ink-faint flex items-center gap-1.5"><Wand2 className="w-3.5 h-3.5" /> Optimizer</div>
          <h1 className="text-xl font-semibold text-ink mt-0.5">{currentClient.name}</h1>
          <p className="text-sm text-ink-mute mt-1">Pull live keyword bids + performance, review the ROAS-based changes, then export an upload sheet, a rollback file, and a change log.</p>
        </div>
        <Button variant="primary" icon={phase === 'running' ? undefined : <Play className="w-4 h-4" />} disabled={phase === 'running'} onClick={run}>
          {phase === 'running' ? 'Running…' : phase === 'ready' ? 'Re-run' : 'Run optimizer'}
        </Button>
      </header>

      {phase === 'running' && (
        <Panel><div className="py-6 text-center"><div className="inline-block w-5 h-5 rounded-full border-2 border-ink/15 border-t-ink animate-spin" /><p className="text-sm text-ink-mute mt-3">{progress || 'Working…'}</p><p className="text-2xs text-ink-faint mt-1">Amazon's report can take a few minutes — keep this tab open.</p></div></Panel>
      )}
      {phase === 'error' && (
        <Panel><div className="py-4 text-center"><p className="text-sm text-[#9c4651]">{errorMsg}</p><Button variant="secondary" className="mt-3" onClick={run}>Try again</Button></div></Panel>
      )}
      {phase === 'idle' && (
        <Panel><EmptyState title="Ready to optimize" description={`Click "Run optimizer" to pull ${currentClient.name}'s current keyword bids and last-30-day performance and compute bid + negation changes against your ROAS goals.`} /></Panel>
      )}

      {phase === 'ready' && (
        <>
          {/* Settings */}
          <Panel>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 items-end">
              <NumberField label="Target ROAS" value={settings.targetRoas} onChange={v => setSettings(s => ({ ...s, targetRoas: v }))} step="0.1" suffix="×" />
              <NumberField label="Min CPC" value={settings.minCpc} onChange={v => setSettings(s => ({ ...s, minCpc: v }))} step="0.05" prefix="$" />
              <NumberField label="Max CPC" value={settings.maxCpc} onChange={v => setSettings(s => ({ ...s, maxCpc: v }))} step="0.25" prefix="$" />
              <NumberField label="Safety cap" value={Math.round(settings.safetyCapPct * 100)} onChange={v => setSettings(s => ({ ...s, safetyCapPct: v / 100 }))} step="5" suffix="%" />
              <label className="block">
                <span className="block text-xs font-medium text-ink-mute mb-1.5">Brand terms (protected)</span>
                <input value={brandText} onChange={e => setBrandText(e.target.value)} placeholder="red land, lands, rlc" className="w-full rounded-lg border border-line bg-canvas-panel text-sm text-ink px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ink/15" />
              </label>
            </div>
            {meta?.capped && <p className="text-2xs text-[#8b6a18] mt-2">Note: this account has a very large keyword count — some low-traffic keywords beyond the pull limit were skipped.</p>}
          </Panel>

          {/* Summary + export */}
          <div className="flex items-center justify-between flex-wrap gap-3 rounded-xl2 border border-line bg-canvas-panel px-4 py-3">
            <div className="text-sm text-ink-mute">
              <span className="font-medium text-[#1f7a4a]">{result.raises} raises</span><span className="mx-1.5 text-ink-faint">·</span>
              <span className="font-medium text-[#8b6a18]">{result.lowers} lowers</span><span className="mx-1.5 text-ink-faint">·</span>
              <span className="font-medium text-[#9c4651]">{result.negations} pauses</span>
              <span className="mx-1.5 text-ink-faint">·</span><span>{currencyWhole(result.negateSpend, ccy)} wasted spend flagged</span>
            </div>
            <div className="flex items-center gap-2">
              {exported != null && <span className="text-2xs text-[#1f7a4a] inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Exported {exported} (+ reverse + log)</span>}
              <Button variant="primary" icon={<Download className="w-3.5 h-3.5" />} disabled={approvedChanges.length === 0} onClick={exportChanges}>
                Export {approvedChanges.length || ''} approved
              </Button>
            </div>
          </div>

          {result.changes.length === 0 ? (
            <Panel><EmptyState title="No changes needed" description="Every keyword with enough data is within your guardrails. Loosen the safety cap or adjust target ROAS to surface finer moves." /></Panel>
          ) : (
            groups.map(g => {
              const items = result.changes.filter(c => c.action === g.key)
              if (!items.length) return null
              return (
                <div key={g.key} className="space-y-2">
                  <div className="text-xs font-medium text-ink-faint pt-1">{g.title} ({items.length})</div>
                  {items.map(c => (
                    <ChangeRow key={c.id} c={c} ccy={ccy} campaign={campName.get(c.campaignId)} decision={decisions[c.id]} onDecide={setDec} />
                  ))}
                </div>
              )
            })
          )}
        </>
      )}

      <ChangeLogPanel log={bundle.changeLog ?? []} ccy={ccy} />
    </div>
  )
}

function ChangeRow({ c, ccy, campaign, decision, onDecide }: {
  c: BidChange; ccy: Currency; campaign?: string; decision?: Decision
  onDecide: (id: string, patch: Decision) => void
}) {
  const denied = !!decision?.denied
  const meta = ACTION_META[c.action as 'raise' | 'lower' | 'negate']
  return (
    <Panel padding="p-3.5" className={cx(denied && 'opacity-55')}>
      <div className="flex items-start gap-3">
        <span className={cx('shrink-0 w-8 h-8 rounded-lg flex items-center justify-center', meta.chip)}>{meta.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cx('text-sm font-medium text-ink', denied && 'line-through')}>{c.text}</span>
            {c.matchType && <Pill tone="mute">{c.matchType}</Pill>}
            {c.isBrand && <Pill tone="peri">brand</Pill>}
            {campaign && <span className="text-2xs text-ink-faint truncate">{campaign}</span>}
          </div>
          <div className="text-2xs text-ink-mute mt-1 tnum">
            {num(c.clicks)} clicks · {currencyWhole(c.cost, ccy)} spend · {currencyWhole(c.sales, ccy)} sales · ROAS {multiplier(c.roas)} · {c.reason}
          </div>
        </div>
        {/* Bid edit */}
        <div className="shrink-0 flex items-center gap-2">
          {c.action === 'negate' ? (
            <span className="text-sm font-medium text-[#9c4651]">Pause</span>
          ) : (
            <div className="flex items-center gap-1 text-sm tnum">
              <span className="text-ink-faint">{currency(c.currentBid, ccy)}</span>
              <span className="text-ink-faint">→</span>
              <input
                type="number" step="0.05" defaultValue={c.newBid ?? c.currentBid}
                onBlur={e => onDecide(c.id, { override: Number(e.target.value) || undefined })}
                className="w-16 rounded-md border border-line bg-canvas-panel text-sm text-ink px-1.5 py-1 text-right focus:outline-none focus:ring-2 focus:ring-ink/15"
              />
            </div>
          )}
          <div className="flex gap-1">
            <button onClick={() => onDecide(c.id, { denied: false })} title="Approve" className={cx('w-7 h-7 rounded-md flex items-center justify-center border', !denied ? 'bg-accent-mintSoft text-[#1f7a4a] border-[#1f7a4a]/30' : 'border-line text-ink-faint hover:text-ink')}><Check className="w-3.5 h-3.5" /></button>
            <button onClick={() => onDecide(c.id, { denied: true })} title="Deny" className={cx('w-7 h-7 rounded-md flex items-center justify-center border', denied ? 'bg-accent-blushSoft text-[#9c4651] border-[#9c4651]/30' : 'border-line text-ink-faint hover:text-ink')}><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </div>
      <input
        defaultValue={decision?.note ?? ''} onBlur={e => onDecide(c.id, { note: e.target.value })}
        placeholder="Note — e.g. raise only 10%, unsure"
        className="mt-2 w-full rounded-lg border border-line bg-canvas-panel text-xs text-ink px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-ink/15"
      />
    </Panel>
  )
}

function ChangeLogPanel({ log, ccy }: { log: ChangeLogEntry[]; ccy: Currency }) {
  const [open, setOpen] = useState(false)
  if (log.length === 0) return null
  const shown = open ? log.slice(0, 100) : log.slice(0, 6)
  return (
    <Panel>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between">
        <span className="text-sm font-medium text-ink flex items-center gap-2"><History className="w-4 h-4 text-ink-faint" /> Change log ({log.length})</span>
        <span className="text-2xs text-ink-faint">{open ? 'collapse' : 'show all'}</span>
      </button>
      <div className="mt-3 space-y-1.5">
        {shown.map(e => (
          <div key={e.id} className="flex items-center gap-2 text-2xs text-ink-mute tnum border-t border-line pt-1.5 first:border-0 first:pt-0">
            <span className="text-ink-faint w-16 shrink-0">{e.date.slice(0, 10)}</span>
            <span className={cx('w-12 shrink-0 font-medium', e.action === 'raise' ? 'text-[#1f7a4a]' : e.action === 'lower' ? 'text-[#8b6a18]' : 'text-[#9c4651]')}>{e.action}</span>
            <span className="flex-1 truncate text-ink">{e.text}</span>
            <span className="shrink-0">{e.action === 'negate' ? 'paused' : `${currency(e.fromBid, ccy)} → ${currency(e.toBid ?? 0, ccy)}`}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}
