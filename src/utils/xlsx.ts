// Defensive xlsx helpers. All parsing happens in the browser via SheetJS.

import * as XLSX from 'xlsx'

export type Row = Record<string, unknown>

export async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  const buf = await file.arrayBuffer()
  return XLSX.read(buf, { type: 'array', cellDates: true, cellNF: false, cellText: false })
}

export function sheetToJson(ws: XLSX.WorkSheet): Row[] {
  return XLSX.utils.sheet_to_json<Row>(ws, { defval: null, raw: true, blankrows: false })
}

const NORMALIZE_RE = /[^a-z0-9]+/gi
export function normKey(s: string): string {
  return String(s ?? '').toLowerCase().replace(NORMALIZE_RE, '')
}

/**
 * Look up the first matching column from a list of candidates (case/punctuation
 * insensitive). Returns null if none match.
 */
export function pick(row: Row, candidates: string[]): unknown {
  const keys = Object.keys(row)
  const map = new Map<string, string>()
  for (const k of keys) map.set(normKey(k), k)
  for (const c of candidates) {
    const norm = normKey(c)
    const actualKey = map.get(norm)
    if (actualKey) return row[actualKey]
  }
  return null
}

export function toNumber(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const s = v.replace(/[\s,$€£¥%×x]/gi, '').replace(/\((.*)\)/, '-$1').trim()
    if (!s) return 0
    const n = Number(s)
    return Number.isFinite(n) ? n : 0
  }
  if (typeof v === 'boolean') return v ? 1 : 0
  return 0
}

export function toStr(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number') return String(v)
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v)
}

export function toDateISO(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  if (typeof v === 'number') {
    // Excel serial
    const epoch = new Date(Date.UTC(1899, 11, 30))
    const ms = epoch.getTime() + v * 86_400_000
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  if (typeof v === 'string') {
    const s = v.trim()
    if (!s) return null
    // Try ISO first
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    // MM/DD/YYYY fallback
    const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/)
    if (m) {
      const mo = Number(m[1]), da = Number(m[2])
      let yr = Number(m[3])
      if (yr < 100) yr += 2000
      const d2 = new Date(Date.UTC(yr, mo - 1, da))
      return Number.isNaN(d2.getTime()) ? null : d2.toISOString().slice(0, 10)
    }
  }
  return null
}

export function findSheet(wb: XLSX.WorkBook, candidates: string[]): XLSX.WorkSheet | null {
  const norms = new Map(wb.SheetNames.map(n => [normKey(n), n]))
  for (const c of candidates) {
    const key = norms.get(normKey(c))
    if (key) return wb.Sheets[key]
  }
  // Looser contains-match
  for (const c of candidates) {
    const wanted = normKey(c)
    for (const name of wb.SheetNames) {
      if (normKey(name).includes(wanted)) return wb.Sheets[name]
    }
  }
  return null
}
