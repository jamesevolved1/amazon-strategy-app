// Ad Potential: slider-first scenario explorer. ROAS is the headline metric.
// No ACOS anywhere. TACOS appears only as a cost-efficiency guardrail.

import React, { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Sparkles, TrendingUp, Wallet, Activity, ShoppingCart, Eye } from 'lucide-react'
import { Panel, Pill, EmptyState, NumberField, cx, Button } from '../components/ui'
import { KPICard } from '../components/KPICard'
import { useStore } from '../lib/store'
import { runFunnel, type FunnelInputs } from '../utils/adPotential'
import { currency, num, percent } from '../lib/format'
import { totalsFromSeries } from '../utils/pnl'
import { resolveRange, sliceSeries } from '../utils/dateRange'
import type { BulkCampaignData } from '../utils/parsers'
import type { Currency, DailySeriesPoint } from '../types'

interface Assumptions {
  cpc: number
  cvr: number          // %
  aov: number
  organicLiftRatio: number
}

export function AdPotential() {
  const { currentClient, currentBundle } = useStore()
  const [assumptionsOpen, setAssumptionsOpen] = useState(false)

  if (!currentClient || !currentBundle) return <EmptyState title="No client selected" />

  // Baseline from synced campaign data (when present).
  const bulk = currentBundle.reports.bulkCampaigns?.parsed as BulkCampaignData | undefined
  const series = (bulk?.daily ?? []) as DailySeriesPoint[]
  const range = resolveRange(series, '30d')
  const totals = range ? totalsFromSeries(sliceSeries(series, range.start, range.end), range.days) : null

  const goals = currentBundle.goals
  const baselineBudget = goals.monthlyAdBudget || (totals ? totals.perDaySpend * 30 : 5000)

  const [assumptions, setAssumptions] = useState<Assumptions>(() => ({
    cpc: totals?.cpc && totals.cpc > 0 ? round2(totals.cpc) : 1,
    cvr: totals?.cvr && totals.cvr > 0 ? round2(totals.cvr) : 10,
    aov: totals && totals.orders > 0 ? round2(totals.adSales / totals.orders) : 35,
    organicLiftRatio: 0.6,
  }))

  const [budget, setBudget] = useState<number>(() => baselineBudget || 5000)

  // Slider range: 0 → 3× whichever is larger between current spend and goal budget,
  // with a $1000 floor so the slider is always useful even pre-data.
  const sliderMax = Math.max(1000, Math.round((baselineBudget || 0) * 3 / 100) * 100 || 25000)

  const inputs: FunnelInputs = useMemo(() => ({
    budget,
    cpc: assumptions.cpc,
    cvr: assumptions.cvr,
    aov: assumptions.aov,
    organicLiftRatio: assumptions.organicLiftRatio,
    targetRoas: goals.targetRoas || 5,
    minRoas: goals.minimumAcceptableRoas || 3,
    primaryTacos: goals.primaryTacosGoal || 12,
    ceilingTacos: goals.acceptableTacosCeiling || 18,
  }), [budget, assumptions, goals])

  const result = useMemo(() => runFunnel(inputs), [inputs])

  // Scenarios — 4 budget levels relative to slider value
  const scenarios = useMemo(() => {
    const make = (label: string, multiplier: number, tone: 'mint' | 'peri' | 'gold' | 'blush') => {
      const b = Math.round(budget * multiplier)
      const r = runFunnel({ ...inputs, budget: b })
      return { label, multiplier, budget: b, result: r, tone, current: multiplier === 1 }
    }
    return [
      make('Pull back', 0.75, 'mint'),
      make('Current', 1, 'peri'),
      make('Push +25%', 1.25, 'gold'),
      make('Push +50%', 1.5, 'blush'),
    ]
  }, [budget, inputs])

  const ccy = currentClient.currency

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Ad Potential</h1>
          <p className="text-sm text-ink-mute mt-0.5">Drag the budget to see what it can do · ROAS-led forecast for {currentClient.name}</p>
        </div>
        <RiskPill result={result} inputs={inputs} />
      </header>

      <BudgetHero
        budget={budget}
        sliderMax={sliderMax}
        onBudget={setBudget}
        result={result}
        inputs={inputs}
        ccy={ccy}
        baselineBudget={baselineBudget}
        haveSync={Boolean(totals && totals.spend > 0)}
      />

      <ScenarioTable scenarios={scenarios} ccy={ccy} inputs={inputs} />

      <WhatNeedsToBeTrue result={result} ccy={ccy} />

      <AssumptionsPanel
        open={assumptionsOpen}
        onToggle={() => setAssumptionsOpen(o => !o)}
        assumptions={assumptions}
        setAssumptions={setAssumptions}
        inputs={inputs}
        ccy={ccy}
        baselineFromSync={Boolean(totals && totals.spend > 0)}
      />
    </div>
  )
}

