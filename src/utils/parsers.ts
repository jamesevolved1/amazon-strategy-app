// Report parsers. Each returns a typed parsed payload + warnings list.
// All formats use flexible column aliases — Amazon report headers vary by marketplace,
// vendor vs seller, and report generation.

import * as XLSX from 'xlsx'
import { findSheet, normKey, pick, readWorkbook, sheetToJson, toDateISO, toNumber, toStr } from './xlsx'
import type { CampaignRow, DailySeriesPoint, SkuRow, StrategyScorecard, StrategySeries } from '../types'

export interface ParseResult<T> {
  data: T
  warnings: string[]
  rowCount: number
}

// ---------- Master Profit Matrix ----------

export interface MasterProfitData {
  rows: SkuRow[]
}

export async function parseMasterProfit(file: File): Promise<ParseResult<MasterProfitData>> {
  const wb = await readWorkbook(file)
  const warnings: string[] = []

  const ws =
    findSheet(wb, ['Profit Matrix', 'Profit', 'P&L', 'PNL', 'Master', 'SKU P&L']) ?? wb.Sheets[wb.SheetNames[0]]
  if (!ws) {
    return { data: { rows: [] }, warnings: ['Workbook contains no sheets.'], rowCount: 0 }
  }

  const rows = sheetToJson(ws)
  const out: SkuRow[] = []

  for (const r of rows) {
    const sku = toStr(pick(r, ['SKU', 'Seller SKU', 'MSKU', 'Merchant SKU']))
    const asin = toStr(pick(r, ['ASIN', 'Child ASIN']))
    const parentAsin = toStr(pick(r, ['Parent ASIN', 'ParentAsin']))
    const title = toStr(pick(r, ['Title', 'Product Name', 'Item Name', 'Product Title']))
    if (!sku && !asin) continue

    const sales = toNumber(pick(r, ['Sales', 'Total Sales', 'Revenue', 'Ordered Product Sales', 'Gross Sales']))
    const units = toNumber(pick(r, ['Units', 'Units Sold', 'Quantity', 'Ordered Units']))
    const price = toNumber(pick(r, ['Price', 'Avg Price', 'Average Sale Price', 'ASP'])) || (units ? sales / units : 0)
    const referralFees = Math.abs(toNumber(pick(r, ['Referral Fee', 'Referral Fees', 'Commission'])))
    const fbaFees = Math.abs(toNumber(pick(r, ['FBA Fee', 'FBA Fees', 'Fulfillment Fee', 'FBA Fulfillment Fee'])))
    const storageFees = Math.abs(toNumber(pick(r, ['Storage Fee', 'Storage Fees', 'Monthly Storage Fee'])))
    const shippingToAmazon = Math.abs(toNumber(pick(r, ['Inbound', 'Inbound Shipping', 'Shipping to Amazon', 'Inbound Cost'])))
    const cogs = Math.abs(toNumber(pick(r, ['COGS', 'Cost of Goods', 'Unit Cost', 'Landed Cost'])))
    const adSpend = Math.abs(toNumber(pick(r, ['Ad Spend', 'Advertising', 'PPC Spend', 'Spend'])))
    const adSales = toNumber(pick(r, ['Ad Sales', 'Advertising Sales', 'Attributed Sales']))
    const couponCosts = Math.abs(toNumber(pick(r, ['Coupon', 'Coupons', 'Coupon Cost', 'Promotion'])))

    out.push({
      sku, asin: asin || undefined, parentAsin: parentAsin || undefined, title: title || undefined,
      sales, units, price, referralFees, fbaFees, storageFees, shippingToAmazon,
      cogs, adSpend, adSales, couponCosts,
    })
  }

  if (out.length === 0) warnings.push('No SKU rows recognized. Confirm the workbook has columns like SKU, Sales, Units, FBA Fee, COGS.')
  return { data: { rows: out }, warnings, rowCount: out.length }
}

// ---------- Bulk Campaign Export ----------

export interface BulkCampaignData {
  campaigns: CampaignRow[]
  daily?: DailySeriesPoint[]
}

