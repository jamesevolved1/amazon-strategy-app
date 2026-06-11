// Date-range utilities for the reporting dashboard.

import type { DailySeriesPoint } from '../types'

export type RangePreset = '7d' | '14d' | '30d' | 'all'

export interface ResolvedRange {
  start: string
  end: string
  prevStart: string
  prevEnd: string
  days: number
  label: string
}

export function resolveRange(series: DailySeriesPoint[], preset: RangePreset): ResolvedRange | null {
  if (series.length === 0) return null
  const sorted = series.slice().sort((a, b) => a.date.localeCompare(b.date))
  const lastDate = sorted[sorted.length - 1].date
  const firstDate = sorted[0].date

  if (preset === 'all') {
    const days = daysInclusive(firstDate, lastDate)
    // Previous window = same length immediately before first, but we don't have data — fallback to first half vs second half
    const halfPoint = Math.floor(sorted.length / 2)
    const prevStart = sorted[0].date
    const prevEnd = sorted[Math.max(0, halfPoint - 1)].date
    return { start: firstDate, end: lastDate, prevStart, prevEnd, days, label: 'All synced' }
  }

  const n = preset === '7d' ? 7 : preset === '14d' ? 14 : 30
  const endDate = new Date(lastDate + 'T00:00:00Z')
  const startDate = new Date(endDate.getTime() - (n - 1) * 86_400_000)
  const prevEnd = new Date(startDate.getTime() - 86_400_000)
  const prevStart = new Date(prevEnd.getTime() - (n - 1) * 86_400_000)
  return {
    start: iso(startDate),
    end: iso(endDate),
    prevStart: iso(prevStart),
    prevEnd: iso(prevEnd),
    days: n,
    label: `Last ${n} days`,
  }
}

export function sliceSeries(series: DailySeriesPoint[], start: string, end: string): DailySeriesPoint[] {
  return series.filter(p => p.date >= start && p.date <= end).sort((a, b) => a.date.localeCompare(b.date))
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysInclusive(a: string, b: string): number {
  const start = new Date(a + 'T00:00:00Z').getTime()
  const end = new Date(b + 'T00:00:00Z').getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1)
}
