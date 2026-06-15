import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plane, ShoppingCart, Target as TargetIcon, TrendingUp, Package, Megaphone, Eye, MousePointerClick, Percent, BarChart3 as BarIcon, ArrowUpRight,
  RefreshCcw, PlayCircle, Search, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import { Spinner } from '../components/ui'
import { triggerSync, useAmazonConnections } from '../lib/amazon'
import { triggerSpApiSync } from '../lib/spapi'
import {
  Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useStore } from '../lib/store'
import { Panel, Pill, SegmentedControl, EmptyState, Button, cx, Delta } from '../components/ui'
import { KPICard } from '../components/KPICard'
import { compact, currency, dateRangeLabel, daysBetween, deltaPct, num, percent, relativeTime, timestamp } from '../lib/format'
import {
  adProductSummary, totalsFromSeries, projectCurrentMonth, type ReportingTotals, type MonthProjection,
} from '../utils/pnl'
import { customRange, resolveRange, sliceSeries, type RangePreset } from '../utils/dateRange'
import { useSpApiConnections } from '../lib/spapi'
import type { BulkCampaignData, BusinessReportData } from '../utils/parsers'
import type { CampaignRow, DailySeriesPoint } from '../types'

export function ReportingDashboard() {
  const { currentClient, currentBundle } = useStore()
  const [preset, setPreset] = useState<RangePreset>('7d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [campaignSearch, setCampaignSearch] = useState('')
  const [campaignFilter, setCampaignFilter] = useState<'all' | 'SP' | 'SB' | 'OTHER'>('all')
  const [campaignPortfolio, setCampaignPortfolio] = useState<string>('all')
  const [campaignSort, setCampaignSort] = useState<'spend' | 'sales' | 'orders' | 'roas'>('spend')

  const { connections, refresh: refreshConnections } = useAmazonConnections()
  const { connections: spapiConnections, refresh: refreshSpApi } = useSpApiConnections()
  const [syncing, setSyncing] = useState(false)
  const [syncBanner, setSyncBanner] = useState<{ kind: 'ok' | 'err' | 'partial'; message: string } | null>(null)

  const currentConnection = currentClient
    ? connections.find(c => c.app_client_id === currentClient.id)
    : undefined
  const spapiConnection = currentClient
    ? spapiConnections.find(c => c.app_client_id === currentClient.id)
    : undefined

  const pendingCount = currentConnection?.pending_reports?.length ?? 0
  const spapiPendingCount = spapiConnection?.pending_reports?.length ?? 0

  const handleSyncNow = async () => {
    if (!currentClient) return
    setSyncing(true)
    setSyncBanner(null)
    const clientId = currentClient.id
    // Fire both syncs together: Ads (campaigns) + SP-API (total sales) when each
    // is connected. They write to separate tables, so they're independent.
    const [adsResult, spapiResult] = await Promise.all([
      currentConnection ? triggerSync(clientId) : Promise.resolve(null),
      spapiConnection ? triggerSpApiSync(clientId) : Promise.resolve(null),
    ])
    setSyncing(false)
    await Promise.all([refreshConnections(), refreshSpApi()])

    const parts: string[] = []
    let kind: 'ok' | 'err' | 'partial' = 'ok'

    if (adsResult) {
      if (adsResult.error) { parts.push(`Ads: ${adsResult.error}`); kind = 'err' }
      else {
        const row = adsResult.results.find(r => r.app_client_id === clientId)
        if (row?.status === 'error') { parts.push(`Ads: ${row.error || 'failed'}`); kind = 'err' }
        else if (row?.all_done) parts.push(`Ads: ${row.campaigns_after_sync ?? 0} campaigns`)
        else if (row?.pending_count) parts.push(`Ads: ${row.pending_count} reports in flight`)
        else if (row?.profiles_found != null) parts.push(`Ads: ${row.profiles_found} profile${row.profiles_found === 1 ? '' : 's'}`)
      }
    }
    if (spapiResult) {
      if (spapiResult.error) { parts.push(`Seller Central: ${spapiResult.error}`); if (kind !== 'err') kind = 'err' }
      else {
        const row = spapiResult.results.find(r => r.app_client_id === clientId)
        if (row?.status === 'error') { parts.push(`Seller Central: ${row.error || 'failed'}`); if (kind !== 'err') kind = 'err' }
        else if (row?.all_done) parts.push(`Seller Central: ${row.days_after_sync ?? 0} days of total sales`)
        else if (row?.pending_count) parts.push(`Seller Central: report in flight (1-5 min)`)
        else parts.push('Seller Central: requested report')
      }
    }

    if (!adsResult && !spapiResult) {
      setSyncBanner({ kind: 'partial', message: 'No Amazon connection for this client. Connect Amazon Ads or Seller Central on the Clients page.' })
    } else {
      setSyncBanner({ kind, message: parts.join(' · ') || 'Synced.' })
    }
    setTimeout(() => setSyncBanner(null), 9000)
  }

  // Auto-poll: while reports are in flight (Ads or SP-API), hit Sync every 30s
  // without spinner spam so the dashboard fills in as reports finish at Amazon.
  const autoPollRef = useRef<NodeJS.Timeout | null>(null)
  useEffect(() => {
    if (autoPollRef.current) {
      clearInterval(autoPollRef.current)
      autoPollRef.current = null
    }
    const anyPending = pendingCount > 0 || spapiPendingCount > 0
    if (!currentClient || !anyPending) return
    const clientId = currentClient.id
    const clientName = currentClient.name
    autoPollRef.current = setInterval(async () => {
      const [adsResult, spapiResult] = await Promise.all([
        pendingCount > 0 ? triggerSync(clientId) : Promise.resolve(null),
        spapiPendingCount > 0 ? triggerSpApiSync(clientId) : Promise.resolve(null),
      ])
      await Promise.all([refreshConnections(), refreshSpApi()])
      const adsRow = adsResult?.results.find(r => r.app_client_id === clientId)
      const spapiRow = spapiResult?.results.find(r => r.app_client_id === clientId)
      if (adsRow?.pending_count === 0 && adsRow?.campaigns_after_sync) {
        setSyncBanner({ kind: 'ok', message: `Live ad data ready — ${adsRow.campaigns_after_sync} campaigns for ${clientName}.` })
        setTimeout(() => setSyncBanner(null), 8000)
      }
      if (spapiRow?.pending_count === 0 && spapiRow?.days_after_sync) {
        setSyncBanner({ kind: 'ok', message: `Total sales ready — ${spapiRow.days_after_sync} days for ${clientName}.` })
        setTimeout(() => setSyncBanner(null), 8000)
      }
    }, 30_000)
    return () => {
      if (autoPollRef.current) {
        clearInterval(autoPollRef.current)
        autoPollRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCount, spapiPendingCount, currentClient?.id])

  if (!currentClient || !currentBundle) {
    return (
      <EmptyState
        title="Add a client to begin"
        description="Use the switcher in the sidebar to create a client, then upload reports to populate this dashboard."
      />
    )
  }

  const bulk = currentBundle.reports.bulkCampaigns?.parsed as BulkCampaignData | undefined
  const biz = currentBundle.reports.businessReport?.parsed as BusinessReportData | undefined
  const syncedCampaigns = currentConnection?.synced_data?.campaigns ?? null
  const syncedDaily = currentConnection?.synced_data?.daily ?? null
  // SP-API total-sales by day (the missing piece for TACOS / organic / total)
  const spapiDaily = spapiConnection?.synced_data?.daily ?? null

  // Build a merged daily series from bulk daily + business report daily + synced API daily.
  const series: DailySeriesPoint[] = useMemo(() => {
    const map = new Map<string, DailySeriesPoint>()
    const ingest = (arr: DailySeriesPoint[] | undefined) => {
      for (const p of arr ?? []) {
        const existing = map.get(p.date) ?? { date: p.date, spend: 0, adSales: 0, orders: 0, impressions: 0, clicks: 0 }
        existing.spend = Math.max(existing.spend, p.spend)
        existing.adSales = Math.max(existing.adSales, p.adSales)
        existing.orders = Math.max(existing.orders, p.orders)
        existing.impressions = Math.max(existing.impressions, p.impressions)
        existing.clicks = Math.max(existing.clicks, p.clicks)
        if (p.totalSales != null) existing.totalSales = (existing.totalSales ?? 0) + p.totalSales
        map.set(p.date, existing)
      }
    }
    ingest(bulk?.daily)
    ingest(biz?.daily)
    // Synced Ads API data takes priority for the ad metrics.
    if (syncedDaily) {
      for (const p of syncedDaily) {
        const existing = map.get(p.date)
        map.set(p.date, {
          date: p.date,
          spend: p.spend,
          adSales: p.adSales,
          orders: p.orders,
          impressions: p.impressions,
          clicks: p.clicks,
          // keep any totalSales already present (e.g. from SP-API, applied below)
          totalSales: existing?.totalSales,
        })
      }
    }
    // SP-API is authoritative for TOTAL (ordered product) sales — layer it on
    // top so TACOS, organic sales, and projections compute against real totals.
    if (spapiDaily) {
      for (const p of spapiDaily) {
        const existing = map.get(p.date) ?? { date: p.date, spend: 0, adSales: 0, orders: 0, impressions: 0, clicks: 0 }
        existing.totalSales = p.totalSales
        map.set(p.date, existing)
      }
    }
    return Array.from(map.values())
      .map(p => ({
        ...p,
        ctr: p.impressions ? (p.clicks / p.impressions) * 100 : 0,
        cvr: p.clicks ? (p.orders / p.clicks) * 100 : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [bulk, biz, syncedDaily, spapiDaily])

  const range = useMemo(
    () => preset === 'custom' ? customRange(customStart, customEnd) : resolveRange(series, preset),
    [series, preset, customStart, customEnd],
  )
  const slice = range ? sliceSeries(series, range.start, range.end) : []
  const prev = range ? sliceSeries(series, range.prevStart, range.prevEnd) : []
  const totals = useMemo(() => totalsFromSeries(slice, range?.days), [slice, range])
  const prevTotals = useMemo(() => totalsFromSeries(prev, range ? daysBetween(range.prevStart, range.prevEnd) : 0), [prev, range])

  // Prefer synced campaigns from Amazon API; fall back to uploaded bulk export
  const campaigns: CampaignRow[] = useMemo(() => {
    if (syncedCampaigns && syncedCampaigns.length > 0) {
      return syncedCampaigns.map(c => ({
        campaign: c.campaign,
        campaignId: c.campaignId,
        type: c.type,
        portfolioId: c.portfolioId,
        portfolio: c.portfolio,
        impressions: c.impressions,
        clicks: c.clicks,
        spend: c.spend,
        adSales: c.adSales,
        orders: c.orders,
        ctr: c.ctr,
        cvr: c.cvr,
        roas: c.roas,
        acos: c.acos,
        cpc: c.cpc,
      }))
    }
    return bulk?.campaigns ?? []
  }, [syncedCampaigns, bulk])
  const adSummary = useMemo(() => adProductSummary(campaigns), [campaigns])
  const projection = useMemo(() => projectCurrentMonth(series, currentBundle.goals), [series, currentBundle.goals])

  const portfolios = useMemo(() => {
    const set = new Set<string>()
    let unassigned = 0
    for (const c of campaigns) {
      if (c.portfolio) set.add(c.portfolio)
      else unassigned++
    }
    const list = Array.from(set).sort((a, b) => a.localeCompare(b))
    return { list, unassigned }
  }, [campaigns])

  const filteredCampaigns = useMemo(() => {
    let rows = campaigns
    if (campaignFilter === 'OTHER') rows = rows.filter(c => c.type === 'SD' || c.type === 'OTHER')
    else if (campaignFilter !== 'all') rows = rows.filter(c => c.type === campaignFilter)
    if (campaignPortfolio !== 'all') {
      if (campaignPortfolio === '__none__') rows = rows.filter(c => !c.portfolio)
      else rows = rows.filter(c => c.portfolio === campaignPortfolio)
    }
    if (campaignSearch.trim()) {
      const q = campaignSearch.trim().toLowerCase()
      rows = rows.filter(c => c.campaign.toLowerCase().includes(q) || (c.campaignId ?? '').toLowerCase().includes(q) || (c.product ?? '').toLowerCase().includes(q) || (c.portfolio ?? '').toLowerCase().includes(q))
    }
    rows = rows.slice()
    switch (campaignSort) {
      case 'spend': rows.sort((a, b) => b.spend - a.spend); break
      case 'sales': rows.sort((a, b) => b.adSales - a.adSales); break
      case 'orders': rows.sort((a, b) => b.orders - a.orders); break
      case 'roas': rows.sort((a, b) => b.roas - a.roas); break
    }
    return rows
  }, [campaigns, campaignFilter, campaignPortfolio, campaignSearch, campaignSort])

  const hasData = series.length > 0 || campaigns.length > 0
  const synced = lastUploadAt(currentBundle)
  const stale = synced ? (Date.now() - new Date(synced).getTime()) > 86_400_000 : false
  const inFlightReports = pendingCount > 0

  if (!hasData) {
    return (
      <div className="space-y-5">
        <AccountHeader
          client={currentClient}
          campaignCount={0}
          synced={synced}
          history={null}
          stale={stale}
          onSyncNow={handleSyncNow}
          syncing={syncing}
          connection={currentConnection}
          canSync={Boolean(currentConnection || spapiConnection)}
        />
        {syncBanner && (
          <div className={cx(
            'rounded-xl2 border px-4 py-3 flex items-start gap-3',
            syncBanner.kind === 'ok' ? 'border-accent-mint/40 bg-accent-mintSoft/60' :
            syncBanner.kind === 'err' ? 'border-accent-blush/40 bg-accent-blushSoft/60' :
            'border-accent-gold/40 bg-accent-goldSoft/60',
          )}>
            {syncBanner.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 text-[#1f7a4a] mt-0.5 shrink-0" /> :
              syncBanner.kind === 'err' ? <AlertTriangle className="w-4 h-4 text-[#9c4651] mt-0.5 shrink-0" /> :
              <AlertTriangle className="w-4 h-4 text-[#8b6a18] mt-0.5 shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="text-sm text-ink">{syncBanner.message}</div>
            </div>
            <button onClick={() => setSyncBanner(null)} className="text-ink-faint hover:text-ink text-2xs">Dismiss</button>
          </div>
        )}
        <EmptyState
          title={
            inFlightReports
              ? `${pendingCount} report${pendingCount === 1 ? '' : 's'} in flight at Amazon`
              : currentConnection
                ? "Live data on the way"
                : "No synced report data yet"
          }
          description={
            inFlightReports
              ? `Amazon is generating campaign reports for ${currentClient.name}. This typically takes 1-15 minutes per report. The dashboard polls every 30 seconds and will fill in automatically — no need to click Sync again.`
              : currentConnection
                ? `${currentClient.name} is connected to Amazon Ads. Click "Sync now" above to request campaign reports.`
                : `Upload a bulk campaign export and business report from the Upload Reports tab, or click "Connect Amazon Ads" on the Clients page to pull live data.`
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <AccountHeader
        client={currentClient}
        campaignCount={campaigns.length}
        synced={synced}
        history={series.length ? { start: series[0].date, end: series[series.length - 1].date } : null}
        stale={stale}
        onSyncNow={handleSyncNow}
        syncing={syncing}
        connection={currentConnection}
        canSync={Boolean(currentConnection || spapiConnection)}
      />

      {syncBanner && (
        <div className={cx(
          'rounded-xl2 border px-4 py-3 flex items-start gap-3',
          syncBanner.kind === 'ok' ? 'border-accent-mint/40 bg-accent-mintSoft/60' :
          syncBanner.kind === 'err' ? 'border-accent-blush/40 bg-accent-blushSoft/60' :
          'border-accent-gold/40 bg-accent-goldSoft/60',
        )}>
          {syncBanner.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 text-[#1f7a4a] mt-0.5 shrink-0" /> :
            syncBanner.kind === 'err' ? <AlertTriangle className="w-4 h-4 text-[#9c4651] mt-0.5 shrink-0" /> :
            <AlertTriangle className="w-4 h-4 text-[#8b6a18] mt-0.5 shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="text-sm text-ink">{syncBanner.message}</div>
          </div>
          <button onClick={() => setSyncBanner(null)} className="text-ink-faint hover:text-ink text-2xs">Dismiss</button>
        </div>
      )}

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <SegmentedControl
              value={preset}
              onChange={(p) => {
                setPreset(p)
                // Seed the custom inputs from the synced data bounds the first time.
                if (p === 'custom' && (!customStart || !customEnd) && series.length > 0) {
                  setCustomStart(series[0].date)
                  setCustomEnd(series[series.length - 1].date)
                }
              }}
              options={[
                { id: '7d', label: 'Last 7 days' },
                { id: '14d', label: 'Last 14 days' },
                { id: '30d', label: 'Last 30 days' },
                { id: 'mtd', label: 'MTD' },
                { id: 'all', label: 'All synced' },
                { id: 'custom', label: 'Custom' },
              ]}
            />
            {preset === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customStart}
                  min={series.length ? series[0].date : undefined}
                  max={customEnd || (series.length ? series[series.length - 1].date : undefined)}
                  onChange={e => setCustomStart(e.target.value)}
                  className="rounded-lg border border-line bg-canvas-panel text-xs px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-ink/15"
                />
                <span className="text-ink-faint text-xs">→</span>
                <input
                  type="date"
                  value={customEnd}
                  min={customStart || (series.length ? series[0].date : undefined)}
                  max={series.length ? series[series.length - 1].date : undefined}
                  onChange={e => setCustomEnd(e.target.value)}
                  className="rounded-lg border border-line bg-canvas-panel text-xs px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-ink/15"
                />
              </div>
            )}
          </div>
          {range ? (
            <div className="mt-2 text-xs text-ink-mute tnum">
              {range.start} → {range.end} · <span className="text-ink-faint">{range.days} days of data</span>
            </div>
          ) : preset === 'custom' ? (
            <div className="mt-2 text-xs text-ink-faint">Pick a start and end date to view a custom range.</div>
          ) : null}
        </div>
      </div>

      <KPIRow totals={totals} prev={prevTotals} ccy={currentClient.currency} />

      {range && (
        <div className="text-xs text-ink-faint -mt-2">
          vs previous period · {range.prevStart} → {range.prevEnd}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Panel className="xl:col-span-2">
          <div className="flex items-end justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold text-ink">Daily spend vs sales</h2>
              <p className="text-xs text-ink-mute mt-0.5">{range?.label ?? '—'}</p>
            </div>
            <ChartLegend />
          </div>
          <ChartArea data={slice} ccy={currentClient.currency} />
        </Panel>

        <Panel>
          <h2 className="text-base font-semibold text-ink">By ad product</h2>
          <div className="mt-3 space-y-3">
            {adSummary.length === 0 && <p className="text-sm text-ink-faint">Upload bulk campaign export to populate.</p>}
            {adSummary.map(g => (
              <div key={g.type} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Pill tone={g.type === 'SP' ? 'peri' : g.type === 'SB' ? 'mint' : g.type === 'SD' ? 'lavender' : 'mute'}>{g.type}</Pill>
                    <span className="text-xs text-ink-mute">{num(g.count)} campaigns</span>
                  </div>
                  <Pill tone={g.acos > 35 ? 'gold' : g.acos > 0 ? 'peri' : 'mute'}>
                    ACOS {g.acos > 0 ? percent(g.acos, 1) : '—'}
                  </Pill>
                </div>
                <div className="mt-2 flex items-center gap-5 text-xs text-ink-mute tnum">
                  <span>Spend <span className="text-ink ml-1">{currency(g.spend, currentClient.currency)}</span></span>
                  <span>Sales <span className="text-ink ml-1">{currency(g.sales, currentClient.currency)}</span></span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-[#f1f2f5] overflow-hidden">
                  <div
                    className={cx(
                      'h-full rounded-full',
                      g.type === 'SP' ? 'bg-accent-peri' : g.type === 'SB' ? 'bg-accent-mint' : g.type === 'SD' ? 'bg-accent-lavender' : 'bg-ink-faint',
                    )}
                    style={{ width: `${Math.min(100, Math.max(2, g.share))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {projection && <ProjectionPanel projection={projection} ccy={currentClient.currency} goals={currentBundle.goals} />}

      <SalesMix totals={totals} ccy={currentClient.currency} />

      <CampaignTable
        campaigns={filteredCampaigns}
        ccy={currentClient.currency}
        search={campaignSearch}
        onSearch={setCampaignSearch}
        filter={campaignFilter}
        onFilter={setCampaignFilter}
        portfolios={portfolios}
        portfolio={campaignPortfolio}
        onPortfolio={setCampaignPortfolio}
        sort={campaignSort}
        onSort={setCampaignSort}
        totalRowCount={campaigns.length}
      />
    </div>
  )
}

function AccountHeader({
  client, campaignCount, synced, history, stale, onSyncNow, syncing, connection, canSync,
}: {
  client: import('../types').Client
  campaignCount: number
  synced: string | null
  history: { start: string; end: string } | null
  stale: boolean
  onSyncNow: () => void
  syncing: boolean
  connection?: { last_synced_at: string | null; amazon_profile_ids: number[] | null } | undefined
  canSync?: boolean
}) {
  const liveSynced = connection?.last_synced_at ?? synced
  const profileCount = connection?.amazon_profile_ids?.length ?? 0
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent-periSoft flex items-center justify-center text-[#3b48a5] text-sm font-semibold">
          {client.name.trim().slice(0, 2).toUpperCase()}
        </div>
        <div>
          <div className="text-lg font-semibold text-ink leading-tight">{client.name}</div>
          <div className="text-xs text-ink-mute mt-0.5">
            {client.marketplace} · {client.currency} · {num(campaignCount)} campaigns
            {connection && profileCount > 0 && <> · {num(profileCount)} Amazon profile{profileCount === 1 ? '' : 's'}</>}
          </div>
          <div className="text-2xs text-ink-faint mt-1">
            Last sync: {timestamp(liveSynced ?? undefined)}
            {history && <> · History: {history.start} → {history.end} ({daysBetween(history.start, history.end)} days)</>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Pill tone="gold" className="px-3 py-1">
          <PlayCircle className="w-3 h-3" />
          Presentation ON
        </Pill>
        <Pill tone={stale ? 'gold' : 'mint'} className="px-3 py-1">
          <span className={cx('w-1.5 h-1.5 rounded-full', stale ? 'bg-[#c98a1a]' : 'bg-[#1f7a4a]')} />
          {stale ? `Out of date · synced ${relativeTime(liveSynced ?? undefined)}` : `Synced ${relativeTime(liveSynced ?? undefined)}`}
        </Pill>
        <Button
          onClick={onSyncNow}
          disabled={syncing || !canSync}
          icon={syncing ? <Spinner size={14} /> : <RefreshCcw className="w-4 h-4" />}
        >
          {syncing ? 'Syncing…' : 'Sync now'}
        </Button>
      </div>
    </div>
  )
}

function KPIRow({ totals, prev, ccy }: { totals: ReportingTotals; prev: ReportingTotals; ccy: import('../types').Currency }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
      <KPICard
        label="Ad Spend"
        tone="peri"
        icon={<Plane className="w-3.5 h-3.5" />}
        value={currency(totals.spend, ccy, true)}
        delta={deltaPct(totals.spend, prev.spend)}
        deltaInvert
        secondary={`${currency(totals.perDaySpend, ccy)}/day`}
      />
      <KPICard
        label="Attributed Sales"
        tone="mint"
        icon={<ShoppingCart className="w-3.5 h-3.5" />}
        value={currency(totals.adSales, ccy, true)}
        delta={deltaPct(totals.adSales, prev.adSales)}
        secondary={`${currency(totals.perDaySales * (totals.adSales / Math.max(totals.totalSales, 1)), ccy)}/day`}
      />
      <KPICard
        label="Account TACOS"
        tone="gold"
        icon={<TargetIcon className="w-3.5 h-3.5" />}
        value={percent(totals.tacos, 1)}
        delta={deltaPct(totals.tacos, prev.tacos)}
        deltaInvert
        secondary="spend / total sales"
      />
      <KPICard
        label="ROAS"
        tone="lavender"
        icon={<TrendingUp className="w-3.5 h-3.5" />}
        value={`${(totals.roas || 0).toFixed(2)}×`}
        delta={deltaPct(totals.roas, prev.roas)}
        secondary="sales / ad cost"
      />
      <KPICard
        label="Orders"
        tone="blush"
        icon={<Package className="w-3.5 h-3.5" />}
        value={num(totals.orders)}
        delta={deltaPct(totals.orders, prev.orders)}
        secondary={`${percent(totals.cvr, 2)} CVR`}
      />
      <KPICard
        label="Total Sales"
        tone="mint"
        icon={<ArrowUpRight className="w-3.5 h-3.5" />}
        value={currency(totals.totalSales, ccy, true)}
        delta={deltaPct(totals.totalSales, prev.totalSales)}
        secondary={`Organic ${currency(totals.organicSales, ccy, true)}`}
      />
      <KPICard
        label="Impressions"
        tone="peri"
        icon={<Eye className="w-3.5 h-3.5" />}
        value={compact(totals.impressions)}
        delta={deltaPct(totals.impressions, prev.impressions)}
      />
      <KPICard
        label="Clicks"
        tone="mint"
        icon={<MousePointerClick className="w-3.5 h-3.5" />}
        value={compact(totals.clicks)}
        delta={deltaPct(totals.clicks, prev.clicks)}
      />
      <KPICard
        label="CTR"
        tone="lavender"
        icon={<Percent className="w-3.5 h-3.5" />}
        value={percent(totals.ctr, 2)}
        delta={deltaPct(totals.ctr, prev.ctr)}
      />
      <KPICard
        label="CVR"
        tone="mint"
        icon={<BarIcon className="w-3.5 h-3.5" />}
        value={percent(totals.cvr, 2)}
        delta={deltaPct(totals.cvr, prev.cvr)}
      />
      <KPICard
        label="CPC"
        tone="gold"
        icon={<Megaphone className="w-3.5 h-3.5" />}
        value={currency(totals.cpc, ccy)}
        delta={deltaPct(totals.cpc, prev.cpc)}
        deltaInvert
      />
      <KPICard
        label="Conv. Rate"
        tone="blush"
        icon={<Percent className="w-3.5 h-3.5" />}
        value={percent(totals.cvr, 2)}
        delta={deltaPct(totals.cvr, prev.cvr)}
        secondary={`AOV ${currency(totals.orders ? totals.adSales / totals.orders : 0, ccy)}`}
      />
    </div>
  )
}

function ChartLegend() {
  return (
    <div className="flex items-center gap-4 text-xs">
      <Legend1 color="#0f1115" label="Sales" />
      <Legend1 color="#9aa6f0" label="Spend" />
      <Legend1 color="#1f9d6b" label="CVR" />
    </div>
  )
}
function Legend1({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-ink-mute">
      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}

function ChartArea({ data, ccy }: { data: DailySeriesPoint[]; ccy: import('../types').Currency }) {
  if (data.length === 0) return <div className="h-64 flex items-center justify-center text-sm text-ink-faint">No data in this range.</div>
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f1115" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#0f1115" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#eef0f4" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={d => d.slice(5)}
            stroke="#9ea3ad"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: '#e7e9ee' }}
          />
          <YAxis
            yAxisId="left"
            stroke="#9ea3ad"
            tick={{ fontSize: 11 }}
            tickFormatter={v => currency(v, ccy, true)}
            tickLine={false}
            axisLine={{ stroke: '#e7e9ee' }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="#9ea3ad"
            tick={{ fontSize: 11 }}
            tickFormatter={v => `${v.toFixed(1)}%`}
            tickLine={false}
            axisLine={{ stroke: '#e7e9ee' }}
          />
          <Tooltip
            formatter={(v: number, name: string) => {
              if (name === 'CVR') return [`${v.toFixed(2)}%`, name]
              return [currency(v, ccy), name]
            }}
            labelFormatter={(l: string) => l}
          />
          <Area yAxisId="left" type="monotone" dataKey={(d: DailySeriesPoint) => (d.totalSales ?? d.adSales)} name="Sales" stroke="#0f1115" strokeWidth={2} fill="url(#salesFill)" dot={false} activeDot={{ r: 4 }} />
          <Line yAxisId="left" type="monotone" dataKey="spend" name="Spend" stroke="#9aa6f0" strokeWidth={2} dot={false} />
          <Line yAxisId="right" type="monotone" dataKey={(d: DailySeriesPoint) => d.cvr ?? 0} name="CVR" stroke="#1f9d6b" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function ProjectionPanel({
  projection, ccy, goals,
}: {
  projection: MonthProjection
  ccy: import('../types').Currency
  goals: import('../types').ClientGoals
}) {
  const p = projection
  const salesLabel = p.hasTotalSales ? 'Total sales' : 'Ad sales'
  const projSales = p.hasTotalSales ? p.projected.totalSales : p.projected.adSales

  const spendPace = p.pace.spendVsBudgetPct
  const salesPace = p.pace.salesVsGoalPct

  return (
    <Panel>
      <div className="flex items-end justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-ink">Projected month-end · {p.monthLabel}</h2>
          <p className="text-xs text-ink-mute mt-0.5">
            Run-rate from {num(p.elapsedDays)} day{p.elapsedDays === 1 ? '' : 's'} of data, extrapolated across {num(p.daysInMonth)} days · {num(p.daysRemaining)} days remaining
          </p>
        </div>
        <Pill tone="lavender">Pacing forecast</Pill>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <ProjStat
          label="Projected ad spend"
          tone="peri"
          value={currency(p.projected.spend, ccy, true)}
          mtd={`${currency(p.mtd.spend, ccy, true)} MTD`}
          pace={Number.isFinite(spendPace)
            ? { pct: spendPace, label: `${percent(spendPace, 0)} of budget`, good: spendPace <= 100 }
            : (goals.monthlyAdBudget > 0 ? undefined : { pct: NaN, label: 'no budget set', good: true })}
        />
        <ProjStat
          label={`Projected ${salesLabel.toLowerCase()}`}
          tone="mint"
          value={currency(projSales, ccy, true)}
          mtd={`${currency(p.hasTotalSales ? p.mtd.totalSales : p.mtd.adSales, ccy, true)} MTD`}
          pace={Number.isFinite(salesPace)
            ? { pct: salesPace, label: `${percent(salesPace, 0)} of goal`, good: salesPace >= 100 }
            : undefined}
        />
        <ProjStat
          label="Projected orders"
          tone="lavender"
          value={num(p.projected.orders)}
          mtd={`${num(p.mtd.orders)} MTD`}
        />
        {p.hasTotalSales ? (
          <ProjStat
            label="Projected TACOS"
            tone={p.projected.tacos > goals.acceptableTacosCeiling ? 'blush' : p.projected.tacos > goals.primaryTacosGoal ? 'gold' : 'mint'}
            value={percent(p.projected.tacos, 1)}
            mtd={`ROAS ${p.projected.roas.toFixed(2)}×`}
          />
        ) : (
          <ProjStat
            label="Projected ROAS"
            tone={p.projected.roas >= goals.targetRoas ? 'mint' : p.projected.roas >= goals.minimumAcceptableRoas ? 'peri' : 'blush'}
            value={`${p.projected.roas.toFixed(2)}×`}
            mtd={`target ${goals.targetRoas.toFixed(2)}×`}
          />
        )}
      </div>

      {!p.hasTotalSales && (
        <p className="mt-3 text-2xs text-ink-faint">
          Sales projection uses ad-attributed sales. Upload a Business Report (organic + total sales) for a full-account TACOS projection.
        </p>
      )}
    </Panel>
  )
}

function ProjStat({
  label, value, mtd, tone, pace,
}: {
  label: string
  value: React.ReactNode
  mtd: string
  tone: 'peri' | 'mint' | 'gold' | 'lavender' | 'blush'
  pace?: { pct: number; label: string; good: boolean }
}) {
  const stripe: Record<string, string> = {
    peri: 'bg-accent-peri', mint: 'bg-accent-mint', gold: 'bg-accent-gold', lavender: 'bg-accent-lavender', blush: 'bg-accent-blush',
  }
  return (
    <div className="relative rounded-lg border border-line p-3">
      <div className={cx('absolute left-3 right-3 top-0 h-[2px] rounded-b-full', stripe[tone])} />
      <div className="text-2xs uppercase tracking-wider text-ink-mute font-semibold">{label}</div>
      <div className="mt-1.5 tnum text-xl font-semibold text-ink">{value}</div>
      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
        <span className="text-2xs text-ink-faint tnum">{mtd}</span>
        {pace && Number.isFinite(pace.pct) && (
          <Pill tone={pace.good ? 'mint' : 'gold'}>{pace.label}</Pill>
        )}
        {pace && !Number.isFinite(pace.pct) && (
          <span className="text-2xs text-ink-faint">{pace.label}</span>
        )}
      </div>
    </div>
  )
}

function SalesMix({ totals, ccy }: { totals: ReportingTotals; ccy: import('../types').Currency }) {
  const adShare = totals.totalSales > 0 ? (totals.adSales / totals.totalSales) * 100 : 0
  const organicShare = 100 - adShare
  return (
    <Panel>
      <div className="flex items-end justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Sales mix</h2>
          <p className="text-xs text-ink-mute mt-0.5">Ad vs organic contribution to total sales</p>
        </div>
        <Pill tone={totals.tacos > 18 ? 'gold' : 'mint'}>
          TACOS {percent(totals.tacos, 1)}
        </Pill>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Stat label="Ad-attributed" value={currency(totals.adSales, ccy)} hint={`${percent(adShare, 1)} of total`} tone="peri" />
        <Stat label="Organic" value={currency(totals.organicSales, ccy)} hint={`${percent(organicShare, 1)} of total`} tone="mint" />
        <Stat label="Total sales" value={currency(totals.totalSales, ccy)} hint={`${num(totals.days)} days`} tone="lavender" />
        <Stat label="Orders" value={num(totals.orders)} hint={`AOV ${currency(totals.orders ? totals.adSales / totals.orders : 0, ccy)}`} tone="gold" />
      </div>
      <div className="mt-4 h-2 rounded-full bg-accent-mintSoft overflow-hidden">
        <div className="h-full bg-accent-peri" style={{ width: `${Math.min(100, Math.max(2, adShare))}%` }} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-2xs text-ink-faint tnum">
        <span>Ad {percent(adShare, 1)}</span>
        <span>Organic {percent(organicShare, 1)}</span>
      </div>
    </Panel>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone: 'peri' | 'mint' | 'gold' | 'lavender' | 'blush' }) {
  const stripe: Record<string, string> = {
    peri: 'bg-accent-peri', mint: 'bg-accent-mint', gold: 'bg-accent-gold', lavender: 'bg-accent-lavender', blush: 'bg-accent-blush',
  }
  return (
    <div className="relative rounded-lg border border-line p-3">
      <div className={cx('absolute left-3 right-3 top-0 h-[2px] rounded-b-full', stripe[tone])} />
      <div className="text-2xs uppercase tracking-wider text-ink-mute font-semibold">{label}</div>
      <div className="mt-1.5 tnum text-lg font-semibold text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-2xs text-ink-faint">{hint}</div>}
    </div>
  )
}

function CampaignTable({
  campaigns, ccy, search, onSearch, filter, onFilter, portfolios, portfolio, onPortfolio, sort, onSort, totalRowCount,
}: {
  campaigns: CampaignRow[]
  ccy: import('../types').Currency
  search: string; onSearch: (v: string) => void
  filter: 'all' | 'SP' | 'SB' | 'OTHER'; onFilter: (v: 'all' | 'SP' | 'SB' | 'OTHER') => void
  portfolios: { list: string[]; unassigned: number }
  portfolio: string; onPortfolio: (v: string) => void
  sort: 'spend' | 'sales' | 'orders' | 'roas'; onSort: (v: 'spend' | 'sales' | 'orders' | 'roas') => void
  totalRowCount: number
}) {
  const top = campaigns.slice(0, 3)
  const needsAttention = [...campaigns]
    .filter(c => c.spend > 0)
    .sort((a, b) => (b.spend - b.adSales) - (a.spend - a.adSales))
    .slice(0, 3)

  return (
    <Panel className="overflow-hidden" padding="p-0">
      <div className="px-5 pt-5 pb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Campaigns</h2>
          <p className="text-xs text-ink-mute mt-0.5">{num(totalRowCount)} active across SP, SB and Other ad products</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-faint" />
            <input
              value={search}
              onChange={e => onSearch(e.target.value)}
              placeholder="Search campaigns, ID, product..."
              className="w-72 pl-7 pr-3 py-1.5 rounded-full border border-line bg-canvas-panel text-xs focus:outline-none focus:ring-2 focus:ring-ink/15"
            />
          </div>
          <SegmentedControl<'all' | 'SP' | 'SB' | 'OTHER'>
            value={filter}
            onChange={onFilter}
            options={[
              { id: 'all', label: `All (${num(totalRowCount)})` },
              { id: 'SP', label: `SP (${num(campaigns.filter(c => c.type === 'SP').length)})` },
              { id: 'SB', label: `SB (${num(campaigns.filter(c => c.type === 'SB').length)})` },
              { id: 'OTHER', label: `Other (${num(campaigns.filter(c => c.type === 'SD' || c.type === 'OTHER').length)})` },
            ]}
          />
          {(portfolios.list.length > 0 || portfolios.unassigned > 0) && (
            <select
              value={portfolio}
              onChange={e => onPortfolio(e.target.value)}
              className="px-3 py-1.5 rounded-full border border-line text-xs bg-canvas-panel max-w-[220px] truncate"
              title="Filter by portfolio"
            >
              <option value="all">All portfolios ({portfolios.list.length + (portfolios.unassigned > 0 ? 1 : 0)})</option>
              {portfolios.list.map(p => <option key={p} value={p}>{p}</option>)}
              {portfolios.unassigned > 0 && <option value="__none__">No portfolio ({portfolios.unassigned})</option>}
            </select>
          )}
          <select
            value={sort}
            onChange={e => onSort(e.target.value as typeof sort)}
            className="px-3 py-1.5 rounded-full border border-line text-xs bg-canvas-panel"
          >
            <option value="spend">Sort: Spend</option>
            <option value="sales">Sort: Sales</option>
            <option value="orders">Sort: Orders</option>
            <option value="roas">Sort: ROAS</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-5 pb-3">
        <SummaryStrip title="Top campaigns" rows={top} tone="mint" ccy={ccy} />
        <SummaryStrip title="Needs attention" rows={needsAttention} tone="gold" ccy={ccy} invert />
      </div>

      <div className="overflow-x-auto border-t border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-canvas-tint text-ink-mute text-2xs uppercase tracking-wider">
              <th className="text-left px-5 py-2.5 font-medium">Campaign</th>
              <th className="text-left px-3 py-2.5 font-medium">Type</th>
              <th className="text-right px-3 py-2.5 font-medium">Impressions</th>
              <th className="text-right px-3 py-2.5 font-medium">Clicks</th>
              <th className="text-right px-3 py-2.5 font-medium">Spend</th>
              <th className="text-right px-3 py-2.5 font-medium">Ad Sales</th>
              <th className="text-right px-3 py-2.5 font-medium">Orders</th>
              <th className="text-right px-3 py-2.5 font-medium">ROAS</th>
              <th className="text-right px-3 py-2.5 font-medium">CTR</th>
              <th className="text-right px-3 py-2.5 font-medium pr-5">CVR</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.length === 0 && (
              <tr><td colSpan={10} className="text-center py-8 text-sm text-ink-faint">No campaigns match these filters.</td></tr>
            )}
            {campaigns.slice(0, 200).map((c, i) => (
              <tr key={`${c.campaignId ?? c.campaign}-${i}`} className="border-t border-line hover:bg-canvas-tint">
                <td className="px-5 py-2.5 max-w-[420px]">
                  <div className="font-medium text-ink truncate">{c.campaign}</div>
                  <div className="text-2xs text-ink-faint tnum truncate">
                    {c.campaignId}
                    {c.portfolio && <> · <span className="text-ink-mute">{c.portfolio}</span></>}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <Pill tone={c.type === 'SP' ? 'peri' : c.type === 'SB' ? 'mint' : c.type === 'SD' ? 'lavender' : 'mute'}>{c.type}</Pill>
                </td>
                <td className="px-3 py-2.5 text-right tnum">{compact(c.impressions)}</td>
                <td className="px-3 py-2.5 text-right tnum">{compact(c.clicks)}</td>
                <td className="px-3 py-2.5 text-right tnum">{currency(c.spend, ccy)}</td>
                <td className="px-3 py-2.5 text-right tnum">{currency(c.adSales, ccy)}</td>
                <td className="px-3 py-2.5 text-right tnum">{num(c.orders)}</td>
                <td className="px-3 py-2.5 text-right tnum">
                  <Pill tone={c.roas >= 3 ? 'mint' : c.roas >= 1.5 ? 'peri' : 'blush'}>
                    {c.roas > 0 ? `${c.roas.toFixed(2)}×` : '—'}
                  </Pill>
                </td>
                <td className="px-3 py-2.5 text-right tnum">{percent(c.ctr, 2)}</td>
                <td className="px-3 py-2.5 text-right tnum pr-5">{percent(c.cvr, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {campaigns.length > 200 && (
        <div className="px-5 py-3 text-2xs text-ink-faint border-t border-line">
          Showing first 200 of {num(campaigns.length)} matching campaigns. Refine the search above to narrow.
        </div>
      )}
    </Panel>
  )
}

function SummaryStrip({ title, rows, tone, ccy, invert }: { title: string; rows: CampaignRow[]; tone: 'mint' | 'gold'; ccy: import('../types').Currency; invert?: boolean }) {
  if (rows.length === 0) return null
  return (
    <div className={cx('rounded-lg border border-line p-3', tone === 'mint' ? 'bg-accent-mintSoft/30' : 'bg-accent-goldSoft/30')}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xs uppercase tracking-wider font-semibold text-ink-mute">{title}</span>
        <Pill tone={tone}>{rows.length}</Pill>
      </div>
      <div className="space-y-1.5">
        {rows.map((c, i) => (
          <div key={i} className="flex items-center justify-between gap-3 text-xs">
            <span className="truncate text-ink">{c.campaign}</span>
            <span className="tnum text-ink-mute">
              {currency(c.spend, ccy)} · {c.roas > 0 ? `${c.roas.toFixed(2)}×` : '—'}
              {invert && c.spend - c.adSales > 0 && <span className="text-[#9c4651] ml-1">(-{currency(c.spend - c.adSales, ccy)})</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function lastUploadAt(bundle: import('../types').ClientBundle): string | null {
  let latest: string | null = null
  for (const r of Object.values(bundle.reports)) {
    if (!r) continue
    if (!latest || r.uploadedAt > latest) latest = r.uploadedAt
  }
  return latest
}