const BULK_TAB_TO_TYPE: Array<{ name: string[]; type: CampaignRow['type'] }> = [
  { name: ['Sponsored Products Campaigns', 'SP Campaigns'], type: 'SP' },
  { name: ['Sponsored Brands Campaigns', 'SB Campaigns'], type: 'SB' },
  { name: ['Sponsored Display Campaigns', 'SD Campaigns'], type: 'SD' },
]

export async function parseBulkCampaigns(file: File): Promise<ParseResult<BulkCampaignData>> {
  const wb = await readWorkbook(file)
  const warnings: string[] = []
  const campaigns: CampaignRow[] = []
  const dailyMap = new Map<string, DailySeriesPoint>()

  for (const tab of BULK_TAB_TO_TYPE) {
    const ws = findSheet(wb, tab.name)
    if (!ws) continue
    const rows = sheetToJson(ws)
    for (const r of rows) {
      const entity = toStr(pick(r, ['Entity', 'Record Type']))
      // Most rows are ad groups/keywords. We want Campaign rows only for the table view,
      // but we still consume metrics from all rows aggregated by campaign name.
      const campaign = toStr(pick(r, ['Campaign Name', 'Campaign', 'Campaign Name (Informational only)']))
      if (!campaign) continue
      const isCampaignRow = entity ? normKey(entity).includes('campaign') : true

      if (!isCampaignRow) continue

      const campaignId = toStr(pick(r, ['Campaign ID', 'CampaignId']))
      const state = (toStr(pick(r, ['State', 'Campaign State'])).toLowerCase() as 'enabled' | 'paused' | 'archived') || undefined
      const impressions = toNumber(pick(r, ['Impressions']))
      const clicks = toNumber(pick(r, ['Clicks']))
      const spend = toNumber(pick(r, ['Spend', 'Cost']))
      const adSales = toNumber(pick(r, ['Sales', 'Sales (Informational only)', '7 Day Total Sales', '14 Day Total Sales', 'Total Sales']))
      const orders = toNumber(pick(r, ['Orders', '7 Day Total Orders (#)', '14 Day Total Orders (#)']))

      const ctr = clicks > 0 && impressions > 0 ? (clicks / impressions) * 100 : 0
      const cvr = clicks > 0 ? (orders / clicks) * 100 : 0
      const roas = spend > 0 ? adSales / spend : 0
      const acos = adSales > 0 ? (spend / adSales) * 100 : 0
      const cpc = clicks > 0 ? spend / clicks : 0

      campaigns.push({
        campaign, campaignId: campaignId || undefined, type: tab.type,
        state, impressions, clicks, spend, adSales, orders,
        ctr, cvr, roas, acos, cpc,
      })
    }
  }

  // Daily-series sheet may be present in some exports
  const dailyWs = findSheet(wb, ['Daily', 'Daily Performance', 'Daily Spend', 'Daily Report'])
  if (dailyWs) {
    const rows = sheetToJson(dailyWs)
    for (const r of rows) {
      const date = toDateISO(pick(r, ['Date', 'Day']))
      if (!date) continue
      const spend = toNumber(pick(r, ['Spend', 'Cost']))
      const adSales = toNumber(pick(r, ['Sales', 'Ad Sales']))
      const orders = toNumber(pick(r, ['Orders']))
      const impressions = toNumber(pick(r, ['Impressions']))
      const clicks = toNumber(pick(r, ['Clicks']))
      const existing = dailyMap.get(date) ?? { date, spend: 0, adSales: 0, orders: 0, impressions: 0, clicks: 0 }
      existing.spend += spend
      existing.adSales += adSales
      existing.orders += orders
      existing.impressions += impressions
      existing.clicks += clicks
      dailyMap.set(date, existing)
    }
  }

  if (campaigns.length === 0) {
    warnings.push('No campaign rows found across SP / SB / SD tabs. Confirm the workbook is an Amazon bulk campaign export.')
  }

  const daily = dailyMap.size > 0
    ? Array.from(dailyMap.values())
        .map(p => ({ ...p, ctr: p.impressions ? (p.clicks / p.impressions) * 100 : 0, cvr: p.clicks ? (p.orders / p.clicks) * 100 : 0 }))
        .sort((a, b) => a.date.localeCompare(b.date))
    : undefined

  return { data: { campaigns, daily }, warnings, rowCount: campaigns.length }
}

