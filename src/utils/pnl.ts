// P&L calculations. Pure functions only — no React, no IO.
// Operates on parsed report payloads and applies an optional scenario.

import type {
  CampaignRow,
  ClientGoals,
  DailySeriesPoint,
  ParentAsinRow,
  Scenario,
  SkuRow,
  SkuStatus,
} from '../types'
import type {
  AdvertisedProductData,
  BulkCampaignData,
  BusinessReportData,
  CogsMappingData,
  FeePreviewData,
  MasterProfitData,
  StorageFeeData,
} from './parsers'

export interface MergedReports {
  masterProfit?: MasterProfitData
  bulkCampaigns?: BulkCampaignData
  businessReport?: BusinessReportData
  advertisedProduct?: AdvertisedProductData
  feePreview?: FeePreviewData
  storageFee?: StorageFeeData
  cogsMapping?: CogsMappingData
}

export interface DataQualityIssue {
  level: 'info' | 'warn' | 'critical'
  message: string
  count?: number
  source?: string
}

export interface EnrichedSkus {
  skus: SkuRow[]
  parents: ParentAsinRow[]
  issues: DataQualityIssue[]
}

const noScenario: Scenario = {
  id: 'none', name: 'Baseline',
  adSpendMultiplier: 1, cogsAdjustment: 0, priceAdjustment: 0, couponRateOverride: null,
  createdAt: '',
}

export function applyScenario(row: SkuRow, scenario: Scenario | null | undefined): SkuRow {
  const sc = scenario ?? noScenario
  const priceMul = 1 + (sc.priceAdjustment / 100)
  const cogsMul = 1 + (sc.cogsAdjustment / 100)
  const adMul = sc.adSpendMultiplier
  const couponRate = sc.couponRateOverride

  const sales = row.sales * priceMul
  const cogs = row.cogs * cogsMul * row.units // cogs is unit cost in some sources, total in others — assume row.cogs is total
  // Heuristic: if cogs total is > sales, it's likely unit cost — convert.
  const cogsTotal = row.cogs > row.sales && row.units > 0 ? row.cogs * row.units : row.cogs
  const adSpend = row.adSpend * adMul
  const couponCosts = couponRate != null ? (sales * (couponRate / 100)) : row.couponCosts

  const fees = row.referralFees + row.fbaFees + row.storageFees + row.shippingToAmazon
  const grossProfitBeforeAds = sales - fees - cogsTotal - couponCosts
  const profit = grossProfitBeforeAds - adSpend
  const margin = sales > 0 ? (profit / sales) * 100 : 0
  const tacos = sales > 0 ? (adSpend / sales) * 100 : 0

  // Break-even TACOS = (Sales - Fees - COGS - Coupon) / Sales × 100
  const breakEvenTacos = sales > 0 ? Math.max(0, (grossProfitBeforeAds / sales) * 100) : 0
  // Max profitable ad spend = whatever ad spend brings profit to 0.
  const maxProfitableAdSpend = Math.max(0, grossProfitBeforeAds)

  return {
    ...row,
    sales,
    cogs: cogsTotal, // store as total
    adSpend,
    couponCosts,
    profit,
    margin,
    tacos,
    breakEvenTacos,
    maxProfitableAdSpend,
    status: statusFor({ profit, margin, tacos, breakEvenTacos, units: row.units, sales }),
  }
}

function statusFor(args: { profit: number; margin: number; tacos: number; breakEvenTacos: number; units: number; sales: number }): SkuStatus {
  const { profit, margin, tacos, breakEvenTacos, units, sales } = args
  if (sales === 0 && units === 0) return 'inactive'
  if (profit < 0) return 'unprofitable'                 // never a Scale Candidate when unprofitable
  if (margin >= 25 && tacos < breakEvenTacos * 0.6) return 'profit_leader'
  if (margin >= 15 && tacos < breakEvenTacos * 0.85) return 'scale_candidate'
  if (profit > 0 && tacos >= breakEvenTacos * 0.85) return 'optimize'
  if (profit >= 0 && profit < (sales * 0.02)) return 'breakeven'
  return 'optimize'
}

export function statusLabel(s: SkuStatus | undefined): string {
  switch (s) {
    case 'profit_leader': return 'Profit Leader'
    case 'scale_candidate': return 'Scale Candidate'
    case 'optimize': return 'Optimize'
    case 'breakeven': return 'Break-Even'
    case 'unprofitable': return 'Unprofitable'
    case 'inactive': return 'Inactive'
    default: return '—'
  }
}

