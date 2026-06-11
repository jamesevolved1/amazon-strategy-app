// Ad Potential: editable baseline + editable click-driven scenarios.
// ROAS is the headline metric. No ACOS anywhere. TACOS is a guardrail.

import React, { useMemo, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Sparkles, TrendingUp, Wallet,
  Activity, ShoppingCart, Eye, Plus, Trash2, Target, RotateCcw,
} from 'lucide-react'
import { Panel, Pill, EmptyState, NumberField, cx, Button } from '../components/ui'
import { KPICard } from '../components/KPICard'
import { useStore } from '../lib/store'
import { runFunnel, runFunnelByClicks, type FunnelInputs } from '../utils/adPotential'
import { currency, num, percent } from '../lib/format'
import { totalsFromSeries } from '../utils/pnl'
import { resolveRange, sliceSeries } from '../utils/dateRange'
import type { BulkCampaignData } from '../utils/parsers'
import type { Currency, DailySeriesPoint } from '../types'

interface Baseline {
  cpc: number
  ctr: number          // %
  cvr: number          // %
  aov: number
  organicLiftRatio: number
}

interface Scenario {
  id: string
  label: string
  clicks: number
}

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `s-${Math.random().toString(36).slice(2, 8)}`
}

export function AdPotential() {
  const { currentClient, currentBundle } = useStore()

  if (!currentClient || !currentBundle) return <EmptyState title="No client selected" />

  const goals = currentBundle.goals
  const bulk = currentBundle.reports.bulkCampaigns?.parsed as BulkCampaignData | undefined
  const series = (bulk?.daily ?? []) as DailySeriesPoint[]
  const range = resolveRange(series, '30d')
  const totals = range ? totalsFromSeries(sliceSeries(series, range.start, range.end), range.days) : null
  const haveSync = Boolean(totals && totals.spend > 0)

  // Editable baseline metrics (the unit economics)
  const [baseline, setBaseline] = useState<Baseline>(() => ({
    cpc: round2(totals?.cpc) || 1,
    ctr: round2(totals?.ctr) || 0.5,
    cvr: round2(totals?.cvr) || 10,
    aov: totals && totals.orders > 0 ? round2(totals.adSales / totals.orders) : 35,
    organicLiftRatio: 0.6,
  }))

  // Editable target ROAS (defaults from goals, but the user can override here
  // to test alternate plans without changing the persisted goal).
  const [targetRoas, setTargetRoas] = useState<number>(() => goals.targetRoas || 5)
  const [minRoas, setMinRoas] = useState<number>(() => goals.minimumAcceptableRoas || 3)

  const inputs: FunnelInputs = useMemo(() => ({
    budget: goals.monthlyAdBudget || 0,
    cpc: baseline.cpc,
    ctr: baseline.ctr,
    cvr: baseline.cvr,
    aov: baseline.aov,
    organicLiftRatio: baseline.organicLiftRatio,
    targetRoas,
    minRoas,
    primaryTacos: goals.primaryTacosGoal || 12,
    ceilingTacos: goals.acceptableTacosCeiling || 18,
  }), [baseline, goals, targetRoas, minRoas])

  // Scenarios — editable, click-driven. Default-seeded against the goal budget.
  const goalClicks = inputs.cpc > 0 ? Math.round((goals.monthlyAdBudget || 5000) / inputs.cpc / 250) * 250 : 5000
  const [scenarios, setScenarios] = useState<Scenario[]>(() => [
    { id: randomId(), label: 'Pull back',  clicks: Math.max(250, Math.round(goalClicks * 0.5 / 250) * 250) },
    { id: randomId(), label: 'Current',    clicks: goalClicks },
    { id: randomId(), label: 'Push +50%',  clicks: Math.round(goalClicks * 1.5 / 250) * 250 },
    { id: randomId(), label: 'Stretch 5×', clicks: Math.round(goalClicks * 5 / 1000) * 1000 },
  ])
  // Anchor: which scenario drives the big stats. Defaults to "Current".
  const [anchorId, setAnchorId] = useState<string>(() => scenarios.find(s => s.label === 'Current')?.id ?? scenarios[0]?.id ?? '')

  const anchor = scenarios.find(s => s.id === anchorId) ?? scenarios[0]
  const anchorResult = useMemo(
    () => anchor ? runFunnelByClicks(inputs, anchor.clicks) : null,
    [inputs, anchor],
  )

  const ccy = currentClient.currency

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Ad Potential</h1>
          <p className="text-sm text-ink-mute mt-0.5">
            Edit the baseline numbers, set your target ROAS, and explore scenarios for {currentClient.name}.
          </p>
        </div>
        {anchorResult && <RiskPill result={anchorResult} inputs={inputs} />}
      </header>

      {anchorResult && (
        <HeroOutputs result={anchorResult} inputs={inputs} ccy={ccy} anchor={anchor!} />
      )}

      <BaselinePanel
        baseline={baseline}
        setBaseline={setBaseline}
        targetRoas={targetRoas}
        setTargetRoas={setTargetRoas}
        minRoas={minRoas}
        setMinRoas={setMinRoas}
        ccy={ccy}
        haveSync={haveSync}
        onResetBaseline={() => setBaseline({
          cpc: round2(totals?.cpc) || 1,
          ctr: round2(totals?.ctr) || 0.5,
          cvr: round2(totals?.cvr) || 10,
          aov: totals && totals.orders > 0 ? round2(totals.adSales / totals.orders) : 35,
          organicLiftRatio: 0.6,
        })}
      />

      <ScenariosTable
        scenarios={scenarios}
        setScenarios={setScenarios}
        anchorId={anchorId}
        setAnchorId={setAnchorId}
        inputs={inputs}
        ccy={ccy}
      />

      {anchorResult && <WhatNeedsToBeTrue result={anchorResult} ccy={ccy} anchor={anchor!} />}
    </div>
  )
}

