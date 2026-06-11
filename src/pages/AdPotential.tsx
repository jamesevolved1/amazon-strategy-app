import React, { useMemo, useState } from 'react'
import { ArrowDown, AlertTriangle, CheckCircle2, Target } from 'lucide-react'
import { Panel, Pill, EmptyState, TextField, cx } from '../components/ui'
import { useStore } from '../lib/store'
import { defaultInputsFromGoals, runFunnel, type FunnelInputs } from '../utils/adPotential'
import { currency, num, percent } from '../lib/format'
import { totalsFromSeries } from '../utils/pnl'
import { resolveRange, sliceSeries } from '../utils/dateRange'
import type { BulkCampaignData } from '../utils/parsers'
import type { DailySeriesPoint } from '../types'

export function AdPotential() {
  const { currentClient, currentBundle } = useStore()
  if (!currentClient || !currentBundle) return <EmptyState title="No client selected" />

  // Pull baseline metrics from synced reports if available.
  const bulk = currentBundle.reports.bulkCampaigns?.parsed as BulkCampaignData | undefined
  const series = (bulk?.daily ?? []) as DailySeriesPoint[]
  const range = resolveRange(series, '30d')
  const totals = range ? totalsFromSeries(sliceSeries(series, range.start, range.end), range.days) : null

  const [inputs, setInputs] = useState<FunnelInputs>(() => defaultInputsFromGoals(currentBundle.goals, totals ? {
    cpc: totals.cpc || 1,
    cvr: totals.cvr || 10,
    aov: totals.orders > 0 ? totals.adSales / totals.orders : 35,
  } : undefined))

  const result = useMemo(() => runFunnel(inputs), [inputs])

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-ink">Ad Potential</h1>
          <p className="text-sm text-ink-mute mt-0.5">
            Funnel-driven forecast — Budget → CPC → Clicks → CVR → Orders → AOV → Paid Sales → Organic Lift → Total Sales → TACOS
          </p>
        </div>
        <Pill tone={result.riskLevel === 'low' ? 'mint' : result.riskLevel === 'medium' ? 'gold' : 'blush'}>
          Risk: {result.riskLevel}
        </Pill>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Panel className="lg:col-span-1">
          <h2 className="text-base font-semibold text-ink">Inputs</h2>
          <p className="text-xs text-ink-mute mt-1">Target ROAS is a benchmark, never the primary formula.</p>
          <div className="mt-4 space-y-3">
            <TextField label="Monthly ad budget" type="number" prefix={currencySymbol(currentClient.currency)} value={inputs.budget} onChange={v => setInputs(s => ({ ...s, budget: Number(v) || 0 }))} />
            <TextField label="Expected CPC" type="number" step="0.05" prefix={currencySymbol(currentClient.currency)} value={inputs.cpc} onChange={v => setInputs(s => ({ ...s, cpc: Number(v) || 0 }))} />
            <TextField label="Conversion rate" type="number" step="0.1" suffix="%" value={inputs.cvr} onChange={v => setInputs(s => ({ ...s, cvr: Number(v) || 0 }))} />
            <TextField label="Average order value" type="number" step="0.5" prefix={currencySymbol(currentClient.currency)} value={inputs.aov} onChange={v => setInputs(s => ({ ...s, aov: Number(v) || 0 }))} />
            <TextField label="Organic lift ratio (paid → organic)" type="number" step="0.05" value={inputs.organicLiftRatio} onChange={v => setInputs(s => ({ ...s, organicLiftRatio: Number(v) || 0 }))} />
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Target ROAS (benchmark)" type="number" step="0.1" suffix="×" value={inputs.targetRoas} onChange={v => setInputs(s => ({ ...s, targetRoas: Number(v) || 0 }))} />
              <TextField label="Min ROAS" type="number" step="0.1" suffix="×" value={inputs.minRoas} onChange={v => setInputs(s => ({ ...s, minRoas: Number(v) || 0 }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Primary TACOS goal" type="number" step="0.5" suffix="%" value={inputs.primaryTacos} onChange={v => setInputs(s => ({ ...s, primaryTacos: Number(v) || 0 }))} />
              <TextField label="TACOS ceiling" type="number" step="0.5" suffix="%" value={inputs.ceilingTacos} onChange={v => setInputs(s => ({ ...s, ceilingTacos: Number(v) || 0 }))} />
            </div>
          </div>
        </Panel>

        <Panel className="lg:col-span-2">
          <h2 className="text-base font-semibold text-ink">Funnel forecast</h2>
          <div className="mt-3 space-y-2.5">
            <FunnelStep label="Budget" value={currency(result.budget, currentClient.currency)} tone="peri" />
            <FunnelStep label="÷ CPC" value={currency(result.cpc, currentClient.currency)} tone="peri" sub="cost per click" />
            <FunnelStep label="Clicks" value={num(result.clicks)} tone="mint" />
            <FunnelStep label="× CVR" value={percent(result.cvr, 2)} tone="mint" sub="click → order" />
            <FunnelStep label="Orders" value={num(result.orders)} tone="lavender" />
            <FunnelStep label="× AOV" value={currency(result.aov, currentClient.currency)} tone="lavender" sub="average order value" />
            <FunnelStep label="Paid sales" value={currency(result.paidSales, currentClient.currency)} tone="gold" emphasize />
            <FunnelStep label="+ Organic lift" value={currency(result.organicLift, currentClient.currency)} tone="gold" sub="halo from paid placements" />
            <FunnelStep label="Total sales" value={currency(result.totalSales, currentClient.currency)} tone="blush" emphasize />
            <div className="grid grid-cols-2 gap-3 pt-2">
              <ResultStat label="Projected TACOS" tone={result.tacos > inputs.ceilingTacos ? 'blush' : result.tacos > inputs.primaryTacos ? 'gold' : 'mint'} value={percent(result.tacos, 1)} sub={`goal ${percent(inputs.primaryTacos)} · ceiling ${percent(inputs.ceilingTacos)}`} />
              <ResultStat label="Forecast ROAS" tone={result.roas < inputs.minRoas ? 'blush' : result.roas < inputs.targetRoas ? 'gold' : 'mint'} value={`${result.roas.toFixed(2)}×`} sub={`target ${inputs.targetRoas.toFixed(2)}× · gap ${result.targetRoasGap >= 0 ? '+' : ''}${result.targetRoasGap.toFixed(2)}×`} />
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Panel className="lg:col-span-2">
          <h2 className="text-base font-semibold text-ink">What needs to be true</h2>
          <p className="text-xs text-ink-mute mt-1">For this forecast to land, the underlying daily activity has to look like this.</p>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Truth label="Clicks per day" value={num(result.whatNeedsToBeTrue.clicksPerDay)} />
            <Truth label="Conversions per day" value={num(result.whatNeedsToBeTrue.conversionsPerDay)} />
            <Truth label="CPC ceiling" value={currency(result.whatNeedsToBeTrue.cpcCeiling, currentClient.currency)} hint="max CPC to hit primary TACOS" />
            <Truth label="Paid PDP views / day" value={num(result.whatNeedsToBeTrue.productPagesViewedPerDay)} />
          </div>
          <p className="mt-4 text-sm text-ink leading-relaxed">{result.explanation}</p>
        </Panel>

        <Panel>
          <h2 className="text-base font-semibold text-ink">Warnings</h2>
          {result.warnings.length === 0 ? (
            <div className="mt-3 flex items-start gap-2 text-sm text-ink-mute">
              <CheckCircle2 className="w-4 h-4 text-[#1f7a4a] mt-0.5" />
              No blocking issues. Forecast is internally consistent with goal guardrails.
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {result.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="w-4 h-4 text-[#c98a1a] mt-0.5 shrink-0" />
                  <span className="text-ink-mute"><span className="text-ink">{w}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

function FunnelStep({ label, value, tone, sub, emphasize }: { label: string; value: string; tone: 'peri' | 'mint' | 'gold' | 'lavender' | 'blush'; sub?: string; emphasize?: boolean }) {
  const bg: Record<string, string> = {
    peri: 'bg-accent-periSoft/40', mint: 'bg-accent-mintSoft/40', gold: 'bg-accent-goldSoft/50', lavender: 'bg-accent-lavenderSoft/40', blush: 'bg-accent-blushSoft/40',
  }
  return (
    <div className={cx('flex items-center justify-between rounded-lg border border-line px-3 py-2.5', bg[tone], emphasize && 'shadow-card')}>
      <div className="flex items-center gap-2">
        <Target className="w-3.5 h-3.5 text-ink-mute" />
        <span className={cx('text-sm', emphasize ? 'font-semibold text-ink' : 'text-ink')}>{label}</span>
        {sub && <span className="text-2xs text-ink-faint">{sub}</span>}
      </div>
      <span className={cx('tnum', emphasize ? 'text-base font-semibold text-ink' : 'text-sm text-ink')}>{value}</span>
    </div>
  )
}

function ResultStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: 'mint' | 'gold' | 'blush' }) {
  const stripe: Record<string, string> = { mint: 'bg-accent-mint', gold: 'bg-accent-gold', blush: 'bg-accent-blush' }
  return (
    <div className="relative rounded-lg border border-line p-3">
      <div className={cx('absolute left-3 right-3 top-0 h-[2px] rounded-b-full', stripe[tone])} />
      <div className="text-2xs uppercase tracking-wider text-ink-mute font-semibold">{label}</div>
      <div className="mt-1.5 tnum text-lg font-semibold text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-2xs text-ink-faint">{sub}</div>}
    </div>
  )
}

function Truth({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line p-3 bg-canvas-tint">
      <div className="text-2xs uppercase tracking-wider text-ink-mute font-semibold flex items-center gap-1.5"><ArrowDown className="w-3 h-3" />{label}</div>
      <div className="mt-1.5 tnum text-lg font-semibold text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-2xs text-ink-faint">{hint}</div>}
    </div>
  )
}

function currencySymbol(c: import('../types').Currency): string {
  const map: Record<string, string> = {
    USD: '$', EUR: '€', GBP: '£', CAD: 'C$', MXN: 'MX$', JPY: '¥', AUD: 'A$',
    SEK: 'kr', PLN: 'zł', TRY: '₺', AED: 'AED', INR: '₹', SGD: 'S$', BRL: 'R$',
  }
  return map[c] ?? '$'
}