export function statusTone(s: SkuStatus | undefined): 'mint' | 'peri' | 'gold' | 'lavender' | 'blush' | 'mute' {
  switch (s) {
    case 'profit_leader': return 'mint'
    case 'scale_candidate': return 'peri'
    case 'optimize': return 'gold'
    case 'breakeven': return 'lavender'
    case 'unprofitable': return 'blush'
    default: return 'mute'
  }
}

export function mergeReportsIntoSkus(reports: MergedReports, scenario: Scenario | null = null): EnrichedSkus {
  const issues: DataQualityIssue[] = []
  const master = reports.masterProfit?.rows ?? []

  // Index helpers
  const cogsBySku = new Map<string, number>()
  for (const r of reports.cogsMapping?.bySku ?? []) cogsBySku.set(r.sku, r.cogs)

  const storageByAsin = new Map<string, number>()
  for (const r of reports.storageFee?.bySku ?? []) {
    if (r.asin) storageByAsin.set(r.asin, (storageByAsin.get(r.asin) ?? 0) + r.storageFee)
  }

  const feeByAsin = new Map<string, { referral: number; fba: number }>()
  for (const r of reports.feePreview?.bySku ?? []) feeByAsin.set(r.asin, { referral: r.referralFee, fba: r.fbaFee })

  const adByAsin = new Map<string, { spend: number; sales: number; orders: number }>()
  for (const r of reports.advertisedProduct?.byAsin ?? []) {
    const existing = adByAsin.get(r.asin) ?? { spend: 0, sales: 0, orders: 0 }
    adByAsin.set(r.asin, { spend: existing.spend + r.spend, sales: existing.sales + r.sales, orders: existing.orders + r.orders })
  }

  // If no master profit rows, synthesize from advertised product + cogs mapping.
  let baseRows: SkuRow[] = master
  if (baseRows.length === 0 && adByAsin.size > 0) {
    issues.push({ level: 'warn', message: 'No Master Profit Matrix — synthesizing SKU rows from Advertised Product Report. COGS and fees may be incomplete.' })
    baseRows = []
    for (const [asin, ad] of adByAsin.entries()) {
      const cogs = cogsBySku.get(asin) ?? 0
      baseRows.push({
        sku: asin, asin, sales: 0, units: ad.orders,
        referralFees: feeByAsin.get(asin)?.referral ?? 0,
        fbaFees: feeByAsin.get(asin)?.fba ?? 0,
        storageFees: storageByAsin.get(asin) ?? 0,
        shippingToAmazon: 0, cogs, adSpend: ad.spend, adSales: ad.sales, couponCosts: 0,
      })
    }
  }

  // Enrich each base row.
  const enriched: SkuRow[] = []
  let missingCogs = 0, missingFees = 0
  for (const r of baseRows) {
    const merged: SkuRow = { ...r }
    if (!merged.cogs && r.sku && cogsBySku.has(r.sku)) {
      merged.cogs = cogsBySku.get(r.sku) ?? 0
    }
    if (!merged.cogs) missingCogs++

    if (!merged.referralFees || !merged.fbaFees) {
      const f = r.asin ? feeByAsin.get(r.asin) : undefined
      if (f) {
        if (!merged.referralFees) merged.referralFees = f.referral * (r.units || 1)
        if (!merged.fbaFees) merged.fbaFees = f.fba * (r.units || 1)
      }
    }
    if (!merged.referralFees && !merged.fbaFees) missingFees++

    if (!merged.storageFees && r.asin) {
      merged.storageFees = storageByAsin.get(r.asin) ?? 0
    }

    if (!merged.adSpend && r.asin) {
      const ad = adByAsin.get(r.asin)
      if (ad) {
        merged.adSpend = ad.spend
        merged.adSales = ad.sales
      }
    }

    enriched.push(applyScenario(merged, scenario))
  }

  if (missingCogs > 0) issues.push({ level: 'warn', message: 'COGS missing for some SKUs', count: missingCogs, source: 'COGS mapping' })
  if (missingFees > 0) issues.push({ level: 'warn', message: 'Referral / FBA fees missing for some SKUs', count: missingFees, source: 'Fee Preview' })

  // Group by parent ASIN
  const parents = aggregateParents(enriched)

  return { skus: enriched, parents, issues }
}