// ---------- Business Report ----------

export interface BusinessReportData {
  daily: DailySeriesPoint[]
  bySku: Array<{ sku: string; asin?: string; sessions: number; pageViews: number; unitsOrdered: number; sales: number }>
}

export async function parseBusinessReport(file: File): Promise<ParseResult<BusinessReportData>> {
  const wb = await readWorkbook(file)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const warnings: string[] = []
  if (!ws) return { data: { daily: [], bySku: [] }, warnings: ['Empty workbook.'], rowCount: 0 }
  const rows = sheetToJson(ws)

  // Could be daily-by-date or by-SKU. Detect.
  const hasDate = rows.some(r => toDateISO(pick(r, ['Date'])))
  const daily: DailySeriesPoint[] = []
  const bySku: BusinessReportData['bySku'] = []

  if (hasDate) {
    const map = new Map<string, DailySeriesPoint>()
    for (const r of rows) {
      const date = toDateISO(pick(r, ['Date', 'Day']))
      if (!date) continue
      const totalSales = toNumber(pick(r, ['Ordered Product Sales', 'Total Sales', 'Sales']))
      const orders = toNumber(pick(r, ['Total Order Items', 'Orders', 'Units Ordered']))
      const sessions = toNumber(pick(r, ['Sessions', 'Sessions - Total']))
      const pageViews = toNumber(pick(r, ['Page Views', 'Page Views - Total']))
      const existing = map.get(date) ?? { date, spend: 0, adSales: 0, orders: 0, impressions: 0, clicks: 0 }
      existing.totalSales = (existing.totalSales ?? 0) + totalSales
      existing.orders += orders
      existing.impressions += sessions
      existing.clicks += pageViews
      map.set(date, existing)
    }
    for (const v of map.values()) daily.push(v)
    daily.sort((a, b) => a.date.localeCompare(b.date))
  } else {
    for (const r of rows) {
      const sku = toStr(pick(r, ['SKU', 'Seller SKU', '(Child) SKU']))
      const asin = toStr(pick(r, ['ASIN', '(Child) ASIN']))
      if (!sku && !asin) continue
      bySku.push({
        sku: sku || asin,
        asin: asin || undefined,
        sessions: toNumber(pick(r, ['Sessions', 'Sessions - Total'])),
        pageViews: toNumber(pick(r, ['Page Views', 'Page Views - Total'])),
        unitsOrdered: toNumber(pick(r, ['Units Ordered', 'Total Order Items'])),
        sales: toNumber(pick(r, ['Ordered Product Sales', 'Total Sales'])),
      })
    }
  }

  if (daily.length === 0 && bySku.length === 0) {
    warnings.push('Business Report could not be recognized. Expected either date-level or SKU-level rows.')
  }
  return { data: { daily, bySku }, warnings, rowCount: daily.length + bySku.length }
}

// ---------- Advertised Product Report ----------

export interface AdvertisedProductData {
  byAsin: Array<{ asin: string; sku?: string; campaign?: string; impressions: number; clicks: number; spend: number; sales: number; orders: number }>
}

