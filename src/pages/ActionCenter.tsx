// Action Center — the decision engine's UI. Reads the current client's live
// campaign performance + goals and shows a prioritized list of this week's
// moves (scale / cut / tune / fix). Each move can be pushed straight into the
// Optimization Calendar as a tracked task.

import React, { useMemo, useState } from 'react'
import {
  Zap, TrendingUp, TrendingDown, Ban, SlidersHorizontal, Eye, Plus, Check, Info,
} from 'lucide-react'
import { Panel, SectionHeader, Pill, Button, EmptyState, cx } from '../components/ui'
import { useStore } from '../lib/store'
import { useClientCampaigns } from '../lib/campaignData'
import { useSpApiConnections } from '../lib/spapi'
import { currencyWhole, multiplier, percent, num } from '../lib/format'
import { buildActionReport, type Action, type ActionKind, type Status } from '../utils/recommendations'
import type { OptCategory } from '../types'

const KIND_META: Record<ActionKind, { label: string; icon: React.ReactNode; category: OptCategory }> = {
  negate:   { label: 'Cut waste',  icon: <Ban className="w-4 h-4" />,             category: 'campaign' },
  reduce:   { label: 'Reduce',     icon: <TrendingDown className="w-4 h-4" />,     category: 'bid' },
  scale:    { label: 'Scale',      icon: <TrendingUp className="w-4 h-4" />,       category: 'bid' },
  fix_bids: { label: 'Tune bids',  icon: <SlidersHorizontal className="w-4 h-4" />, category: 'bid' },
  low_ctr:  { label: 'Creative',   icon: <Eye className="w-4 h-4" />,              category: 'creatives' },
}

const TONE_CHIP: Record<Action['tone'], string> = {
  mint:  'bg-accent-mintSoft text-[#1f7a4a]',
  blush: 'bg-accent-blushSoft text-[#9c4651]',
  gold:  'bg-accent-goldSoft text-[#8b6a18]',
  peri:  'bg-accent-periSoft text-[#3b48a5]',
}

const STATUS_TEXT: Record<Status, string> = {
  good: 'text-[#1f7a4a]', warn: 'text-[#8b6a18]', bad: 'text-[#9c4651]', none: 'text-ink',
}

