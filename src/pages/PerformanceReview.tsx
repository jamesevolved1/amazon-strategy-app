// Strategy Scorecard. Reads Strategy Doc Report tab.
// Compares projection vs prior *completed* month — never partial current month.

import React, { useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Panel, Pill, EmptyState, cx } from '../components/ui'
import { useStore } from '../lib/store'
import { currency, num, percent } from '../lib/format'
import type { StrategyScorecard } from '../types'

const SERIES_KEYS = [
  { id: 'totalSales',    label: 'Total Sales',    color: '#0f1115', kind: 'currency' as const },
  { id: 'organicSales',  label: 'Organic Sales',  color: '#1f9d6b', kind: 'currency' as const },
  { id: 'adSales',       label: 'Ad Sales',       color: '#9aa6f0', kind: 'currency' as const },
  { id: 'impressions',   label: 'Impressions',    color: '#c7b8e8', kind: 'number' as const },
  { id: 'clicks',        label: 'Clicks',         color: '#e9c875', kind: 'number' as const },
  { id: 'ctr',           label: 'CTR',            color: '#f1bdc4', kind: 'percent' as const },
  { id: 'cvr',           label: 'CVR',            color: '#a7d9b9', kind: 'percent' as const },
] as const

type SeriesKey = typeof SERIES_KEYS[number]['id']