// ---------- Hero outputs ----------

function HeroOutputs({
  result, inputs, ccy, anchor,
}: {
  result: ReturnType<typeof runFunnelByClicks>
  inputs: FunnelInputs
  ccy: Currency
  anchor: Scenario
}) {
  return (
    <Panel>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-accent-mintSoft text-[#1f7a4a] flex items-center justify-center">
            <Target className="w-4 h-4" />
          </span>
          <div>
            <div className="text-sm font-semibold text-ink">Showing scenario · {anchor.label}</div>
            <div className="text-xs text-ink-mute mt-0.5">
              {num(anchor.clicks)} clicks at {currency(inputs.cpc, ccy)} CPC · click any scenario row below to compare
            </div>
          </div>
        </div>
        <Pill tone="ink">Anchor</Pill>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard
          label="Total sales"
          tone="mint"
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          value={currency(result.totalSales, ccy, true)}
          secondary={`paid + ${currency(result.organicLift, ccy, true)} organic`}
        />
        <KPICard
          label="ROAS"
          tone={result.roas >= inputs.targetRoas ? 'mint' : result.roas >= inputs.minRoas ? 'peri' : 'blush'}
          icon={<Sparkles className="w-3.5 h-3.5" />}
          value={`${result.roas.toFixed(2)}×`}
          secondary={`target ${inputs.targetRoas.toFixed(2)}× · min ${inputs.minRoas.toFixed(2)}×`}
        />
        <KPICard
          label="TACOS"
          tone={result.tacos > inputs.ceilingTacos ? 'blush' : result.tacos > inputs.primaryTacos ? 'gold' : 'mint'}
          icon={<Activity className="w-3.5 h-3.5" />}
          value={percent(result.tacos, 1)}
          secondary={`goal ${percent(inputs.primaryTacos)} · ceiling ${percent(inputs.ceilingTacos)}`}
        />
        <KPICard
          label="Paid sales"
          tone="peri"
          icon={<Wallet className="w-3.5 h-3.5" />}
          value={currency(result.paidSales, ccy, true)}
          secondary={`budget ${currency(result.budget, ccy, true)}`}
        />
        <KPICard
          label="Orders"
          tone="lavender"
          icon={<ShoppingCart className="w-3.5 h-3.5" />}
          value={num(result.orders)}
          secondary={`${percent(inputs.cvr, 1)} CVR · ${currency(inputs.aov, ccy)} AOV`}
        />
        <KPICard
          label="Impressions"
          tone="gold"
          icon={<Eye className="w-3.5 h-3.5" />}
          value={result.impressions > 0 ? num(result.impressions) : '—'}
          secondary={inputs.ctr ? `${percent(inputs.ctr, 2)} CTR` : 'set CTR to derive'}
        />
      </div>
    </Panel>
  )
}

// ---------- Baseline panel ----------

function BaselinePanel({
  baseline, setBaseline, targetRoas, setTargetRoas, minRoas, setMinRoas, ccy, haveSync, onResetBaseline,
}: {
  baseline: Baseline
  setBaseline: (b: Baseline) => void
  targetRoas: number
  setTargetRoas: (v: number) => void
  minRoas: number
  setMinRoas: (v: number) => void
  ccy: Currency
  haveSync: boolean
  onResetBaseline: () => void
}) {
  return (
    <Panel>
      <div className="flex items-end justify-between mb-3 flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Baseline · unit economics</h2>
          <p className="text-xs text-ink-mute mt-0.5">
            Edit any number to model a different plan. All scenarios below recompute live.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Pill tone={haveSync ? 'mint' : 'gold'}>
            {haveSync ? 'Synced 30-day baseline' : 'Sensible defaults'}
          </Pill>
          {haveSync && (
            <Button variant="ghost" onClick={onResetBaseline} icon={<RotateCcw className="w-3.5 h-3.5" />}>
              Reset to synced
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        <NumberField
          label="CPC"
          prefix={currencySymbol(ccy)}
          step="0.05"
          value={baseline.cpc}
          onChange={v => setBaseline({ ...baseline, cpc: v })}
        />
        <NumberField
          label="CTR"
          suffix="%"
          step="0.1"
          value={baseline.ctr}
          onChange={v => setBaseline({ ...baseline, ctr: v })}
        />
        <NumberField
          label="CVR"
          suffix="%"
          step="0.1"
          value={baseline.cvr}
          onChange={v => setBaseline({ ...baseline, cvr: v })}
        />
        <NumberField
          label="AOV"
          prefix={currencySymbol(ccy)}
          step="0.5"
          value={baseline.aov}
          onChange={v => setBaseline({ ...baseline, aov: v })}
        />
        <NumberField
          label="Organic lift"
          step="0.05"
          value={baseline.organicLiftRatio}
          onChange={v => setBaseline({ ...baseline, organicLiftRatio: v })}
        />
        <NumberField
          label="Target ROAS"
          suffix="×"
          step="0.1"
          value={targetRoas}
          onChange={setTargetRoas}
        />
        <NumberField
          label="Min ROAS"
          suffix="×"
          step="0.1"
          value={minRoas}
          onChange={setMinRoas}
        />
      </div>
    </Panel>
  )
}

// ---------- Editable scenarios table ----------

function ScenariosTable({
  scenarios, setScenarios, anchorId, setAnchorId, inputs, ccy,
}: {
  scenarios: Scenario[]
  setScenarios: (s: Scenario[]) => void
  anchorId: string
  setAnchorId: (id: string) => void
  inputs: FunnelInputs
  ccy: Currency
}) {
  const updateScenario = (id: string, patch: Partial<Scenario>) => {
    setScenarios(scenarios.map(s => s.id === id ? { ...s, ...patch } : s))
  }
  const removeScenario = (id: string) => {
    setScenarios(scenarios.filter(s => s.id !== id))
    if (anchorId === id && scenarios.length > 1) {
      const fallback = scenarios.find(s => s.id !== id)
      if (fallback) setAnchorId(fallback.id)
    }
  }
  const addScenario = () => {
    const last = scenarios[scenarios.length - 1]?.clicks ?? 5000
    const next: Scenario = { id: randomId(), label: `Scenario ${scenarios.length + 1}`, clicks: last * 2 }
    setScenarios([...scenarios, next])
    setAnchorId(next.id)
  }

  return (
    <Panel padding="p-0" className="overflow-hidden">
      <div className="px-5 py-3 border-b border-line flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Scenarios · click-driven</h2>
          <p className="text-xs text-ink-mute mt-0.5">
            Edit clicks per row. Budget = clicks × CPC. Click any row to make it the anchor scenario.
          </p>
        </div>
        <Button onClick={addScenario} icon={<Plus className="w-4 h-4" />}>
          Add scenario
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-canvas-tint text-ink-mute text-2xs uppercase tracking-wider">
              <th className="text-left px-5 py-2.5 font-medium w-44">Scenario</th>
              <th className="text-right px-3 py-2.5 font-medium w-32">Clicks</th>
              <th className="text-right px-3 py-2.5 font-medium">Impressions</th>
              <th className="text-right px-3 py-2.5 font-medium">Budget</th>
              <th className="text-right px-3 py-2.5 font-medium">Orders</th>
              <th className="text-right px-3 py-2.5 font-medium">Paid sales</th>
              <th className="text-right px-3 py-2.5 font-medium">Organic</th>
              <th className="text-right px-3 py-2.5 font-medium">Total sales</th>
              <th className="text-right px-3 py-2.5 font-medium">ROAS</th>
              <th className="text-right px-3 py-2.5 font-medium">TACOS</th>
              <th className="px-3 py-2.5 pr-5 w-8" />
            </tr>
          </thead>
          <tbody>
            {scenarios.map(s => {
              const r = runFunnelByClicks(inputs, s.clicks)
              const active = anchorId === s.id
              return (
                <tr
                  key={s.id}
                  onClick={() => setAnchorId(s.id)}
                  className={cx(
                    'border-t border-line cursor-pointer transition-colors',
                    active ? 'bg-canvas-tint' : 'hover:bg-canvas-tint',
                  )}
                >
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2">
                      {active && <span className="w-1.5 h-1.5 rounded-full bg-ink" aria-hidden />}
                      <input
                        value={s.label}
                        onChange={e => updateScenario(s.id, { label: e.target.value })}
                        onClick={e => e.stopPropagation()}
                        className="bg-transparent text-sm font-medium text-ink focus:outline-none w-full"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right" onClick={e => e.stopPropagation()}>
                    <NumberField
                      value={s.clicks}
                      onChange={v => updateScenario(s.id, { clicks: v })}
                      className="w-28 inline-block text-right"
                    />
                  </td>
                  <td className="px-3 py-2.5 text-right tnum text-ink-mute">{r.impressions > 0 ? num(r.impressions) : '—'}</td>
                  <td className="px-3 py-2.5 text-right tnum text-ink font-medium">{currency(r.budget, ccy)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{num(r.orders)}</td>
                  <td className="px-3 py-2.5 text-right tnum">{currency(r.paidSales, ccy)}</td>
                  <td className="px-3 py-2.5 text-right tnum text-ink-mute">{currency(r.organicLift, ccy)}</td>
                  <td className="px-3 py-2.5 text-right tnum text-ink font-semibold">{currency(r.totalSales, ccy)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Pill tone={r.roas >= inputs.targetRoas ? 'mint' : r.roas >= inputs.minRoas ? 'peri' : 'blush'}>
                      {r.roas.toFixed(2)}×
                    </Pill>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Pill tone={r.tacos > inputs.ceilingTacos ? 'blush' : r.tacos > inputs.primaryTacos ? 'gold' : 'mint'}>
                      {percent(r.tacos, 1)}
                    </Pill>
                  </td>
                  <td className="px-3 py-2.5 pr-5 text-right" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => removeScenario(s.id)}
                      className="text-ink-faint hover:text-[#9c4651] disabled:opacity-30"
                      disabled={scenarios.length <= 1}
                      aria-label="Remove scenario"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

// ---------- What needs to be true ----------

function WhatNeedsToBeTrue({
  result, ccy, anchor,
}: {
  result: ReturnType<typeof runFunnelByClicks>
  ccy: Currency
  anchor: Scenario
}) {
  return (
    <Panel>
      <div className="flex items-end justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-ink">What needs to be true</h2>
          <p className="text-xs text-ink-mute mt-0.5">
            Daily activity the <span className="text-ink font-medium">{anchor.label}</span> scenario implies.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FactCard label="Clicks per day" value={num(result.whatNeedsToBeTrue.clicksPerDay)} />
        <FactCard label="Orders per day" value={num(result.whatNeedsToBeTrue.conversionsPerDay)} />
        <FactCard label="CPC ceiling" value={currency(result.whatNeedsToBeTrue.cpcCeiling, ccy)} hint="Max CPC to hold primary TACOS" />
        <FactCard label="PDP views / day" value={num(result.whatNeedsToBeTrue.productPagesViewedPerDay)} hint="From paid placements" />
      </div>
      {result.warnings.length > 0 && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {result.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-sm rounded-lg bg-accent-goldSoft/50 border border-accent-gold/30 px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 text-[#8b6a18] mt-0.5 shrink-0" />
              <span className="text-ink">{w}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function FactCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line p-3 bg-canvas-tint">
      <div className="text-2xs uppercase tracking-wider text-ink-mute font-semibold">{label}</div>
      <div className="mt-1.5 tnum text-lg font-semibold text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-2xs text-ink-faint">{hint}</div>}
    </div>
  )
}

// ---------- Risk pill ----------

function RiskPill({ result, inputs }: { result: ReturnType<typeof runFunnel>; inputs: FunnelInputs }) {
  const issues: Array<{ tone: 'blush' | 'gold'; msg: string }> = []
  if (result.roas < inputs.minRoas) issues.push({ tone: 'blush', msg: `ROAS ${result.roas.toFixed(2)}× below minimum (${inputs.minRoas.toFixed(2)}×)` })
  else if (result.roas < inputs.targetRoas) issues.push({ tone: 'gold', msg: `ROAS ${result.roas.toFixed(2)}× below target (${inputs.targetRoas.toFixed(2)}×)` })
  if (result.tacos > inputs.ceilingTacos) issues.push({ tone: 'blush', msg: `TACOS ${result.tacos.toFixed(1)}% above ceiling (${inputs.ceilingTacos.toFixed(1)}%)` })
  else if (result.tacos > inputs.primaryTacos) issues.push({ tone: 'gold', msg: `TACOS ${result.tacos.toFixed(1)}% above goal (${inputs.primaryTacos.toFixed(1)}%)` })

  if (issues.length === 0) {
    return (
      <Pill tone="mint">
        <CheckCircle2 className="w-3 h-3" />
        On target
      </Pill>
    )
  }
  return (
    <div className="flex items-center gap-2 flex-wrap justify-end max-w-md">
      {issues.map((i, idx) => (
        <Pill key={idx} tone={i.tone}>
          <AlertTriangle className="w-3 h-3" />
          {i.msg}
        </Pill>
      ))}
    </div>
  )
}

// ---------- utils ----------

function round2(n: number | undefined): number {
  if (!n || !Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

function currencySymbol(c: Currency): string {
  const map: Record<string, string> = {
    USD: '$', EUR: '€', GBP: '£', CAD: 'C$', MXN: 'MX$', JPY: '¥', AUD: 'A$',
    SEK: 'kr', PLN: 'zł', TRY: '₺', AED: 'AED', INR: '₹', SGD: 'S$', BRL: 'R$',
  }
  return map[c] ?? '$'
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _unused = [ChevronDown, ChevronUp]
