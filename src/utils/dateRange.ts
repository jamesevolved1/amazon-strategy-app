// Date-range utilities for the reporting dashboard.

import type { DailySeriesPoint } from '../types'

export type RangePreset = '7d' | '14d' | '30d' | 'mtd' | 'all' | 'custom'

export interface ResolvedRange {
  start: string
  end: string
  prevStart: string
  prevEnd: string
  days: number
  label: string
}

export function resolveRange(
  series: DailySeriesPoint[],
  preset: RangePreset,
  now: Date = new Date(),
): ResolvedRange | null {
  if (series.length === 0) return null
  if (preset === 'custom') return null // handled by the component via customRange()
  const sorted = series.slice().sort((a, b) => a.date.localeCompare(b.date))
  const lastDate = sorted[sorted.length - 1].date
  const firstDate = sorted[0].date

  // Today is excluded from every window — the current day's data is always
  // incomplete (Amazon reporting lags). The effective anchor is the most
  // recent *complete* day: min(lastDataDate, yesterday).
  const todayStr = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())))
  const yesterdayStr = iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 86_400_000))
  const effectiveEnd = lastDate >= todayStr ? yesterdayStr : lastDate

  if (preset === 'all') {
    const days = daysInclusive(firstDate, effectiveEnd)
    const halfPoint = Math.floor(sorted.length / 2)
    const prevStart = sorted[0].date
    const prevEnd = sorted[Math.max(0, halfPoint - 1)].date
    return { start: firstDate, end: effectiveEnd, prevStart, prevEnd, days, label: 'All synced' }
  }

  if (preset === 'mtd') {
    const y = now.getUTCFullYear(), mo = now.getUTCMonth()
    const monthStart = iso(new Date(Date.UTC(y, mo, 1)))
    // End at the last complete day this month (yesterday), clamped to the month start.
    const end = effectiveEnd >= monthStart ? effectiveEnd : monthStart
    const days = Math.max(1, daysInclusive(monthStart, end))
    // Comparison = the same number of days at the start of the prior month.
    const prevMonthStart = new Date(Date.UTC(y, mo - 1, 1))
    const prevStart = iso(prevMonthStart)
    const prevEnd = iso(new Date(prevMonthStart.getTime() + (days - 1) * 86_400_000))
    return { start: monthStart, end, prevStart, prevEnd, days, label: 'Month to date' }
  }

  const n = preset === '7d' ? 7 : preset === '14d' ? 14 : 30
  const endDate = new Date(effectiveEnd + 'T00:00:00Z')
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

/**
 * Builds a ResolvedRange from explicit start/end dates (YYYY-MM-DD). The
 * comparison window is the same number of days immediately before `start`.
 * Returns null if the dates are missing or out of order.
 */
export function customRange(start: string, end: string): ResolvedRange | null {
  if (!start || !end) return null
  if (start > end) [start, end] = [end, start]
  const days = daysInclusive(start, end)
  const startDate = new Date(start + 'T00:00:00Z')
  const prevEnd = new Date(startDate.getTime() - 86_400_000)
  const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86_400_000)
  return {
    start,
    end,
    prevStart: iso(prevStart),
    prevEnd: iso(prevEnd),
    days,
    label: 'Custom range',
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