export function PerformanceReview() {
  const { currentClient, currentBundle } = useStore()
  const [enabled, setEnabled] = useState<Record<SeriesKey, boolean>>({
    totalSales: true, organicSales: true, adSales: true,
    impressions: false, clicks: false, ctr: false, cvr: false,
  })

  if (!currentClient || !currentBundle) return <EmptyState title="No client selected" />

  const scorecard = currentBundle.reports.strategyDoc?.parsed as StrategyScorecard | undefined | null

  if (!scorecard) {
    return (
      <EmptyState
        title="No Strategy Doc data yet"
        description="Upload the Client Strategy Doc Report tab from the Upload Reports page to populate the scorecard."
      />
    )
  }

  const data = useMemo(() => {
    return scorecard.series.dates.map((d, i) => ({
      date: d,
      totalSales: scorecard.series.totalSales[i],
      organicSales: scorecard.series.organicSales[i],
      adSales: scorecard.series.adSales[i],
      impressions: scorecard.series.impressions[i],
      clicks: scorecard.series.clicks[i],
      ctr: scorecard.series.ctr[i],
      cvr: scorecard.series.cvr[i],
    }))
  }, [scorecard])

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Performance Review</h1>
          <p className="text-sm text-ink-mute mt-0.5">
            Strategy scorecard · current month, prior month, projection
          </p>
        </div>
        <Pill tone="peri">Data current through {scorecard.dataCurrentThrough}</Pill>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <MonthCard
          title="Prior month"
          tone="lavender"
          month={scorecard.priorMonth}
          ccy={currentClient.currency}
        />
        <MonthCard
          title="Current month (MTD)"
          tone="peri"
          month={scorecard.currentMonth}
          ccy={currentClient.currency}
          hint="Partial — projection below"
        />
        <MonthCard
          title="Projection"
          tone="mint"
          month={scorecard.projection}
          ccy={currentClient.currency}
          hint={`Comparison: projection vs prior ${scorecard.priorMonth.label}`}
          compareTo={scorecard.priorMonth}
        />
      </div>

      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-semibold text-ink">Daily trend</h2>
            <p className="text-xs text-ink-mute mt-0.5">Toggle series below. ACOS is intentionally excluded — prioritize ROAS and TACOS.</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SERIES_KEYS.map(k => (
              <button
                key={k.id}
                onClick={() => setEnabled(prev => ({ ...prev, [k.id]: !prev[k.id] }))}
                className={cx(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-medium border transition-colors',
                  enabled[k.id]
                    ? 'border-ink bg-ink text-white'
                    : 'border-line text-ink-mute hover:text-ink hover:bg-canvas-tint',
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: enabled[k.id] ? '#fff' : k.color }} />
                {k.label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="totalSalesFillSC" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0f1115" stopOpacity={0.10} />
                  <stop offset="100%" stopColor="#0f1115" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#eef0f4" vertical={false} />
              <XAxis dataKey="date" tickFormatter={d => d.slice(5)} stroke="#9ea3ad" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e7e9ee' }} />
              <YAxis stroke="#9ea3ad" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#e7e9ee' }} />
              <Tooltip formatter={(v: number, name: string) => {
                const meta = SERIES_KEYS.find(k => k.label === name)
                if (!meta) return [v, name]
                if (meta.kind === 'currency') return [currency(v, currentClient.currency), name]
                if (meta.kind === 'percent') return [`${v.toFixed(2)}%`, name]
                return [num(v), name]
              }} />
              {enabled.totalSales && <Area dataKey="totalSales" name="Total Sales" stroke="#0f1115" strokeWidth={2} fill="url(#totalSalesFillSC)" dot={false} />}
              {enabled.organicSales && <Line dataKey="organicSales" name="Organic Sales" stroke="#1f9d6b" strokeWidth={2} dot={false} />}
              {enabled.adSales && <Line dataKey="adSales" name="Ad Sales" stroke="#9aa6f0" strokeWidth={2} dot={false} />}
              {enabled.impressions && <Line dataKey="impressions" name="Impressions" stroke="#c7b8e8" strokeWidth={1.5} dot={false} />}
              {enabled.clicks && <Line dataKey="clicks" name="Clicks" stroke="#e9c875" strokeWidth={1.5} dot={false} />}
              {enabled.ctr && <Line dataKey="ctr" name="CTR" stroke="#f1bdc4" strokeWidth={1.5} dot={false} />}
              {enabled.cvr && <Line dataKey="cvr" name="CVR" stroke="#a7d9b9" strokeWidth={1.5} dot={false} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>
  )
}

function MonthCard({
  title, month, ccy, tone, hint, compareTo,
}: {
  title: string
  month: StrategyScorecard['currentMonth']
  ccy: import('../types').Currency
  tone: 'peri' | 'mint' | 'lavender' | 'gold' | 'blush'
  hint?: string
  compareTo?: StrategyScorecard['priorMonth']
}) {
  const stripe: Record<string, string> = { peri: 'bg-accent-peri', mint: 'bg-accent-mint', lavender: 'bg-accent-lavender', gold: 'bg-accent-gold', blush: 'bg-accent-blush' }
  const Row = ({ label, value, prev }: { label: string; value: string; prev?: string }) => (
    <div className="flex items-center justify-between py-1.5 text-xs">
      <span className="text-ink-mute">{label}</span>
      <span className="tnum text-ink">
        {value}
        {prev && <span className="ml-2 text-ink-faint">vs {prev}</span>}
      </span>
    </div>
  )
  return (
    <div className="relative rounded-xl2 bg-canvas-panel border border-line shadow-card overflow-hidden">
      <div className={cx('absolute inset-x-0 top-0 h-[3px]', stripe[tone])} />
      <div className="p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-2xs uppercase tracking-wider font-semibold text-ink-mute">{title}</span>
          <span className="text-2xs text-ink-faint">{month.label}</span>
        </div>
        <div className="mt-3">
          <Row label="Total sales" value={currency(month.totalSales, ccy)} prev={compareTo ? currency(compareTo.totalSales, ccy) : undefined} />
          <Row label="Organic sales" value={currency(month.organicSales, ccy)} prev={compareTo ? currency(compareTo.organicSales, ccy) : undefined} />
          <Row label="Ad sales" value={currency(month.adSales, ccy)} prev={compareTo ? currency(compareTo.adSales, ccy) : undefined} />
          <Row label="Impressions" value={num(month.impressions)} prev={compareTo ? num(compareTo.impressions) : undefined} />
          <Row label="Clicks" value={num(month.clicks)} prev={compareTo ? num(compareTo.clicks) : undefined} />
          <Row label="CTR" value={percent(month.ctr, 2)} prev={compareTo ? percent(compareTo.ctr, 2) : undefined} />
          <Row label="CVR" value={percent(month.cvr, 2)} prev={compareTo ? percent(compareTo.cvr, 2) : undefined} />
        </div>
        {hint && <p className="mt-2 text-2xs text-ink-faint">{hint}</p>}
      </div>
    </div>
  )
}
