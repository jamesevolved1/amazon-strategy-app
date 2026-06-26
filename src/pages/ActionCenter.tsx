// Action Center — the decision engine's review workflow. Reads the current
// client's live campaign performance + goals, shows a verdict, account health,
// and a prioritized list of moves. Each move can be Approved / Denied and
// annotated; decisions persist per client. Approved moves push to the
// Optimization Calendar.

import React, { useMemo, useState } from 'react'
import {
  Zap, TrendingUp, TrendingDown, Ban, SlidersHorizontal, Eye, Lightbulb, Check, X, CalendarPlus, Info,
} from 'lucide-react'
import { Panel, EmptyState, Button, cx } from '../components/ui'
import { useStore } from '../lib/store'
import { useClientCampaigns } from '../lib/campaignData'
import { useSpApiConnections } from '../lib/spapi'
import { currencyWhole, multiplier, percent, num } from '../lib/format'
import { buildActionReport, type Action, type ActionKind, type Status } from '../utils/recommendations'
import type { OptCategory } from '../types'

const KIND_META: Record<ActionKind, { icon: React.ReactNode; category: OptCategory }> = {
  negate:   { icon: <Ban className="w-4 h-4" />,              category: 'campaign' },
  reduce:   { icon: <TrendingDown className="w-4 h-4" />,     category: 'bid' },
  scale:    { icon: <TrendingUp className="w-4 h-4" />,       category: 'bid' },
  fix_bids: { icon: <SlidersHorizontal className="w-4 h-4" />, category: 'bid' },
  low_ctr:  { icon: <Eye className="w-4 h-4" />,              category: 'creatives' },
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

// Priority groups (engine already sorts globally; we just bucket for headers).
const GROUPS: Array<{ label: string; kinds: ActionKind[] }> = [
  { label: 'Stop the bleeding', kinds: ['negate', 'reduce'] },
  { label: 'Grow winners',      kinds: ['scale'] },
  { label: 'Tune & fix',        kinds: ['fix_bids', 'low_ctr'] },
]

export function ActionCenter() {
  const { currentClient, currentBundle, addTask, setActionDecision } = useStore()
  const campaigns = useClientCampaigns()
  const { connections: spapiConnections } = useSpApiConnections()
  const [addedCount, setAddedCount] = useState<number | null>(null)

  const ccy = currentClient?.currency ?? 'USD'
  const fmt = (n: number) => currencyWhole(n, ccy)

  const totalSales = useMemo(() => {
    if (!currentClient) return null
    const conn = spapiConnections.find(c => c.app_client_id === currentClient.id)
    const daily = conn?.synced_data?.daily ?? []
    if (!daily.length) return null
    const cutoff = isoDaysAgo(30)
    const s = daily.filter(d => d.date >= cutoff).reduce((acc, d) => acc + (d.totalSales || 0), 0)
    return s > 0 ? s : null
  }, [spapiConnections, currentClient?.id])

  const report = useMemo(
    () => (currentBundle ? buildActionReport(campaigns, currentBundle.goals, { totalSales, fmt }) : null),
    [campaigns, currentBundle?.goals, totalSales, ccy],
  )

  if (!currentClient || !currentBundle || !report) return <EmptyState title="No client selected" />

  const { summary, actions } = report
  const decisions = currentBundle.actionDecisions ?? {}
  const statusOf = (a: Action) => decisions[a.key]?.status
  const approved = actions.filter(a => statusOf(a) === 'approved')
  const denied = actions.filter(a => statusOf(a) === 'denied')
  const pending = actions.length - approved.length - denied.length

  function decide(a: Action, status: 'approved' | 'denied') {
    const cur = decisions[a.key]?.status
    setActionDecision(a.key, { status: cur === status ? undefined : status })
    setAddedCount(null)
  }
  function saveNote(a: Action, value: string) {
    setActionDecision(a.key, { note: value })
  }
  function addApprovedToCalendar() {
    approved.forEach(a => {
      const note = decisions[a.key]?.note?.trim()
      addTask({
        title: `${a.headline}: ${a.campaign}`.slice(0, 120),
        detail: `${a.detail} → ${a.move}${note ? `  ·  Note: ${note}` : ''}`,
        due: todayIso(),
        completed: false,
        category: KIND_META[a.kind].category,
        cadence: 'oneoff',
      })
    })
    setAddedCount(approved.length)
  }

  const hasData = campaigns.length > 0
  const verdict = buildVerdict(actions)

  return (
    <div className="space-y-5">
      <header>
        <div className="text-xs text-ink-faint flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" /> Action center</div>
        <h1 className="text-xl font-semibold text-ink mt-0.5">{currentClient.name}</h1>
        {hasData && <p className="text-sm text-ink mt-2 max-w-2xl leading-relaxed">{verdict}</p>}
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
          {/* Account health */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Account ROAS" value={multiplier(summary.roas)} sub={summary.targetRoas > 0 ? `target ${multiplier(summary.targetRoas)}` : 'no target set'} status={summary.roasStatus} />
            <Tile label="Budget pace" value={summary.pacePct == null ? '—' : percent(summary.pacePct, 0)} sub={summary.monthlyBudget > 0 ? `of ${fmt(summary.monthlyBudget)}/mo` : 'set a monthly budget'} status={summary.paceStatus} />
            <Tile label="TACOS" value={summary.tacos == null ? '—' : percent(summary.tacos, 1)} sub={summary.tacos == null ? 'connect Seller Central' : `goal ${percent(summary.tacosGoal, 0)} · ceiling ${percent(summary.tacosCeiling, 0)}`} status={summary.tacosStatus} />
            <Tile label="Ad spend → sales" value={fmt(summary.spend)} sub={`${fmt(summary.adSales)} sales · ${num(summary.orders)} orders`} status="none" />
          </div>

          {/* Headline insight */}
          <InsightCallout actions={actions} fmt={fmt} />

          {actions.length === 0 ? (
            <Panel>
              <EmptyState title="All clear — no urgent moves" description="Every live campaign is within your ROAS guardrails right now." />
            </Panel>
          ) : (
            <>
              {/* Review bar */}
              <div className="flex items-center justify-between flex-wrap gap-2 rounded-xl2 border border-line bg-canvas-panel px-4 py-2.5">
                <div className="text-sm text-ink-mute">
                  <span className="font-medium text-[#1f7a4a]">{approved.length} approved</span>
                  <span className="mx-1.5 text-ink-faint">·</span>
                  <span className="font-medium text-[#9c4651]">{denied.length} denied</span>
                  <span className="mx-1.5 text-ink-faint">·</span>
                  <span>{pending} pending</span>
                </div>
                <div className="flex items-center gap-2">
                  {addedCount != null && <span className="text-2xs text-[#1f7a4a] inline-flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Added {addedCount} to calendar</span>}
                  <Button variant="primary" className="!py-1.5 text-xs" icon={<CalendarPlus className="w-3.5 h-3.5" />} disabled={approved.length === 0} onClick={addApprovedToCalendar}>
                    Add {approved.length || ''} approved to Calendar
                  </Button>
                </div>
              </div>

              {/* Grouped moves */}
              {GROUPS.map(group => {
                const items = actions.filter(a => group.kinds.includes(a.kind))
                if (items.length === 0) return null
                return (
                  <div key={group.label} className="space-y-2">
                    <div className="text-xs font-medium text-ink-faint pt-1">{group.label}</div>
                    {items.map(a => (
                      <ActionRow
                        key={a.key}
                        action={a}
                        status={statusOf(a)}
                        note={decisions[a.key]?.note}
                        onDecide={decide}
                        onNote={saveNote}
                      />
                    ))}
                  </div>
                )
              })}
            </>
          )}
        </>
      )}
    </div>
  )
}

function ActionRow({ action: a, status, note, onDecide, onNote }: {
  action: Action
  status?: 'approved' | 'denied'
  note?: string
  onDecide: (a: Action, s: 'approved' | 'denied') => void
  onNote: (a: Action, v: string) => void
}) {
  const approved = status === 'approved'
  const denied = status === 'denied'
  return (
    <Panel padding="p-4" className={cx(denied && 'opacity-60', approved && 'ring-1 ring-[#1f7a4a]/25')}>
      <div className="flex items-start gap-3.5">
        <span className={cx('shrink-0 w-9 h-9 rounded-lg flex items-center justify-center', TONE_CHIP[a.tone])}>
          {KIND_META[a.kind].icon}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cx('text-sm font-semibold text-ink', denied && 'line-through')}>{a.headline}</span>
            <span className="text-2xs px-1.5 py-0.5 rounded-full bg-[#f1f2f5] text-ink-mute">{a.type}</span>
            <span className="text-sm text-ink-mute truncate">{a.campaign}</span>
            {approved && <span className="text-2xs px-1.5 py-0.5 rounded-full bg-accent-mintSoft text-[#1f7a4a] font-medium">Approved</span>}
            {denied && <span className="text-2xs px-1.5 py-0.5 rounded-full bg-accent-blushSoft text-[#9c4651] font-medium">Denied</span>}
          </div>
          <p className="text-sm text-ink mt-1.5">{a.detail}</p>
          <p className="text-xs text-ink-mute mt-1 flex items-center gap-1"><Info className="w-3 h-3 shrink-0" /> {a.move}</p>
        </div>
        <span className={cx('shrink-0 text-2xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap', TONE_CHIP[a.tone])}>
          {a.impactLabel}
        </span>
      </div>

      <div className="mt-3 flex items-start gap-2">
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={() => onDecide(a, 'approved')}
            className={cx('inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              approved ? 'bg-accent-mintSoft text-[#1f7a4a] border-[#1f7a4a]/30' : 'border-line text-ink-mute hover:text-ink hover:bg-[#f4f5f8]')}
          >
            <Check className="w-3.5 h-3.5" /> Approve
          </button>
          <button
            onClick={() => onDecide(a, 'denied')}
            className={cx('inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
              denied ? 'bg-accent-blushSoft text-[#9c4651] border-[#9c4651]/30' : 'border-line text-ink-mute hover:text-ink hover:bg-[#f4f5f8]')}
          >
            <X className="w-3.5 h-3.5" /> Deny
          </button>
        </div>
        <textarea
          defaultValue={note ?? ''}
          onBlur={e => onNote(a, e.target.value)}
          rows={1}
          placeholder="Add a note — e.g. raise bids only 10%, unsure"
          className="flex-1 min-w-0 resize-y rounded-lg border border-line bg-canvas-panel text-xs text-ink px-2.5 py-1.5 leading-relaxed focus:outline-none focus:ring-2 focus:ring-ink/15 focus:border-ink/20"
        />
      </div>
    </Panel>
  )
}

function Tile({ label, value, sub, status }: { label: string; value: string; sub: string; status: Status }) {
  return (
    <Panel padding="p-4">
      <div className="text-2xs font-medium text-ink-faint uppercase tracking-wide">{label}</div>
      <div className={cx('text-2xl font-semibold mt-1 tnum', STATUS_TEXT[status])}>{value}</div>
      <div className="text-2xs text-ink-mute mt-0.5">{sub}</div>
    </Panel>
  )
}

function InsightCallout({ actions, fmt }: { actions: Action[]; fmt: (n: number) => string }) {
  const leak = actions.find(a => a.kind === 'negate' || a.kind === 'reduce')
  const lever = actions.find(a => a.kind === 'scale')
  if (!leak && !lever) return null
  return (
    <div className="rounded-xl2 border border-accent-peri/30 bg-accent-periSoft/50 px-4 py-3 flex gap-2.5">
      <Lightbulb className="w-4 h-4 text-[#3b48a5] shrink-0 mt-0.5" />
      <p className="text-sm text-ink leading-relaxed">
        <span className="font-medium text-[#3b48a5]">Biggest lever vs. biggest leak. </span>
        {lever && <>Your top performer is <span className="font-medium">{lever.campaign}</span> at {multiplier(lever.roas)} — push it{leak ? '. ' : '.'}</>}
        {leak && <>Meanwhile <span className="font-medium">{leak.campaign}</span> is your biggest drain ({leak.impactLabel}) — handle it first.</>}
      </p>
    </div>
  )
}

function buildVerdict(actions: Action[]): string {
  if (actions.length === 0) return 'Every live campaign is within your ROAS guardrails — nothing urgent this week.'
  const top = actions[0]
  const n = actions.length
  return `${n} move${n === 1 ? '' : 's'} recommended this week. Start with ${top.headline.toLowerCase()} on ${top.campaign} (${top.impactLabel}), then work down — review each, approve or deny, and add notes before you act.`
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function isoDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