export function ActionCenter() {
  const { currentClient, currentBundle, addTask } = useStore()
  const campaigns = useClientCampaigns()
  const { connections: spapiConnections } = useSpApiConnections()
  const [added, setAdded] = useState<Record<string, boolean>>({})

  if (!currentClient || !currentBundle) return <EmptyState title="No client selected" />

  const ccy = currentClient.currency
  const fmt = (n: number) => currencyWhole(n, ccy)

  // Total sales over the last 30 days (aligns with the rolling ad window) for TACOS.
  const totalSales = useMemo(() => {
    const conn = spapiConnections.find(c => c.app_client_id === currentClient.id)
    const daily = conn?.synced_data?.daily ?? []
    if (!daily.length) return null
    const cutoff = isoDaysAgo(30)
    const s = daily.filter(d => d.date >= cutoff).reduce((acc, d) => acc + (d.totalSales || 0), 0)
    return s > 0 ? s : null
  }, [spapiConnections, currentClient.id])

  const report = useMemo(
    () => buildActionReport(campaigns, currentBundle.goals, { totalSales, fmt }),
    [campaigns, currentBundle.goals, totalSales, ccy],
  )

  const { summary, actions, considered } = report

  function pushToCalendar(a: Action) {
    addTask({
      title: `${a.headline}: ${a.campaign}`.slice(0, 120),
      detail: `${a.detail} → ${a.move}`,
      due: todayIso(),
      completed: false,
      category: KIND_META[a.kind].category,
      cadence: 'oneoff',
    })
    setAdded(prev => ({ ...prev, [a.id]: true }))
  }

  const hasData = campaigns.length > 0

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink flex items-center gap-2">
            <Zap className="w-5 h-5 text-accent-peri" /> Action Center
          </h1>
          <p className="text-sm text-ink-mute mt-0.5">
            This week's highest-leverage moves for <span className="font-medium text-ink">{currentClient.name}</span>, ranked by impact.
          </p>
        </div>
        {hasData && (
          <Pill tone="mute">{considered} live {considered === 1 ? 'campaign' : 'campaigns'} analyzed</Pill>
        )}
      </header>

      {!hasData ? (
        <Panel>
          <EmptyState
            title="No campaign data yet"
            description="Sync this client's Amazon Ads account (Reporting Dashboard → Sync) or upload a bulk campaign export, then come back for your prioritized moves."
          />
        </Panel>
      ) : (
        <>
          {/* Account summary */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryTile
              label="Account ROAS"
              value={multiplier(summary.roas)}
              sub={summary.targetRoas > 0 ? `target ${multiplier(summary.targetRoas)}` : 'no target set'}
              status={summary.roasStatus}
            />
            <SummaryTile
              label="Budget pace"
              value={summary.pacePct == null ? '—' : percent(summary.pacePct, 0)}
              sub={summary.monthlyBudget > 0 ? `of ${fmt(summary.monthlyBudget)}/mo` : 'set a monthly budget'}
              status={summary.paceStatus}
            />
            <SummaryTile
              label="TACOS"
              value={summary.tacos == null ? '—' : percent(summary.tacos, 1)}
              sub={summary.tacos == null
                ? 'connect Seller Central'
                : `goal ${percent(summary.tacosGoal, 0)} · ceiling ${percent(summary.tacosCeiling, 0)}`}
              status={summary.tacosStatus}
            />
            <SummaryTile
              label="Ad spend → sales"
              value={fmt(summary.spend)}
              sub={`${fmt(summary.adSales)} ad sales · ${num(summary.orders)} orders`}
              status="none"
            />
          </div>

          {/* Actions */}
          {actions.length === 0 ? (
            <Panel>
              <EmptyState
                title="All clear — no urgent moves"
                description="Every live campaign is within your ROAS guardrails right now. Set or tighten goals on the Clients page to surface finer-grained opportunities."
              />
            </Panel>
          ) : (
            <div className="space-y-2.5">
              <SectionHeader title={`${actions.length} recommended ${actions.length === 1 ? 'move' : 'moves'}`} sub="Ranked: stop waste → cut losers → scale winners → tune → fix creative." />
              {actions.map(a => {
                const meta = KIND_META[a.kind]
                const isAdded = added[a.id]
                return (
                  <Panel key={a.id} padding="p-4">
                    <div className="flex items-start gap-3.5">
                      <span className={cx('shrink-0 w-9 h-9 rounded-lg flex items-center justify-center', TONE_CHIP[a.tone])}>
                        {meta.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-ink">{a.headline}</span>
                          <Pill tone="mute">{a.type}</Pill>
                          <span className="text-sm text-ink-mute truncate">{a.campaign}</span>
                        </div>
                        <p className="text-sm text-ink mt-1.5">{a.detail}</p>
                        <p className="text-xs text-ink-mute mt-1 flex items-center gap-1">
                          <Info className="w-3 h-3 shrink-0" /> {a.move}
                        </p>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-2">
                        <span className={cx('text-2xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap', TONE_CHIP[a.tone])}>
                          {a.impactLabel}
                        </span>
                        {isAdded ? (
                          <span className="inline-flex items-center gap-1 text-2xs text-[#1f7a4a] font-medium">
                            <Check className="w-3.5 h-3.5" /> Added
                          </span>
                        ) : (
                          <Button variant="secondary" className="!px-2.5 !py-1 text-xs" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => pushToCalendar(a)}>
                            Calendar
                          </Button>
                        )}
                      </div>
                    </div>
                  </Panel>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SummaryTile({ label, value, sub, status }: { label: string; value: string; sub: string; status: Status }) {
  return (
    <Panel padding="p-4">
      <div className="text-2xs font-medium text-ink-faint uppercase tracking-wide">{label}</div>
      <div className={cx('text-2xl font-semibold mt-1 tnum', STATUS_TEXT[status])}>{value}</div>
      <div className="text-2xs text-ink-mute mt-0.5">{sub}</div>
    </Panel>
  )
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function isoDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