// ----- Hero ----------

function BudgetHero({
  budget, sliderMax, onBudget, result, inputs, ccy, baselineBudget, haveSync,
}: {
  budget: number
  sliderMax: number
  onBudget: (v: number) => void
  result: ReturnType<typeof runFunnel>
  inputs: FunnelInputs
  ccy: Currency
  baselineBudget: number
  haveSync: boolean
}) {
  const sliderPct = sliderMax > 0 ? (budget / sliderMax) * 100 : 0

  return (
    <Panel>
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-ink">What can your ad budget do?</h2>
          <p className="text-xs text-ink-mute mt-0.5">
            Drag the slider, type a number, or click a preset. Outputs update live.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {baselineBudget > 0 && (
            <button
              onClick={() => onBudget(Math.round(baselineBudget))}
              className="px-2.5 py-1 rounded-full text-2xs font-medium border border-line text-ink-mute hover:text-ink hover:bg-canvas-tint"
            >
              Goal · {currency(baselineBudget, ccy)}
            </button>
          )}
          {[0.5, 1, 1.5, 2].map(m => {
            const b = Math.round(baselineBudget * m / 100) * 100
            if (!b || b > sliderMax) return null
            return (
              <button
                key={m}
                onClick={() => onBudget(b)}
                className={cx(
                  'px-2.5 py-1 rounded-full text-2xs font-medium border',
                  budget === b ? 'border-ink bg-ink text-white' : 'border-line text-ink-mute hover:text-ink hover:bg-canvas-tint',
                )}
              >
                {Math.round(m * 100)}%
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-xl2 border border-line p-4 bg-canvas-tint">
            <label className="block text-2xs uppercase tracking-wider text-ink-mute font-semibold mb-2">Monthly ad budget</label>
            <div className="flex items-center gap-3">
              <NumberField
                value={budget}
                onChange={onBudget}
                prefix={currencySymbol(ccy)}
                className="w-44"
              />
              {haveSync && (
                <span className="text-2xs text-ink-faint leading-tight">
                  Synced<br />30-day baseline
                </span>
              )}
            </div>
            <input
              type="range"
              min={0}
              max={sliderMax}
              step={Math.max(50, Math.round(sliderMax / 200 / 50) * 50)}
              value={budget}
              onChange={e => onBudget(Number(e.target.value))}
              className="asa-range w-full mt-4"
              style={{ '--pct': `${sliderPct}%` } as React.CSSProperties}
            />
            <div className="mt-1.5 flex items-center justify-between text-2xs text-ink-faint tnum">
              <span>{currency(0, ccy)}</span>
              <span>{currency(Math.round(sliderMax / 2), ccy, true)}</span>
              <span>{currency(sliderMax, ccy, true)}</span>
            </div>
          </div>

          <p className="text-sm text-ink leading-relaxed">{result.explanation}</p>
        </div>

        <div className="lg:col-span-7">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <BigStat
              label="Total sales"
              tone="mint"
              icon={<TrendingUp className="w-3.5 h-3.5" />}
              value={currency(result.totalSales, ccy, true)}
              sub={`paid ${currency(result.paidSales, ccy, true)} + organic ${currency(result.organicLift, ccy, true)}`}
            />
            <BigStat
              label="ROAS"
              tone={result.roas >= inputs.targetRoas ? 'mint' : result.roas >= inputs.minRoas ? 'peri' : 'blush'}
              icon={<Sparkles className="w-3.5 h-3.5" />}
              value={`${result.roas.toFixed(2)}×`}
              sub={`target ${inputs.targetRoas.toFixed(2)}× · min ${inputs.minRoas.toFixed(2)}×`}
            />
            <BigStat
              label="TACOS"
              tone={result.tacos > inputs.ceilingTacos ? 'blush' : result.tacos > inputs.primaryTacos ? 'gold' : 'mint'}
              icon={<Activity className="w-3.5 h-3.5" />}
              value={percent(result.tacos, 1)}
              sub={`goal ${percent(inputs.primaryTacos)} · ceiling ${percent(inputs.ceilingTacos)}`}
            />
            <BigStat
              label="Paid sales"
              tone="peri"
              icon={<Wallet className="w-3.5 h-3.5" />}
              value={currency(result.paidSales, ccy, true)}
              sub={`from ${num(result.clicks)} clicks`}
            />
            <BigStat
              label="Orders"
              tone="lavender"
              icon={<ShoppingCart className="w-3.5 h-3.5" />}
              value={num(result.orders)}
              sub={`${percent(inputs.cvr, 1)} CVR · ${currency(inputs.aov, ccy)} AOV`}
            />
            <BigStat
              label="Clicks"
              tone="gold"
              icon={<Eye className="w-3.5 h-3.5" />}
              value={num(result.clicks)}
              sub={`at ${currency(inputs.cpc, ccy)} CPC`}
            />
          </div>
        </div>
      </div>
    </Panel>
  )
}

function BigStat({
  label, value, sub, tone, icon,
}: {
  label: string
  value: React.ReactNode
  sub: string
  tone: 'mint' | 'peri' | 'gold' | 'lavender' | 'blush'
  icon: React.ReactNode
}) {
  return <KPICard label={label} value={value} secondary={sub} tone={tone} icon={icon} />
}

// ----- Scenario table ----------

function ScenarioTable({
  scenarios, ccy, inputs,
}: {
  scenarios: Array<{ label: string; multiplier: number; budget: number; result: ReturnType<typeof runFunnel>; tone: 'mint' | 'peri' | 'gold' | 'blush'; current: boolean }>
  ccy: Currency
  inputs: FunnelInputs
}) {
  const rows: Array<{ key: string; label: string; render: (r: ReturnType<typeof runFunnel>) => React.ReactNode }> = [
    { key: 'budget',     label: 'Budget',       render: r => <span className="tnum text-ink">{currency(r.budget, ccy)}</span> },
    { key: 'clicks',     label: 'Clicks',       render: r => <span className="tnum text-ink">{num(r.clicks)}</span> },
    { key: 'orders',     label: 'Orders',       render: r => <span className="tnum text-ink">{num(r.orders)}</span> },
    { key: 'paid',       label: 'Paid sales',   render: r => <span className="tnum text-ink">{currency(r.paidSales, ccy)}</span> },
    { key: 'organic',    label: 'Organic lift', render: r => <span className="tnum text-ink-mute">{currency(r.organicLift, ccy)}</span> },
    { key: 'total',      label: 'Total sales',  render: r => <span className="tnum text-ink font-semibold">{currency(r.totalSales, ccy)}</span> },
    { key: 'roas',       label: 'ROAS',         render: r => <Pill tone={r.roas >= inputs.targetRoas ? 'mint' : r.roas >= inputs.minRoas ? 'peri' : 'blush'}>{r.roas.toFixed(2)}×</Pill> },
    { key: 'tacos',      label: 'TACOS',        render: r => <Pill tone={r.tacos > inputs.ceilingTacos ? 'blush' : r.tacos > inputs.primaryTacos ? 'gold' : 'mint'}>{percent(r.tacos, 1)}</Pill> },
  ]

  const stripe: Record<string, string> = {
    mint: 'bg-accent-mint', peri: 'bg-accent-peri', gold: 'bg-accent-gold', blush: 'bg-accent-blush',
  }

  return (
    <Panel padding="p-0" className="overflow-hidden">
      <div className="px-5 py-3 border-b border-line flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">Side-by-side scenarios</h2>
          <p className="text-xs text-ink-mute mt-0.5">What happens if you pull back or push beyond the slider value</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left px-5 py-3 font-medium text-2xs uppercase tracking-wider text-ink-mute w-44">Scenario</th>
              {scenarios.map(s => (
                <th key={s.label} className={cx('text-right px-4 py-3 font-medium relative', s.current && 'bg-canvas-tint')}>
                  <div className={cx('absolute inset-x-4 top-0 h-[2px]', stripe[s.tone])} />
                  <div className="flex flex-col items-end gap-0.5">
                    <span className={cx('text-2xs uppercase tracking-wider font-semibold', s.current ? 'text-ink' : 'text-ink-mute')}>{s.label}</span>
                    <span className="tnum text-ink font-semibold">{currency(s.budget, ccy)}</span>
                    {s.current && <Pill tone="ink">current</Pill>}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(1).map(row => (
              <tr key={row.key} className="border-t border-line">
                <td className="px-5 py-2.5 text-ink-mute">{row.label}</td>
                {scenarios.map(s => (
                  <td key={s.label + row.key} className={cx('px-4 py-2.5 text-right', s.current && 'bg-canvas-tint')}>
                    {row.render(s.result)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

// ----- What needs to be true ----------

function WhatNeedsToBeTrue({ result, ccy }: { result: ReturnType<typeof runFunnel>; ccy: Currency }) {
  const dailyClicks = result.whatNeedsToBeTrue.clicksPerDay
  const dailyOrders = result.whatNeedsToBeTrue.conversionsPerDay
  return (
    <Panel>
      <div className="flex items-end justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-ink">What needs to be true</h2>
          <p className="text-xs text-ink-mute mt-0.5">Daily activity the slider implies — anchor for client expectations</p>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FactCard label="Clicks per day" value={num(dailyClicks)} />
        <FactCard label="Orders per day" value={num(dailyOrders)} />
        <FactCard label="CPC ceiling" value={currency(result.whatNeedsToBeTrue.cpcCeiling, ccy)} hint="Max CPC to hold primary TACOS" />
        <FactCard label="PDP views / day" value={num(result.whatNeedsToBeTrue.productPagesViewedPerDay)} hint="From paid placements" />
      </div>
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

// ----- Assumptions panel ----------

function AssumptionsPanel({
  open, onToggle, assumptions, setAssumptions, inputs, ccy, baselineFromSync,
}: {
  open: boolean
  onToggle: () => void
  assumptions: Assumptions
  setAssumptions: (a: Assumptions) => void
  inputs: FunnelInputs
  ccy: Currency
  baselineFromSync: boolean
}) {
  return (
    <Panel padding="p-0">
      <button onClick={onToggle} className="w-full flex items-center justify-between px-5 py-3 hover:bg-canvas-tint">
        <div className="flex items-center gap-2.5">
          {open ? <ChevronUp className="w-4 h-4 text-ink-faint" /> : <ChevronDown className="w-4 h-4 text-ink-faint" />}
          <span className="text-sm font-medium text-ink">Assumptions</span>
          {baselineFromSync ? <Pill tone="mint">Pulled from synced 30-day data</Pill> : <Pill tone="gold">Sensible defaults</Pill>}
        </div>
        <span className="text-2xs text-ink-faint tnum">
          CPC {currency(assumptions.cpc, ccy)} · CVR {percent(assumptions.cvr, 1)} · AOV {currency(assumptions.aov, ccy)} · lift {percent(assumptions.organicLiftRatio * 100, 0)}
        </span>
      </button>
      {open && (
        <div className="border-t border-line px-5 py-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <NumberField label="Expected CPC" prefix={currencySymbol(ccy)} step="0.05" value={assumptions.cpc} onChange={v => setAssumptions({ ...assumptions, cpc: v })} />
          <NumberField label="Conversion rate" suffix="%" step="0.1" value={assumptions.cvr} onChange={v => setAssumptions({ ...assumptions, cvr: v })} />
          <NumberField label="Average order value" prefix={currencySymbol(ccy)} step="0.5" value={assumptions.aov} onChange={v => setAssumptions({ ...assumptions, aov: v })} />
          <NumberField label="Organic lift (paid → organic)" step="0.05" value={assumptions.organicLiftRatio} onChange={v => setAssumptions({ ...assumptions, organicLiftRatio: v })} />
        </div>
      )}
      {open && (
        <div className="border-t border-line px-5 py-3 text-xs text-ink-mute">
          ROAS guardrails sourced from this client's goals — Target {inputs.targetRoas.toFixed(2)}× · Minimum {inputs.minRoas.toFixed(2)}×. TACOS guardrails — Goal {percent(inputs.primaryTacos)} · Ceiling {percent(inputs.ceilingTacos)}. Adjust on the <span className="text-ink">Clients</span> page.
        </div>
      )}
    </Panel>
  )
}

// ----- Risk pill ----------

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

// ----- utils ----------

function round2(n: number): number {
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
const _unused = [Button]
