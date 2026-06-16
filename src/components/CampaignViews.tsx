// Internal (non-client-facing) campaign views: the portfolio rollup and the
// filterable campaign table. Rendered on the Campaign Manager page. Kept out of
// the client-facing Reporting Dashboard.

import React from 'react'
import { Search } from 'lucide-react'
import { Panel, Pill, SegmentedControl, cx } from './ui'
import { compact, currency, multiplier, num, percent } from '../lib/format'
import type { CampaignRow, Currency } from '../types'
import type { PortfolioGroup } from '../utils/pnl'

export function PortfolioRollup({ groups, ccy, targetRoas, minRoas }: {
  groups: PortfolioGroup[]
  ccy: Currency
  targetRoas: number
  minRoas: number
}) {
  const named = groups.filter(g => !g.unassigned)
  const roasTone = (r: number): 'mint' | 'peri' | 'blush' =>
    r >= targetRoas ? 'mint' : r >= minRoas ? 'peri' : 'blush'
  const cols = 'grid grid-cols-[2fr_1fr_1fr_auto_1.4fr] gap-3 items-center'
  return (
    <Panel>
      <div className="flex items-end justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-ink">By portfolio</h2>
          <p className="text-xs text-ink-mute mt-0.5">Spend, sales &amp; ROAS across your Amazon portfolios</p>
        </div>
        <Pill tone="mute">{num(named.length)} portfolio{named.length === 1 ? '' : 's'}</Pill>
      </div>
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="min-w-[640px]">
          <div className={cx(cols, 'px-2 pb-2 text-2xs uppercase tracking-wider text-ink-faint font-semibold border-b border-line')}>
            <span>Portfolio</span>
            <span className="text-right">Spend</span>
            <span className="text-right">Ad sales</span>
            <span className="text-right">ROAS</span>
            <span>Share of spend</span>
          </div>
          {groups.map(g => (
            <div key={g.name} className={cx(cols, 'px-2 py-2.5 border-b border-line/60 last:border-0')}>
              <div className="min-w-0">
                <div className={cx('text-sm font-medium truncate', g.unassigned ? 'text-ink-mute italic' : 'text-ink')}>{g.name}</div>
                <div className="text-2xs text-ink-faint tnum">{num(g.count)} campaign{g.count === 1 ? '' : 's'} · {num(g.orders)} orders</div>
              </div>
              <div className="text-right tnum text-sm text-ink">{currency(g.spend, ccy)}</div>
              <div className="text-right tnum text-sm text-ink">{currency(g.sales, ccy)}</div>
              <div className="text-right">
                {g.spend > 0
                  ? <Pill tone={roasTone(g.roas)}>{multiplier(g.roas)}</Pill>
                  : <span className="text-2xs text-ink-faint">—</span>}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-[#f1f2f5] overflow-hidden">
                  <div
                    className={cx('h-full rounded-full', g.unassigned ? 'bg-ink-faint' : 'bg-accent-peri')}
                    style={{ width: `${Math.min(100, Math.max(2, g.shareSpend))}%` }}
                  />
                </div>
                <span className="tnum text-2xs text-ink-mute w-9 text-right">{percent(g.shareSpend, 0)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  )
}

export function CampaignTable({
  campaigns, ccy, search, onSearch, filter, onFilter, stateFilter, onStateFilter, stateCounts, portfolios, portfolio, onPortfolio, sort, onSort, totalRowCount,
}: {
  campaigns: CampaignRow[]
  ccy: Currency
  search: string; onSearch: (v: string) => void
  filter: 'all' | 'SP' | 'SB' | 'OTHER'; onFilter: (v: 'all' | 'SP' | 'SB' | 'OTHER') => void
  stateFilter: 'all' | 'enabled' | 'paused' | 'archived'; onStateFilter: (v: 'all' | 'enabled' | 'paused' | 'archived') => void
  stateCounts: { all: number; enabled: number; paused: number; archived: number }
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
          <select
            value={stateFilter}
            onChange={e => onStateFilter(e.target.value as 'all' | 'enabled' | 'paused' | 'archived')}
            className="px-3 py-1.5 rounded-full border border-line text-xs bg-canvas-panel"
            title="Filter by campaign state"
          >
            <option value="all">All states ({num(stateCounts.all)})</option>
            <option value="enabled">Enabled ({num(stateCounts.enabled)})</option>
            <option value="paused">Paused ({num(stateCounts.paused)})</option>
            {stateCounts.archived > 0 && <option value="archived">Archived ({num(stateCounts.archived)})</option>}
          </select>
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
            onChange={e => onSort(e.target.value as 'spend' | 'sales' | 'orders' | 'roas')}
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

function SummaryStrip({ title, rows, tone, ccy, invert }: { title: string; rows: CampaignRow[]; tone: 'mint' | 'gold'; ccy: Currency; invert?: boolean }) {
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
