import React, { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Download, Search } from 'lucide-react'
import { Panel, Pill, Button, EmptyState, cx, TextField } from '../components/ui'
import { useStore } from '../lib/store'
import { mergeReportsIntoSkus, statusLabel, statusTone, type MergedReports } from '../utils/pnl'
import { currency, num, percent } from '../lib/format'
import type { ParentAsinRow } from '../types'
import { exportParentPnL } from '../utils/exports'
import type {
  AdvertisedProductData, BulkCampaignData, CogsMappingData, FeePreviewData, MasterProfitData, StorageFeeData, BusinessReportData,
} from '../utils/parsers'

export function ParentASIN() {
  const { currentClient, currentBundle } = useStore()
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [parentTargets, setParentTargets] = useState<Record<string, { tacos: number; margin: number }>>({})

  if (!currentClient || !currentBundle) return <EmptyState title="No client selected" />

  const reports: MergedReports = useMemo(() => ({
    masterProfit: currentBundle.reports.masterProfit?.parsed as MasterProfitData | undefined,
    bulkCampaigns: currentBundle.reports.bulkCampaigns?.parsed as BulkCampaignData | undefined,
    businessReport: currentBundle.reports.businessReport?.parsed as BusinessReportData | undefined,
    advertisedProduct: currentBundle.reports.advertisedProduct?.parsed as AdvertisedProductData | undefined,
    feePreview: currentBundle.reports.feePreview?.parsed as FeePreviewData | undefined,
    storageFee: currentBundle.reports.storageFee?.parsed as StorageFeeData | undefined,
    cogsMapping: currentBundle.reports.cogsMapping?.parsed as CogsMappingData | undefined,
  }), [currentBundle.reports])

  const enriched = useMemo(() => mergeReportsIntoSkus(reports, currentBundle.scenarios.find(s => s.id === currentBundle.activeScenarioId) ?? null), [reports, currentBundle.scenarios, currentBundle.activeScenarioId])

  if (enriched.parents.length === 0) {
    return <EmptyState title="No SKUs to aggregate" description="Upload Master Profit Matrix or Advertised Product + COGS." />
  }

  const filtered = enriched.parents.filter(p => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return p.parentAsin.toLowerCase().includes(q) || (p.title ?? '').toLowerCase().includes(q)
  })

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Parent ASIN P&L</h1>
          <p className="text-sm text-ink-mute mt-0.5">Profitability aggregated by parent across {num(enriched.parents.length)} parents · {currentClient.name}</p>
        </div>
        <Button icon={<Download className="w-4 h-4" />} variant="secondary" onClick={() => exportParentPnL(enriched.parents, `${currentClient.name}-parent-asin.xlsx`)}>
          Export
        </Button>
      </header>

      <Panel padding="p-0" className="overflow-hidden">
        <div className="px-5 pt-5 pb-3 flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-ink">Parents</h2>
            <p className="text-xs text-ink-mute mt-0.5">Click a parent to expand child SKUs. Set custom TACOS / margin targets per parent.</p>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-faint" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search parent ASIN or title..."
              className="w-80 pl-7 pr-3 py-1.5 rounded-full border border-line bg-canvas-panel text-xs focus:outline-none focus:ring-2 focus:ring-ink/15"
            />
          </div>
        </div>

        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-canvas-tint text-ink-mute text-2xs uppercase tracking-wider">
                <th className="text-left px-5 py-2.5 font-medium">Parent / Title</th>
                <th className="text-right px-3 py-2.5 font-medium">Children</th>
                <th className="text-right px-3 py-2.5 font-medium">Sales</th>
                <th className="text-right px-3 py-2.5 font-medium">Ad Spend</th>
                <th className="text-right px-3 py-2.5 font-medium">TACOS</th>
                <th className="text-right px-3 py-2.5 font-medium">Profit</th>
                <th className="text-right px-3 py-2.5 font-medium">Margin</th>
                <th className="text-right px-3 py-2.5 font-medium">Break-Even TACOS</th>
                <th className="text-left px-3 py-2.5 font-medium">Health</th>
                <th className="px-3 py-2.5 pr-5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const open = expanded === p.parentAsin
                const target = parentTargets[p.parentAsin]
                return (
                  <React.Fragment key={p.parentAsin}>
                    <tr className={cx('border-t border-line hover:bg-canvas-tint cursor-pointer', open && 'bg-canvas-tint')} onClick={() => setExpanded(open ? null : p.parentAsin)}>
                      <td className="px-5 py-2.5 max-w-[420px]">
                        <div className="font-medium text-ink truncate">{p.title ?? p.parentAsin}</div>
                        <div className="text-2xs text-ink-faint tnum truncate">{p.parentAsin}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right tnum">{num(p.childCount)}</td>
                      <td className="px-3 py-2.5 text-right tnum">{currency(p.sales, currentClient.currency)}</td>
                      <td className="px-3 py-2.5 text-right tnum">{currency(p.adSpend, currentClient.currency)}</td>
                      <td className="px-3 py-2.5 text-right tnum">
                        {percent(p.tacos, 1)}
                        {target && (
                          <span className={cx('block text-2xs', p.tacos > target.tacos ? 'text-[#9c4651]' : 'text-[#1f7a4a]')}>
                            target {percent(target.tacos, 1)}
                          </span>
                        )}
                      </td>
                      <td className={cx('px-3 py-2.5 text-right tnum font-medium', p.profit >= 0 ? 'text-ink' : 'text-[#9c4651]')}>{currency(p.profit, currentClient.currency)}</td>
                      <td className="px-3 py-2.5 text-right tnum">
                        {percent(p.margin, 1)}
                        {target && (
                          <span className={cx('block text-2xs', p.margin < target.margin ? 'text-[#9c4651]' : 'text-[#1f7a4a]')}>
                            target {percent(target.margin, 1)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tnum">{percent(p.breakEvenTacos, 1)}</td>
                      <td className="px-3 py-2.5"><Pill tone={statusTone(p.status)}>{statusLabel(p.status)}</Pill></td>
                      <td className="px-3 py-2.5 pr-5 text-right text-ink-faint">{open ? <ChevronUp className="w-4 h-4 inline" /> : <ChevronDown className="w-4 h-4 inline" />}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={10} className="bg-canvas-tint border-t border-line">
                          <div className="px-5 py-4 grid grid-cols-1 lg:grid-cols-4 gap-5">
                            <div className="lg:col-span-1">
                              <h3 className="text-sm font-semibold text-ink mb-3">Parent targets</h3>
                              <TextField
                                label="TACOS target %"
                                type="number"
                                step="0.5"
                                suffix="%"
                                value={target?.tacos ?? ''}
                                onChange={v => setParentTargets(prev => ({ ...prev, [p.parentAsin]: { tacos: Number(v) || 0, margin: prev[p.parentAsin]?.margin ?? 25 } }))}
                              />
                              <div className="h-3" />
                              <TextField
                                label="Margin target %"
                                type="number"
                                step="0.5"
                                suffix="%"
                                value={target?.margin ?? ''}
                                onChange={v => setParentTargets(prev => ({ ...prev, [p.parentAsin]: { margin: Number(v) || 0, tacos: prev[p.parentAsin]?.tacos ?? 15 } }))}
                              />
                            </div>
                            <ChildTable parent={p} ccy={currentClient.currency} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function ChildTable({ parent, ccy }: { parent: ParentAsinRow; ccy: import('../types').Currency }) {
  return (
    <div className="lg:col-span-3 overflow-x-auto">
      <h3 className="text-sm font-semibold text-ink mb-3">Child SKUs ({num(parent.childCount)})</h3>
      <table className="w-full text-sm border border-line rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-canvas-panel text-ink-mute text-2xs uppercase tracking-wider">
            <th className="text-left px-3 py-2 font-medium">SKU</th>
            <th className="text-right px-3 py-2 font-medium">Sales</th>
            <th className="text-right px-3 py-2 font-medium">Units</th>
            <th className="text-right px-3 py-2 font-medium">Spend</th>
            <th className="text-right px-3 py-2 font-medium">TACOS</th>
            <th className="text-right px-3 py-2 font-medium">Profit</th>
            <th className="text-right px-3 py-2 font-medium">Margin</th>
            <th className="text-left px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {parent.children.map(c => (
            <tr key={c.sku} className="border-t border-line bg-canvas-panel">
              <td className="px-3 py-2 max-w-[260px]">
                <div className="font-medium text-ink truncate">{c.sku}</div>
                <div className="text-2xs text-ink-faint truncate">{c.title}</div>
              </td>
              <td className="px-3 py-2 text-right tnum">{currency(c.sales, ccy)}</td>
              <td className="px-3 py-2 text-right tnum">{num(c.units)}</td>
              <td className="px-3 py-2 text-right tnum">{currency(c.adSpend, ccy)}</td>
              <td className="px-3 py-2 text-right tnum">{percent(c.tacos ?? 0, 1)}</td>
              <td className={cx('px-3 py-2 text-right tnum font-medium', (c.profit ?? 0) >= 0 ? 'text-ink' : 'text-[#9c4651]')}>{currency(c.profit ?? 0, ccy)}</td>
              <td className="px-3 py-2 text-right tnum">{percent(c.margin ?? 0, 1)}</td>
              <td className="px-3 py-2"><Pill tone={statusTone(c.status)}>{statusLabel(c.status)}</Pill></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
