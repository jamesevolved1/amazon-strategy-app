// Shared campaign-row derivation. Prefers Amazon-synced campaigns; falls back
// to an uploaded bulk campaign export. Used by both the (client-facing)
// Reporting Dashboard and the (internal) Campaign Manager so the mapping lives
// in one place.

import { useMemo } from 'react'
import { useStore } from './store'
import { useAmazonConnections, type SyncedCampaign } from './amazon'
import type { CampaignRow } from '../types'
import type { BulkCampaignData } from '../utils/parsers'

export function mapCampaignRows(
  synced: SyncedCampaign[] | null | undefined,
  bulk: BulkCampaignData | undefined,
): CampaignRow[] {
  if (synced && synced.length > 0) {
    return synced.map(c => ({
      campaign: c.campaign,
      campaignId: c.campaignId,
      type: c.type,
      state: c.state,
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
}

// Convenience hook for pages that only need the campaign rows for the current
// client (it owns its own connection fetch). Pages that already subscribe to
// useAmazonConnections should call mapCampaignRows directly to avoid a second
// fetch.
export function useClientCampaigns(): CampaignRow[] {
  const { currentClient, currentBundle } = useStore()
  const { connections } = useAmazonConnections()
  const conn = currentClient ? connections.find(c => c.app_client_id === currentClient.id) : undefined
  const synced = conn?.synced_data?.campaigns ?? null
  const bulk = currentBundle?.reports?.bulkCampaigns?.parsed as BulkCampaignData | undefined
  return useMemo(() => mapCampaignRows(synced, bulk), [synced, bulk])
}