export async function parseAdvertisedProduct(file: File): Promise<ParseResult<AdvertisedProductData>> {
  const wb = await readWorkbook(file)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const warnings: string[] = []
  if (!ws) return { data: { byAsin: [] }, warnings: ['Empty workbook.'], rowCount: 0 }
  const rows = sheetToJson(ws)
  const byAsin: AdvertisedProductData['byAsin'] = []
  for (const r of rows) {
    const asin = toStr(pick(r, ['Advertised ASIN', 'ASIN']))
    if (!asin) continue
    byAsin.push({
      asin,
      sku: toStr(pick(r, ['Advertised SKU', 'SKU'])) || undefined,
      campaign: toStr(pick(r, ['Campaign Name', 'Campaign'])) || undefined,
      impressions: toNumber(pick(r, ['Impressions'])),
      clicks: toNumber(pick(r, ['Clicks'])),
      spend: toNumber(pick(r, ['Spend', 'Cost'])),
      sales: toNumber(pick(r, ['7 Day Total Sales', '14 Day Total Sales', 'Sales'])),
      orders: toNumber(pick(r, ['7 Day Total Orders (#)', 'Orders'])),
    })
  }
  if (byAsin.length === 0) warnings.push('Advertised Product Report did not match expected columns.')
  return { data: { byAsin }, warnings, rowCount: byAsin.length }
}

// ---------- Fee Preview Report ----------

export interface FeePreviewData {
  bySku: Array<{ sku?: string; asin: string; referralFee: number; fbaFee: number; estimatedFee: number; price?: number }>
}

export async function parseFeePreview(file: File): Promise<ParseResult<FeePreviewData>> {
  const wb = await readWorkbook(file)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const warnings: string[] = []
  if (!ws) return { data: { bySku: [] }, warnings: ['Empty workbook.'], rowCount: 0 }
  const rows = sheetToJson(ws)
  const bySku: FeePreviewData['bySku'] = []
  for (const r of rows) {
    const asin = toStr(pick(r, ['ASIN', 'Product ASIN']))
    if (!asin) continue
    bySku.push({
      asin,
      sku: toStr(pick(r, ['Merchant SKU', 'SKU'])) || undefined,
      referralFee: Math.abs(toNumber(pick(r, ['Estimated Referral Fee per Unit', 'Referral Fee', 'Referral Fees']))),
      fbaFee: Math.abs(toNumber(pick(r, ['Estimated Fulfillment Fee per Unit', 'FBA Fee', 'Fulfillment Fee']))),
      estimatedFee: Math.abs(toNumber(pick(r, ['Estimated Fee Total', 'Total Estimated Fee', 'Estimated Total Fee']))),
      price: toNumber(pick(r, ['Your Price', 'Price'])) || undefined,
    })
  }
  if (bySku.length === 0) warnings.push('Fee Preview Report did not match expected columns.')
  return { data: { bySku }, warnings, rowCount: bySku.length }
}

// ---------- Monthly Storage Fee Report ----------

export interface StorageFeeData {
  bySku: Array<{ asin: string; sku?: string; storageFee: number; volume?: number }>
}

export async function parseStorageFee(file: File): Promise<ParseResult<StorageFeeData>> {
  const wb = await readWorkbook(file)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const warnings: string[] = []
  if (!ws) return { data: { bySku: [] }, warnings: ['Empty workbook.'], rowCount: 0 }
  const rows = sheetToJson(ws)
  const bySku: StorageFeeData['bySku'] = []
  for (const r of rows) {
    const asin = toStr(pick(r, ['ASIN', 'Asin']))
    if (!asin) continue
    bySku.push({
      asin,
      sku: toStr(pick(r, ['FNSKU', 'Merchant SKU', 'SKU'])) || undefined,
      storageFee: Math.abs(toNumber(pick(r, ['Estimated Monthly Storage Fee', 'Estimated Total Item Storage Cost', 'Storage Fee']))),
      volume: toNumber(pick(r, ['Item Volume', 'Volume', 'Average Quantity On Hand']))|| undefined,
    })
  }
  if (bySku.length === 0) warnings.push('Storage Fee Report did not match expected columns.')
  return { data: { bySku }, warnings, rowCount: bySku.length }
}

// ---------- COGS Mapping ----------

export interface CogsMappingData {
  bySku: Array<{ sku: string; cogs: number; inboundCost?: number; title?: string }>
}