export function aggregateParents(skus: SkuRow[]): ParentAsinRow[] {
  const byParent = new Map<string, SkuRow[]>()
  for (const s of skus) {
    const key = s.parentAsin ?? s.asin ?? s.sku
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(s)
  }
  const out: ParentAsinRow[] = []
  for (const [parent, rows] of byParent) {
    const sales = sum(rows.map(r => r.sales))
    const adSpend = sum(rows.map(r => r.adSpend))
    const adSales = sum(rows.map(r => r.adSales))
    const cogs = sum(rows.map(r => r.cogs))
    const fees = sum(rows.map(r => r.referralFees + r.fbaFees + r.storageFees + r.shippingToAmazon))
    const profit = sum(rows.map(r => r.profit ?? 0))
    const margin = sales > 0 ? (profit / sales) * 100 : 0
    const tacos = sales > 0 ? (adSpend / sales) * 100 : 0
    const breakEvenTacos = sales > 0 ? Math.max(0, ((sales - fees - cogs - sum(rows.map(r => r.couponCosts))) / sales) * 100) : 0
    const status = statusFor({
      profit, margin, tacos, breakEvenTacos,
      units: sum(rows.map(r => r.units)), sales,
    })
    out.push({
      parentAsin: parent,
      title: rows.find(r => r.title)?.title,
      childCount: rows.length,
      sales, adSpend, adSales, cogs, fees, profit, margin, tacos, breakEvenTacos,
      units: sum(rows.map(r => r.units)),
      status,
      children: rows.slice().sort((a, b) => b.sales - a.sales),
    })
  }
  out.sort((a, b) => b.sales - a.sales)
  return out
}

function sum(xs: number[]): number {
  let t = 0
  for (const x of xs) if (Number.isFinite(x)) t += x
  return t
}

// ---------- Reporting Dashboard aggregates ----------

export interface ReportingTotals {
  spend: number
  adSales: number
  tacos: number     // %
  roas: number      // x
  orders: number
  totalOrders: number  // total order items (Business Report) — all sources
  totalSales: number
  organicSales: number
  impressions: number
  clicks: number
  ctr: number
  cvr: number
  cpc: number
  perDaySpend: number
  perDaySales: number
  days: number
}

export interface ReportingComparison {
  current: ReportingTotals
  previous: ReportingTotals
  startDate: string
  endDate: string
  prevStartDate: string
  prevEndDate: string
  series: DailySeriesPoint[]
  prevSeries: DailySeriesPoint[]
}

export function emptyTotals(): ReportingTotals {
  return {
    spend: 0, adSales: 0, tacos: 0, roas: 0, orders: 0, totalOrders: 0,
    totalSales: 0, organicSales: 0, impressions: 0, clicks: 0,
    ctr: 0, cvr: 0, cpc: 0, perDaySpend: 0, perDaySales: 0, days: 0,
  }
}

export function totalsFromSeries(series: DailySeriesPoint[], days?: number): ReportingTotals {
  const spend = sum(series.map(s => s.spend))
  const adSales = sum(series.map(s => s.adSales))
  const orders = sum(series.map(s => s.orders))
  const totalOrders = sum(series.map(s => s.totalOrders ?? 0))
  const impressions = sum(series.map(s => s.impressions))
  const clicks = sum(series.map(s => s.clicks))
  const totalSales = sum(series.map(s => s.totalSales ?? 0))
  const organicSales = Math.max(0, totalSales - adSales)
  const d = days ?? series.length
  return {
    spend, adSales, orders, totalOrders, impressions, clicks,
    totalSales, organicSales,
    tacos: totalSales > 0 ? (spend / totalSales) * 100 : 0,
    roas: spend > 0 ? adSales / spend : 0,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cvr: clicks > 0 ? (orders / clicks) * 100 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    perDaySpend: d > 0 ? spend / d : 0,
    perDaySales: d > 0 ? totalSales / d : 0,
    days: d,
  }
}

export function adProductSummary(campaigns: CampaignRow[]) {
  const groups: Array<{ type: 'SP' | 'SB' | 'SD' | 'OTHER'; label: string; count: number; spend: number; sales: number; roas: number; acos: number; share: number }> = []
  const types: Array<'SP' | 'SB' | 'SD'> = ['SP', 'SB', 'SD']
  const labels: Record<string, string> = { SP: 'Sponsored Products', SB: 'Sponsored Brands', SD: 'Sponsored Display' }
  const totalSpend = sum(campaigns.map(c => c.spend))
  for (const t of types) {
    const rows = campaigns.filter(c => c.type === t)
    const spend = sum(rows.map(c => c.spend))
    const sales = sum(rows.map(c => c.adSales))
    groups.push({
      type: t,
      label: labels[t],
      count: rows.length,
      spend,
      sales,
      roas: spend > 0 ? sales / spend : 0,
      acos: sales > 0 ? (spend / sales) * 100 : 0,
      share: totalSpend > 0 ? (spend / totalSpend) * 100 : 0,
    })
  }
  const other = campaigns.filter(c => c.type === 'OTHER')
  if (other.length > 0) {
    const spend = sum(other.map(c => c.spend))
    const sales = sum(other.map(c => c.adSales))
    groups.push({
      type: 'OTHER', label: 'Other', count: other.length, spend, sales,
      roas: spend > 0 ? sales / spend : 0,
      acos: sales > 0 ? (spend / sales) * 100 : 0,
      share: totalSpend > 0 ? (spend / totalSpend) * 100 : 0,
    })
  }
  return groups
}

