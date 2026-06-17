// Defensive formatters — never render NaN/Infinity/undefined/null. Always degrade to "—".

import type { Currency } from '../types'

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', CAD: 'C$', MXN: 'MX$',
  JPY: '¥', AUD: 'A$', SEK: 'kr', PLN: 'zł', TRY: '₺',
  AED: 'AED', INR: '₹', SGD: 'S$', BRL: 'R$',
}

const NUM_FMT_CACHE = new Map<string, Intl.NumberFormat>()

function fmt(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(opts)
  let f = NUM_FMT_CACHE.get(key)
  if (!f) {
    f = new Intl.NumberFormat('en-US', opts)
    NUM_FMT_CACHE.set(key, f)
  }
  return f
}

export function isFinite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

export function num(n: unknown, decimals = 0): string {
  if (!isFinite(n)) return '—'
  return fmt({ maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(n as number)
}

export function compact(n: unknown, decimals = 1): string {
  if (!isFinite(n)) return '—'
  const v = n as number
  if (Math.abs(v) < 1000) return num(v, 0)
  return fmt({
    notation: 'compact',
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  }).format(v)
}

export function currency(n: unknown, ccy: Currency = 'USD', compactMode = false): string {
  if (!isFinite(n)) return '—'
  const v = n as number
  const sym = CURRENCY_SYMBOL[ccy] ?? '$'
  if (compactMode && Math.abs(v) >= 1000) {
    return `${sym}${compact(v, 1)}`
  }
  // For currencies that conventionally have no minor units (JPY), show 0 decimals.
  const decimals = ccy === 'JPY' ? 0 : (Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 0 : 2)
  return `${sym}${fmt({ maximumFractionDigits: decimals, minimumFractionDigits: decimals === 2 ? 2 : 0 }).format(v)}`
}

export function currencyExact(n: unknown, ccy: Currency = 'USD'): string {
  if (!isFinite(n)) return '—'
  const sym = CURRENCY_SYMBOL[ccy] ?? '$'
  return `${sym}${fmt({ maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(n as number)}`
}

// Full number with thousands separators and NO cents (e.g. $1,432). Never
// abbreviates — use for headline KPI figures where the exact whole figure matters.
export function currencyWhole(n: unknown, ccy: Currency = 'USD'): string {
  if (!isFinite(n)) return '—'
  const sym = CURRENCY_SYMBOL[ccy] ?? '$'
  return `${sym}${fmt({ maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(n as number)}`
}

export function percent(n: unknown, decimals = 1): string {
  if (!isFinite(n)) return '—'
  return `${fmt({ maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(n as number)}%`
}

export function multiplier(n: unknown, decimals = 2): string {
  if (!isFinite(n)) return '—'
  return `${fmt({ maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(n as number)}×`
}

export function signed(n: unknown, decimals = 1): string {
  if (!isFinite(n)) return '—'
  const v = n as number
  const sign = v > 0 ? '+' : v < 0 ? '' : ''
  return `${sign}${fmt({ maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(v)}`
}

export function signedPct(n: unknown, decimals = 1): string {
  if (!isFinite(n)) return '—'
  return `${signed(n, decimals)}%`
}

export function deltaPct(current: number, previous: number): number {
  if (!isFinite(current) || !isFinite(previous) || previous === 0) return NaN
  return ((current - previous) / Math.abs(previous)) * 100
}

export function safeDiv(a: number, b: number): number {
  if (!isFinite(a) || !isFinite(b) || b === 0) return NaN
  return a / b
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export function dateLabel(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function dateRangeLabel(start: string, end: string): string {
  const a = new Date(start), b = new Date(end)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return '—'
  return `${a.toLocaleDateString('en-CA')} → ${b.toLocaleDateString('en-CA')}`
}

export function daysBetween(start: string, end: string): number {
  const a = new Date(start).getTime(), b = new Date(end).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1)
}

export function timestamp(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mn = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${dd}/${mm}/${yy} ${hh}:${mn}:${ss}`
}

export function relativeTime(iso?: string, now = new Date()): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const diff = now.getTime() - t
  if (diff < 60_000) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}