export async function parseCogsMapping(file: File): Promise<ParseResult<CogsMappingData>> {
  const wb = await readWorkbook(file)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const warnings: string[] = []
  if (!ws) return { data: { bySku: [] }, warnings: ['Empty workbook.'], rowCount: 0 }
  const rows = sheetToJson(ws)
  const bySku: CogsMappingData['bySku'] = []
  for (const r of rows) {
    const sku = toStr(pick(r, ['SKU', 'Merchant SKU', 'Seller SKU']))
    if (!sku) continue
    bySku.push({
      sku,
      cogs: Math.abs(toNumber(pick(r, ['COGS', 'Unit Cost', 'Cost of Goods', 'Landed Cost']))),
      inboundCost: toNumber(pick(r, ['Inbound', 'Inbound Cost', 'Shipping to Amazon'])) || undefined,
      title: toStr(pick(r, ['Title', 'Product Name'])) || undefined,
    })
  }
  if (bySku.length === 0) warnings.push('COGS mapping requires at minimum: SKU + COGS columns.')
  return { data: { bySku }, warnings, rowCount: bySku.length }
}

// ---------- Strategy Doc Report tab ----------

export async function parseStrategyDoc(file: File): Promise<ParseResult<StrategyScorecard | null>> {
  const wb = await readWorkbook(file)
  const warnings: string[] = []

  // Look for a tab named like "Report", "Strategy", "Scorecard"
  const ws = findSheet(wb, ['Report', 'Strategy Report', 'Scorecard', 'Dashboard']) ?? wb.Sheets[wb.SheetNames[0]]
  if (!ws) return { data: null, warnings: ['No Strategy Doc tab found.'], rowCount: 0 }

  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })

  // Treat first row with a 'Date' header as the start of a daily series.
  let headerIdx = -1
  let headers: string[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!Array.isArray(r)) continue
    const cells = r.map(c => toStr(c))
    if (cells.some(c => /^date$/i.test(c))) {
      headerIdx = i
      headers = cells
      break
    }
  }

  const series: StrategySeries = {
    dates: [], totalSales: [], organicSales: [], adSales: [],
    impressions: [], clicks: [], ctr: [], cvr: [],
  }
  let lastDate: string | null = null

  if (headerIdx >= 0) {
    const idx = {
      date: headers.findIndex(h => /^date$/i.test(h)),
      totalSales: headers.findIndex(h => /total sales/i.test(h)),
      organicSales: headers.findIndex(h => /organic/i.test(h)),
      adSales: headers.findIndex(h => /ad(\s|-)?sales|attributed/i.test(h)),
      impressions: headers.findIndex(h => /impressions/i.test(h)),
      clicks: headers.findIndex(h => /clicks/i.test(h)),
      ctr: headers.findIndex(h => /^ctr/i.test(h)),
      cvr: headers.findIndex(h => /cvr|conversion/i.test(h)),
    }
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i]
      if (!Array.isArray(r)) continue
      const date = idx.date >= 0 ? toDateISO(r[idx.date]) : null
      if (!date) continue
      lastDate = date
      series.dates.push(date)
      series.totalSales.push(idx.totalSales >= 0 ? toNumber(r[idx.totalSales]) : 0)
      series.organicSales.push(idx.organicSales >= 0 ? toNumber(r[idx.organicSales]) : 0)
      series.adSales.push(idx.adSales >= 0 ? toNumber(r[idx.adSales]) : 0)
      series.impressions.push(idx.impressions >= 0 ? toNumber(r[idx.impressions]) : 0)
      series.clicks.push(idx.clicks >= 0 ? toNumber(r[idx.clicks]) : 0)
      series.ctr.push(idx.ctr >= 0 ? toNumber(r[idx.ctr]) : 0)
      series.cvr.push(idx.cvr >= 0 ? toNumber(r[idx.cvr]) : 0)
    }
  }

  if (series.dates.length === 0) {
    return { data: null, warnings: ['Strategy Doc tab found, but no daily rows could be parsed.'], rowCount: 0 }
  }

  const last = series.dates[series.dates.length - 1]
  // Compute current month, prior month, projection.
  const lastDateObj = new Date(last + 'T00:00:00Z')
  const curMonth = lastDateObj.getUTCMonth()
  const curYear = lastDateObj.getUTCFullYear()

  const currentMonth = aggregateMonth(series, curYear, curMonth)
  const prior = curMonth === 0
    ? aggregateMonth(series, curYear - 1, 11)
    : aggregateMonth(series, curYear, curMonth - 1)

  // Projection: extrapolate current MTD forward based on days-in-month.
  const daysInMonth = new Date(Date.UTC(curYear, curMonth + 1, 0)).getUTCDate()
  const mtdDays = lastDateObj.getUTCDate()
  const factor = mtdDays > 0 ? daysInMonth / mtdDays : 1
  const projection = scaleMonth(currentMonth, factor, 'Projected ' + lastDateObj.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }))

  return {
    data: {
      currentMonth: { ...currentMonth, label: lastDateObj.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) + ' MTD' },
      priorMonth: prior,
      projection,
      dataCurrentThrough: lastDate || last,
      series,
    },
    warnings,
    rowCount: series.dates.length,
  }
}

