// XLSX/CSV exports for P&L tables and scenarios.

import * as XLSX from 'xlsx'
import type { ParentAsinRow, SkuRow } from '../types'

export function exportSkuPnL(skus: SkuRow[], filename = 'sku-pnl.xlsx') {
  const rows = skus.map(s => ({
    SKU: s.sku,
    ASIN: s.asin ?? '',
    'Parent ASIN': s.parentAsin ?? '',
    Title: s.title ?? '',
    Sales: s.sales,
    Units: s.units,
    'Referral Fees': s.referralFees,
    'FBA Fees': s.fbaFees,
    'Storage Fees': s.storageFees,
    'Shipping to Amazon': s.shippingToAmazon,
    COGS: s.cogs,
    'Ad Spend': s.adSpend,
    'Ad Sales': s.adSales,
    'Coupon Costs': s.couponCosts,
    Profit: s.profit ?? 0,
    'Margin %': s.margin ?? 0,
    'TACOS %': s.tacos ?? 0,
    'Break-Even TACOS %': s.breakEvenTacos ?? 0,
    'Max Profitable Ad Spend': s.maxProfitableAdSpend ?? 0,
    Status: s.status ?? '',
  }))
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'SKU P&L')
  XLSX.writeFile(wb, filename)
}

export function exportParentPnL(parents: ParentAsinRow[], filename = 'parent-asin-pnl.xlsx') {
  const summary = parents.map(p => ({
    'Parent ASIN': p.parentAsin,
    Title: p.title ?? '',
    'Child SKUs': p.childCount,
    Sales: p.sales,
    Units: p.units,
    'Ad Spend': p.adSpend,
    'Ad Sales': p.adSales,
    COGS: p.cogs,
    Fees: p.fees,
    Profit: p.profit,
    'Margin %': p.margin,
    'TACOS %': p.tacos,
    'Break-Even TACOS %': p.breakEvenTacos,
    Status: p.status,
  }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Parent ASIN P&L')
  for (const p of parents.slice(0, 50)) {
    const child = p.children.map(c => ({
      SKU: c.sku, ASIN: c.asin ?? '', Title: c.title ?? '',
      Sales: c.sales, Units: c.units,
      'Ad Spend': c.adSpend, Profit: c.profit ?? 0, 'Margin %': c.margin ?? 0,
      'TACOS %': c.tacos ?? 0, Status: c.status ?? '',
    }))
    const ws = XLSX.utils.json_to_sheet(child)
    const safe = p.parentAsin.replace(/[^A-Z0-9]/gi, '').slice(0, 28) || 'Parent'
    XLSX.utils.book_append_sheet(wb, ws, safe)
  }
  XLSX.writeFile(wb, filename)
}
