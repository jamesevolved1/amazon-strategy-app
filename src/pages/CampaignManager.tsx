// Internal campaign-management workspace. Houses the portfolio rollup and the
// filterable campaign table — the granular views we keep OFF the client-facing
// Reporting Dashboard.

import React, { useMemo, useState } from 'react'
import { Megaphone } from 'lucide-react'
import { useStore } from '../lib/store'
import { useClientCampaigns } from '../lib/campaignData'
import { portfolioSummary } from '../utils/pnl'
import { PortfolioRollup, CampaignTable } from '../components/CampaignViews'
import { EmptyState } from '../components/ui'

export function CampaignManager() {
  const { currentClient, currentBundle } = useStore()
  const campaigns = useClientCampaigns()

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'SP' | 'SB' | 'OTHER'>('all')
  const [stateFilter, setStateFilter] = useState<'all' | 'enabled' | 'paused' | 'archived'>('all')
  const [portfolio, setPortfolio] = useState('all')
  const [sort, setSort] = useState<'spend' | 'sales' | 'orders' | 'roas'>('spend')

  const portfolioRollup = useMemo(() => portfolioSummary(campaigns), [campaigns])

  const portfolios = useMemo(() => {
    const set = new Set<string>()
    let unassigned = 0
    for (const c of campaigns) {
      if (c.portfolio) set.add(c.portfolio)
      else unassigned++
    }
    return { list: Array.from(set).sort((a, b) => a.localeCompare(b)), unassigned }
  }, [campaigns])

  // Campaigns whose state isn't synced yet count as enabled so the default view
  // is never empty.
  const stateCounts = useMemo(() => {
    let enabled = 0, paused = 0, archived = 0
    for (const c of campaigns) {
      if (c.state === 'paused') paused++
      else if (c.state === 'archived') archived++
      else enabled++
    }
    return { all: campaigns.length, enabled, paused, archived }
  }, [campaigns])

  const filtered = useMemo(() => {
    let rows = campaigns
    if (filter === 'OTHER') rows = rows.filter(c => c.type === 'SD' || c.type === 'OTHER')
    else if (filter !== 'all') rows = rows.filter(c => c.type === filter)
    if (stateFilter !== 'all') rows = rows.filter(c => (c.state ?? 'enabled') === stateFilter)
    if (portfolio !== 'all') {
      if (portfolio === '__none__') rows = rows.filter(c => !c.portfolio)
      else rows = rows.filter(c => c.portfolio === portfolio)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter(c =>
        c.campaign.toLowerCase().includes(q) ||
        (c.campaignId ?? '').toLowerCase().includes(q) ||
        (c.product ?? '').toLowerCase().includes(q) ||
        (c.portfolio ?? '').toLowerCase().includes(q))
    }
    rows = rows.slice()
    switch (sort) {
      case 'spend': rows.sort((a, b) => b.spend - a.spend); break
      case 'sales': rows.sort((a, b) => b.adSales - a.adSales); break
      case 'orders': rows.sort((a, b) => b.orders - a.orders); break
      case 'roas': rows.sort((a, b) => b.roas - a.roas); break
    }
    return rows
  }, [campaigns, filter, stateFilter, portfolio, search, sort])

  if (!currentClient || !currentBundle) {
    return <EmptyState title="Add a client to begin" description="Use the switcher in the sidebar to create a client." />
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent-lavenderSoft flex items-center justify-center text-[#5b4a90]">
          <Megaphone className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-ink leading-tight">Campaign Manager</h1>
          <p className="text-xs text-ink-mute mt-0.5">
            {currentClient.name} · internal working view — portfolios &amp; campaign detail
          </p>
        </div>
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaign data yet"
          description="Sync Amazon Ads for this client (Reporting Dashboard → Sync now) or upload a bulk campaign export."
        />
      ) : (
        <>
          {portfolioRollup.some(p => !p.unassigned) && (
            <PortfolioRollup
              groups={portfolioRollup}
              ccy={currentClient.currency}
              targetRoas={currentBundle.goals.targetRoas}
              minRoas={currentBundle.goals.minimumAcceptableRoas}
            />
          )}
          <CampaignTable
            campaigns={filtered}
            ccy={currentClient.currency}
            search={search} onSearch={setSearch}
            filter={filter} onFilter={setFilter}
            stateFilter={stateFilter} onStateFilter={setStateFilter}
            stateCounts={stateCounts}
            portfolios={portfolios}
            portfolio={portfolio} onPortfolio={setPortfolio}
            sort={sort} onSort={setSort}
            totalRowCount={campaigns.length}
          />
        </>
      )}
    </div>
  )
}