export interface PortfolioGroup {
  name: string
  count: number
  spend: number
  sales: number
  orders: number
  impressions: number
  clicks: number
  roas: number
  acos: number
  cpc: number
  ctr: number
  cvr: number
  shareSpend: number   // % of total ad spend
  shareSales: number   // % of total ad sales
  unassigned: boolean
}

// Roll campaigns up by Amazon portfolio. Campaigns with no portfolio collapse
// into a single "Unassigned" group, which is always sorted last. Ratios are
// recomputed from the summed raw metrics (never averaged) so they stay exact.
export function portfolioSummary(campaigns: CampaignRow[]): PortfolioGroup[] {
  const totalSpend = sum(campaigns.map(c => c.spend))
  const totalSales = sum(campaigns.map(c => c.adSales))
  const map = new Map<string, { name: string; count: number; spend: number; sales: number; orders: number; impressions: number; clicks: number; unassigned: boolean }>()
  for (const c of campaigns) {
    const named = c.portfolio && c.portfolio.trim()
    const name = named ? c.portfolio!.trim() : 'Unassigned'
    const g = map.get(name) ?? { name, count: 0, spend: 0, sales: 0, orders: 0, impressions: 0, clicks: 0, unassigned: !named }
    g.count += 1
    g.spend += c.spend || 0
    g.sales += c.adSales || 0
    g.orders += c.orders || 0
    g.impressions += c.impressions || 0
    g.clicks += c.clicks || 0
    map.set(name, g)
  }
  const groups: PortfolioGroup[] = Array.from(map.values()).map(g => ({
    ...g,
    roas: g.spend > 0 ? g.sales / g.spend : 0,
    acos: g.sales > 0 ? (g.spend / g.sales) * 100 : 0,
    cpc: g.clicks > 0 ? g.spend / g.clicks : 0,
    ctr: g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0,
    cvr: g.clicks > 0 ? (g.orders / g.clicks) * 100 : 0,
    shareSpend: totalSpend > 0 ? (g.spend / totalSpend) * 100 : 0,
    shareSales: totalSales > 0 ? (g.sales / totalSales) * 100 : 0,
  }))
  groups.sort((a, b) => {
    if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1
    return b.spend - a.spend
  })
  return groups
}

// ---------- Month projection ----------

export interface MonthProjection {
  monthLabel: string
  daysInMonth: number
  elapsedDays: number       // days this month that actually have data
  daysRemaining: number
  hasTotalSales: boolean
  mtd: { spend: number; adSales: number; totalSales: number; orders: number }
  perDay: { spend: number; adSales: number; totalSales: number; orders: number }
  projected: {
    spend: number
    adSales: number
    totalSales: number
    orders: number
    roas: number
    tacos: number          // NaN when total sales unavailable
  }
  goals: { monthlyAdBudget: number; desiredSales: number }
  pace: {
    spendVsBudgetPct: number  // projected spend / budget × 100
    salesVsGoalPct: number    // projected sales / desired × 100
  }
}

/**
 * Extrapolates the current month's run-rate to a full-month projection.
 * Uses only complete days (today is excluded). Run-rate is computed over the
 * days that actually carry data, then projected across the whole month.
 * Returns null if there isn't at least one complete day of data this month.
 */
