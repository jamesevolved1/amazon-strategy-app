import React, { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Download, Search, Sliders, Wallet, Megaphone, DollarSign, Package, Activity } from 'lucide-react'
import { Panel, Pill, Button, EmptyState, cx, TextField, NumberField, SegmentedControl } from '../components/ui'
import { KPICard } from '../components/KPICard'
import { DataQualityWarnings } from '../components/DataQualityWarnings'
import { useStore } from '../lib/store'
import { currency, num, percent, signed } from '../lib/format'
import { mergeReportsIntoSkus, statusLabel, statusTone, type MergedReports } from '../utils/pnl'
import type { SkuRow } from '../types'
import { exportSkuPnL } from '../utils/exports'
import type {
  AdvertisedProductData, BulkCampaignData, CogsMappingData, FeePreviewData, MasterProfitData, StorageFeeData, BusinessReportData,
} from '../utils/parsers'

export function PnLDashboard() {
  const { currentClient, currentBundle, updateScenario, addScenario, setActiveScenario, deleteScenario } = useStore()
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<'sales' | 'profit' | 'margin' | 'tacos'>('sales')
  const [statusFilter, setStatusFilter] = useState<'all' | SkuRow['status']>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [view, setView] = useState<'scenario' | 'current'>('current')

  if (!currentClient || !currentBundle) {
    return <EmptyState title="No client selected" description="Add or switch to a client to view its P&L." />
  }

  const reports: MergedReports = useMemo(() => ({
    masterProfit: currentBundle.reports.masterProfit?.parsed as MasterProfitData | undefined,
    bulkCampaigns: currentBundle.reports.bulkCampaigns?.parsed as BulkCampaignData | undefined,
    businessReport: currentBundle.reports.businessReport?.parsed as BusinessReportData | undefined,
    advertisedProduct: currentBundle.reports.advertisedProduct?.parsed as AdvertisedProductData | undefined,
    feePreview: currentBundle.reports.feePreview?.parsed as FeePreviewData | undefined,
    storageFee: currentBundle.reports.storageFee?.parsed as StorageFeeData | undefined,
    cogsMapping: currentBundle.reports.cogsMapping?.parsed as CogsMappingData | undefined,
  }), [currentBundle.reports])

  const activeScenario = currentBundle.scenarios.find(s => s.id === currentBundle.activeScenarioId) ?? null
  const baseline = useMemo(() => mergeReportsIntoSkus(reports, null), [reports])
  const scenario = useMemo(() => mergeReportsIntoSkus(reports, activeScenario), [reports, activeScenario])

  const sourceForView = view === 'scenario' ? scenario : baseline

  const filtered = useMemo(() => {
    let rows = sourceForView.skus
    if (statusFilter !== 'all') rows = rows.filter(r => r.status === statusFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(r =>
        r.sku.toLowerCase().includes(q) ||
        (r.asin ?? '').toLowerCase().includes(q) ||
        (r.title ?? '').toLowerCase().includes(q)
      )
    }
    rows = rows.slice()
    switch (sortKey) {
      case 'sales': rows.sort((a, b) => b.sales - a.sales); break
      case 'profit': rows.sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0)); break
      case 'margin': rows.sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0)); break
      case 'tacos': rows.sort((a, b) => (b.tacos ?? 0) - (a.tacos ?? 0)); break
    }
    return rows
  }, [sourceForView, statusFilter, search, sortKey])

  if (sourceForView.skus.length === 0) {
    return (
      <EmptyState
        title="No SKU data yet"
        description="Upload the Master Profit Matrix workbook (or Advertised Product + COGS Mapping) to populate the P&L."
      />
    )
  }

  const totals = aggregate(sourceForView.skus)
  const baselineTotals = aggregate(baseline.skus)
  const healthCounts = bucketStatus(sourceForView.skus)

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">P&L Dashboard</h1>
          <p className="text-sm text-ink-mute mt-0.5">SKU profitability across {num(sourceForView.skus.length)} SKUs · {currentClient.name}</p>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl
            value={view}
            onChange={setView}
            options={[{ id: 'current' as const, label: 'Current' }, { id: 'scenario' as const, label: 'Scenario' }]}
          />
          <Button icon={<Download className="w-4 h-4" />} variant="secondary" onClick={() => exportSkuPnL(sourceForView.skus, `${currentClient.name}-skus-${view}.xlsx`)}>
            Export {view}
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        <KPICard label="Account TACOS" tone="gold" icon={<Activity className="w-3.5 h-3.5" />} value={percent(totals.tacos, 1)} secondary={view === 'scenario' ? `was ${percent(baselineTotals.tacos, 1)}` : 'spend ÷ sales'} />
        <KPICard label="Ad Spend" tone="peri" icon={<Megaphone className="w-3.5 h-3.5" />} value={currency(totals.adSpend, currentClient.currency, true)} secondary={view === 'scenario' ? `was ${currency(baselineTotals.adSpend, currentClient.currency, true)}` : undefined} />
        <KPICard label="Profit" tone="mint" icon={<Wallet className="w-3.5 h-3.5" />} value={currency(totals.profit, currentClient.currency, true)} secondary={view === 'scenario' ? `Δ ${signed(totals.profit - baselineTotals.profit, 0)}` : undefined} />
        <KPICard label="Total Sales" tone="lavender" icon={<DollarSign className="w-3.5 h-3.5" />} value={currency(totals.sales, currentClient.currency, true)} />
        <KPICard label="Units" tone="blush" icon={<Package className="w-3.5 h-3.5" />} value={num(totals.units)} />
        <KPICard label="SKU Health" tone="mint" icon={<Activity className="w-3.5 h-3.5" />} value={`${num(healthCounts.profit_leader + healthCounts.scale_candidate)} healthy`} secondary={`${num(healthCounts.unprofitable)} unprofitable`} />
      </div>

      <ScenarioControls
        scenarios={currentBundle.scenarios}
        activeId={currentBundle.activeScenarioId}
        onActivate={setActiveScenario}
        onAdd={addScenario}
        onUpdate={updateScenario}
        onDelete={deleteScenario}
      />

      <DataQualityWarnings issues={sourceForView.issues} />

      <Panel padding="p-0" className="overflow-hidden">
        <div className="px-5 pt-5 pb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">SKU profitability</h2>
            <p className="text-xs text-ink-mute mt-0.5">Searchable, sortable. Click any SKU to expand details.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-faint" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search SKU, ASIN, title..."
                className="w-72 pl-7 pr-3 py-1.5 rounded-full border border-line bg-canvas-panel text-xs focus:outline-none focus:ring-2 focus:ring-ink/15"
              />
            </div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
              className="px-3 py-1.5 rounded-full border border-line text-xs bg-canvas-panel"
            >
              <option value="all">All status</option>
              <option value="profit_leader">Profit Leader</option>
              <option value="scale_candidate">Scale Candidate</option>
              <option value="optimize">Optimize</option>
              <option value="breakeven">Break-Even</option>
              <option value="unprofitable">Unprofitable</option>
              <option value="inactive">Inactive</option>
            </select>
            <select
              value={sortKey}
              onChange={e => setSortKey(e.target.value as typeof sortKey)}
              className="px-3 py-1.5 rounded-full border border-line text-xs bg-canvas-panel"
            >
              <option value="sales">Sort: Sales</option>
              <option value="profit">Sort: Profit</option>
              <option value="margin">Sort: Margin</option>
              <option value="tacos">Sort: TACOS</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto border-t border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-canvas-tint text-ink-mute text-2xs uppercase tracking-wider">
                <th className="text-left px-5 py-2.5 font-medium">SKU</th>
                <th className="text-right px-3 py-2.5 font-medium">Sales</th>
                <th className="text-right px-3 py-2.5 font-medium">Units</th>
                <th className="text-right px-3 py-2.5 font-medium">Ad Spend</th>
                <th className="text-right px-3 py-2.5 font-medium">TACOS</th>
                <th className="text-right px-3 py-2.5 font-medium">Profit</th>
                <th className="text-right px-3 py-2.5 font-medium">Margin</th>
                <th className="text-right px-3 py-2.5 font-medium">Break-even</th>
                <th className="text-left px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 pr-5" />
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 300).map((s) => {
                const isOpen = expanded === s.sku
                return (
                  <React.Fragment key={s.sku}>
                    <tr className={cx('border-t border-line hover:bg-canvas-tint cursor-pointer', isOpen && 'bg-canvas-tint')} onClick={() => setExpanded(isOpen ? null : s.sku)}>
                      <td className="px-5 py-2.5 max-w-[360px]">
                        <div className="font-medium text-ink truncate">{s.sku}</div>
                        <div className="text-2xs text-ink-faint tnum truncate">
                          {s.asin && <>ASIN {s.asin} · </>}
                          {s.title}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tnum">{currency(s.sales, currentClient.currency)}</td>
                      <td className="px-3 py-2.5 text-right tnum">{num(s.units)}</td>
                      <td className="px-3 py-2.5 text-right tnum">{currency(s.adSpend, currentClient.currency)}</td>
                      <td className="px-3 py-2.5 text-right tnum">{percent(s.tacos ?? 0, 1)}</td>
                      <td className={cx('px-3 py-2.5 text-right tnum font-medium', (s.profit ?? 0) >= 0 ? 'text-ink' : 'text-[#9c4651]')}>{currency(s.profit ?? 0, currentClient.currency)}</td>
                      <td className="px-3 py-2.5 text-right tnum">{percent(s.margin ?? 0, 1)}</td>
                      <td className="px-3 py-2.5 text-right tnum">{percent(s.breakEvenTacos ?? 0, 1)}</td>
                      <td className="px-3 py-2.5"><Pill tone={statusTone(s.status)}>{statusLabel(s.status)}</Pill></td>
                      <td className="px-3 py-2.5 pr-5 text-right text-ink-faint">{isOpen ? <ChevronUp className="w-4 h-4 inline" /> : <ChevronDown className="w-4 h-4 inline" />}</td>
                    </tr>
                    {isOpen && <ExpandedSku sku={s} baseline={baseline.skus.find(b => b.sku === s.sku)} ccy={currentClient.currency} view={view} />}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        {filtered.length > 300 && (
          <div className="px-5 py-3 text-2xs text-ink-faint border-t border-line">
            Showing first 300 of {num(filtered.length)} matching SKUs. Refine search to narrow.
          </div>
        )}
      </Panel>
    </div>
  )
}

function aggregate(skus: SkuRow[]) {
  const sales = sum(skus.map(s => s.sales))
  const adSpend = sum(skus.map(s => s.adSpend))
  const profit = sum(skus.map(s => s.profit ?? 0))
  const units = sum(skus.map(s => s.units))
  return {
    sales, adSpend, profit, units,
    tacos: sales > 0 ? (adSpend / sales) * 100 : 0,
    margin: sales > 0 ? (profit / sales) * 100 : 0,
  }
}

function sum(xs: number[]): number {
  let t = 0; for (const x of xs) if (Number.isFinite(x)) t += x; return t
}

function bucketStatus(skus: SkuRow[]) {
  const out = { profit_leader: 0, scale_candidate: 0, optimize: 0, breakeven: 0, unprofitable: 0, inactive: 0 }
  for (const s of skus) {
    if (s.status && out[s.status] !== undefined) out[s.status]++
  }
  return out
}

function ExpandedSku({ sku, baseline, ccy, view }: { sku: SkuRow; baseline?: SkuRow; ccy: import('../types').Currency; view: 'current' | 'scenario' }) {
  const Row = ({ label, value, baseValue, fmt }: { label: string; value: number; baseValue?: number; fmt: (n: number) => string }) => (
    <div className="flex items-center justify-between py-1.5 text-xs">
      <span className="text-ink-mute">{label}</span>
      <span className="tnum text-ink">
        {fmt(value)}
        {view === 'scenario' && baseValue !== undefined && (
          <span className="ml-2 text-ink-faint">was {fmt(baseValue)}</span>
        )}
      </span>
    </div>
  )
  return (
    <tr>
      <td colSpan={10} className="bg-canvas-tint border-t border-line">
        <div className="px-5 py-4 grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div>
            <h3 className="text-sm font-semibold text-ink mb-2">Cost structure</h3>
            <Row label="Sales" value={sku.sales} baseValue={baseline?.sales} fmt={(n) => currency(n, ccy)} />
            <Row label="Referral fees" value={sku.referralFees} baseValue={baseline?.referralFees} fmt={(n) => currency(n, ccy)} />
            <Row label="FBA fees" value={sku.fbaFees} baseValue={baseline?.fbaFees} fmt={(n) => currency(n, ccy)} />
            <Row label="Storage" value={sku.storageFees} baseValue={baseline?.storageFees} fmt={(n) => currency(n, ccy)} />
            <Row label="Shipping to Amazon" value={sku.shippingToAmazon} baseValue={baseline?.shippingToAmazon} fmt={(n) => currency(n, ccy)} />
            <Row label="COGS" value={sku.cogs} baseValue={baseline?.cogs} fmt={(n) => currency(n, ccy)} />
            <Row label="Coupons" value={sku.couponCosts} baseValue={baseline?.couponCosts} fmt={(n) => currency(n, ccy)} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink mb-2">Advertising</h3>
            <Row label="Ad spend" value={sku.adSpend} baseValue={baseline?.adSpend} fmt={(n) => currency(n, ccy)} />
            <Row label="Ad sales" value={sku.adSales} baseValue={baseline?.adSales} fmt={(n) => currency(n, ccy)} />
            <Row label="ROAS" value={sku.adSpend > 0 ? sku.adSales / sku.adSpend : 0} fmt={(n) => `${n.toFixed(2)}×`} />
            <Row label="TACOS" value={sku.tacos ?? 0} baseValue={baseline?.tacos} fmt={(n) => percent(n, 1)} />
            <Row label="Break-even TACOS" value={sku.breakEvenTacos ?? 0} fmt={(n) => percent(n, 1)} />
            <Row label="Max profitable ad spend" value={sku.maxProfitableAdSpend ?? 0} fmt={(n) => currency(n, ccy)} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink mb-2">Outcome</h3>
            <Row label="Profit" value={sku.profit ?? 0} baseValue={baseline?.profit} fmt={(n) => currency(n, ccy)} />
            <Row label="Margin" value={sku.margin ?? 0} baseValue={baseline?.margin} fmt={(n) => percent(n, 1)} />
            <Row label="Units" value={sku.units} fmt={(n) => num(n)} />
            <div className="mt-3 p-3 rounded-lg bg-canvas-panel border border-line">
              <div className="text-2xs uppercase tracking-wider text-ink-mute font-semibold">Status</div>
              <div className="mt-1.5 flex items-center gap-2">
                <Pill tone={statusTone(sku.status)}>{statusLabel(sku.status)}</Pill>
                {(sku.profit ?? 0) < 0 && <span className="text-2xs text-[#9c4651]">Never a Scale Candidate while unprofitable.</span>}
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  )
}

function ScenarioControls({
  scenarios, activeId, onActivate, onAdd, onUpdate, onDelete,
}: {
  scenarios: import('../types').Scenario[]
  activeId: string | null
  onActivate: (id: string | null) => void
  onAdd: (s: Omit<import('../types').Scenario, 'id' | 'createdAt'>) => import('../types').Scenario
  onUpdate: (id: string, p: Partial<Omit<import('../types').Scenario, 'id' | 'createdAt'>>) => void
  onDelete: (id: string) => void
}) {
  const active = scenarios.find(s => s.id === activeId)

  return (
    <Panel>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-ink-mute" />
          <h2 className="text-base font-semibold text-ink">Scenarios</h2>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={activeId ?? ''}
            onChange={e => onActivate(e.target.value || null)}
            className="px-3 py-1.5 rounded-full border border-line text-xs bg-canvas-panel"
          >
            <option value="">Current (no scenario)</option>
            {scenarios.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Button
            variant="secondary"
            onClick={() => {
              const s = onAdd({ name: `Scenario ${scenarios.length + 1}`, adSpendMultiplier: 1, cogsAdjustment: 0, priceAdjustment: 0, couponRateOverride: null })
              onActivate(s.id)
            }}
          >
            New scenario
          </Button>
          {active && <Button variant="ghost" onClick={() => { onDelete(active.id); onActivate(null) }}>Delete</Button>}
        </div>
      </div>
      {active ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <TextField label="Name" value={active.name} onChange={v => onUpdate(active.id, { name: v })} />
          <NumberField label="Ad spend ×" step="0.01" value={active.adSpendMultiplier} onChange={v => onUpdate(active.id, { adSpendMultiplier: v })} />
          <NumberField label="Price Δ%" step="0.5" suffix="%" value={active.priceAdjustment} onChange={v => onUpdate(active.id, { priceAdjustment: v })} />
          <NumberField label="COGS Δ%" step="0.5" suffix="%" value={active.cogsAdjustment} onChange={v => onUpdate(active.id, { cogsAdjustment: v })} />
          <NumberField label="Coupon rate (override)" step="0.5" suffix="%" value={active.couponRateOverride ?? 0} onChange={v => onUpdate(active.id, { couponRateOverride: v === 0 ? null : v })} />
        </div>
      ) : (
        <p className="text-sm text-ink-mute">No active scenario — view shows current data. Create one to model spend, price, or COGS shifts.</p>
      )}
    </Panel>
  )
}