function aggregateMonth(series: StrategySeries, year: number, month: number) {
  const m = { label: '', totalSales: 0, organicSales: 0, adSales: 0, impressions: 0, clicks: 0, spend: 0, orders: 0, ctr: 0, cvr: 0, roas: 0, tacos: 0 }
  let n = 0
  for (let i = 0; i < series.dates.length; i++) {
    const d = new Date(series.dates[i] + 'T00:00:00Z')
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month) continue
    m.totalSales += series.totalSales[i]
    m.organicSales += series.organicSales[i]
    m.adSales += series.adSales[i]
    m.impressions += series.impressions[i]
    m.clicks += series.clicks[i]
    n++
  }
  m.label = new Date(Date.UTC(year, month, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  m.ctr = m.impressions ? (m.clicks / m.impressions) * 100 : 0
  m.cvr = m.clicks ? (m.adSales > 0 ? (m.adSales / m.clicks) * 0 : 0) : 0 // placeholder; daily CVR averaged below
  // Average daily CVR for the month if available
  let cvrSum = 0, cvrN = 0
  for (let i = 0; i < series.dates.length; i++) {
    const d = new Date(series.dates[i] + 'T00:00:00Z')
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month) continue
    if (series.cvr[i]) { cvrSum += series.cvr[i]; cvrN++ }
  }
  if (cvrN > 0) m.cvr = cvrSum / cvrN
  m.roas = 0
  m.tacos = 0
  if (!n) m.label += ' (no data)'
  return m
}

function scaleMonth(m: ReturnType<typeof aggregateMonth>, factor: number, label: string) {
  return {
    ...m,
    label,
    totalSales: m.totalSales * factor,
    organicSales: m.organicSales * factor,
    adSales: m.adSales * factor,
    impressions: Math.round(m.impressions * factor),
    clicks: Math.round(m.clicks * factor),
    spend: m.spend * factor,
    orders: Math.round(m.orders * factor),
  }
}

// ---------- Optimization Schedule CSV ----------

export interface OptimizationScheduleData {
  tasks: Array<{ title: string; detail?: string; due: string; category?: string }>
}

export async function parseOptimizationSchedule(file: File): Promise<ParseResult<OptimizationScheduleData>> {
  const wb = await readWorkbook(file)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const warnings: string[] = []
  if (!ws) return { data: { tasks: [] }, warnings: ['Empty file.'], rowCount: 0 }
  const rows = sheetToJson(ws)
  const tasks: OptimizationScheduleData['tasks'] = []
  for (const r of rows) {
    const title = toStr(pick(r, ['Task', 'Title', 'Action', 'Optimization']))
    const due = toDateISO(pick(r, ['Due', 'Date', 'Scheduled For', 'Run On']))
    if (!title || !due) continue
    tasks.push({
      title,
      due,
      detail: toStr(pick(r, ['Detail', 'Notes', 'Description'])) || undefined,
      category: toStr(pick(r, ['Category', 'Type'])) || undefined,
    })
  }
  if (tasks.length === 0) warnings.push('Optimization schedule needs at minimum Task + Due columns.')
  return { data: { tasks }, warnings, rowCount: tasks.length }
}