export function projectCurrentMonth(
  series: DailySeriesPoint[],
  goals: ClientGoals,
  now: Date = new Date(),
): MonthProjection | null {
  if (!series || series.length === 0) return null
  const y = now.getUTCFullYear(), mo = now.getUTCMonth()
  const monthStart = isoUTC(y, mo, 1)
  const todayDay = now.getUTCDate()
  const completeDays = todayDay - 1 // exclude today
  if (completeDays < 1) return null  // too early in the month to project
  const monthEnd = isoUTC(y, mo, completeDays)
  const daysInMonth = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()

  const pts = series.filter(p => p.date >= monthStart && p.date <= monthEnd)
  if (pts.length === 0) return null

  let spend = 0, adSales = 0, totalSales = 0, orders = 0, hasTotal = false
  for (const p of pts) {
    spend += p.spend
    adSales += p.adSales
    orders += p.orders
    if (p.totalSales != null) { totalSales += p.totalSales; hasTotal = true }
  }
  const elapsedDays = pts.length
  const effSales = hasTotal ? totalSales : adSales

  const perDay = {
    spend: spend / elapsedDays,
    adSales: adSales / elapsedDays,
    totalSales: effSales / elapsedDays,
    orders: orders / elapsedDays,
  }
  const projSpend = perDay.spend * daysInMonth
  const projAdSales = perDay.adSales * daysInMonth
  const projTotalSales = perDay.totalSales * daysInMonth
  const projOrders = perDay.orders * daysInMonth
  const projRoas = projSpend > 0 ? projAdSales / projSpend : 0
  const projTacos = hasTotal && projTotalSales > 0 ? (projSpend / projTotalSales) * 100 : NaN

  const desiredSales = goals.currentProjectedMonthlySales || goals.desiredNext30DaySales || 0

  return {
    monthLabel: new Date(Date.UTC(y, mo, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    daysInMonth,
    elapsedDays,
    daysRemaining: daysInMonth - completeDays,
    hasTotalSales: hasTotal,
    mtd: { spend, adSales, totalSales: effSales, orders },
    perDay,
    projected: {
      spend: projSpend,
      adSales: projAdSales,
      totalSales: projTotalSales,
      orders: projOrders,
      roas: projRoas,
      tacos: projTacos,
    },
    goals: { monthlyAdBudget: goals.monthlyAdBudget, desiredSales },
    pace: {
      spendVsBudgetPct: goals.monthlyAdBudget > 0 ? (projSpend / goals.monthlyAdBudget) * 100 : NaN,
      salesVsGoalPct: desiredSales > 0 ? (projTotalSales / desiredSales) * 100 : NaN,
    },
  }
}

function isoUTC(y: number, mo: number, day: number): string {
  return `${y}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// ---------- Goal realism ----------

export interface GoalRealism {
  feasible: boolean
  message: string
  level: 'good' | 'warn' | 'bad'
  factors: Array<{ label: string; value: string }>
}

export function evaluateGoalRealism(goals: ClientGoals, totals: ReportingTotals | null): GoalRealism {
  const factors: GoalRealism['factors'] = []
  if (!totals || totals.totalSales === 0) {
    return {
      feasible: false,
      level: 'warn',
      message: 'Upload a bulk campaign export with daily data to evaluate goal realism against current run-rate.',
      factors,
    }
  }

  const dailyRunRate = totals.perDaySales
  const projected30 = dailyRunRate * 30
  const required30 = goals.desiredNext30DaySales
  const gap = required30 - projected30
  const gapPct = required30 > 0 ? (gap / required30) * 100 : 0

  factors.push({ label: 'Current run-rate (30d)', value: projected30.toFixed(0) })
  factors.push({ label: 'Desired next 30 days', value: required30.toFixed(0) })
  factors.push({ label: 'Gap', value: gap.toFixed(0) })
  factors.push({ label: 'CVR observed', value: totals.cvr.toFixed(2) + '%' })

  if (gap <= 0) {
    return { feasible: true, level: 'good', message: 'Current run-rate already meets desired sales.', factors }
  }
  // Estimate extra clicks needed at current CVR and AOV.
  const aov = totals.orders > 0 ? totals.adSales / totals.orders : 0
  const extraOrders = aov > 0 ? gap / aov : 0
  const extraClicks = totals.cvr > 0 ? extraOrders / (totals.cvr / 100) : 0
  const extraSpend = extraClicks * (totals.cpc || 0)
  const remainingBudget = goals.monthlyAdBudget - (totals.perDaySpend * 30)

  factors.push({ label: 'Extra clicks needed', value: extraClicks.toFixed(0) })
  factors.push({ label: 'Extra spend implied', value: extraSpend.toFixed(0) })
  factors.push({ label: 'Budget headroom', value: remainingBudget.toFixed(0) })

  if (gapPct > 50) {
    return { feasible: false, level: 'bad', message: `Goal is ${gapPct.toFixed(0)}% above current run-rate — unlikely without major creative or pricing change.`, factors }
  }
  if (extraSpend > remainingBudget * 1.25) {
    return { feasible: false, level: 'bad', message: 'Required extra spend exceeds budget headroom by more than 25%.', factors }
  }
  if (extraSpend > remainingBudget) {
    return { feasible: false, level: 'warn', message: 'Achievable only with budget increase. Required spend exceeds headroom.', factors }
  }
  return { feasible: true, level: 'good', message: 'Achievable with current CVR if you redeploy headroom into incremental clicks.', factors }
}
