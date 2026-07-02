// Audit inputs adapter — the ONLY source-aware code in the audit engine.
// Normalizes whatever sources are present (uploaded reports today; live
// Amazon Ads sync later) into one AuditInputs snapshot that the gate and
// the deep-dive engine consume. Everything downstream is pure.

import type {
  BulkEntityRow, CampaignRow, ClientBundle, ClientGoals, DailySeriesPoint,
  PlacementRow, RestockRow, SearchTermRow, SkuRow, TargetingRow, UploadedReport,
} from '../types'
import { mergeReportsIntoSkus, type MergedReports } from '../utils/pnl'
import type {
  AdvertisedProductData, BulkCampaignData, BulkStructureData, BusinessReportData,
  CogsMappingData, FeePreviewData, MasterProfitData, PlacementData,
  RestockData, SearchTermData, StorageFeeData, TargetingData,
} from '../utils/parsers'

/** Which underlying source satisfied a data requirement. */
export type SourceKind = 'upload' | 'liveSync'

export interface SourceMeta {
  kind: SourceKind
  label: string
  fileName?: string
  uploadedAt?: string
  rowCount?: number
  warnings?: string[]
}

export interface AuditInputs {
  goals: ClientGoals
  /** Campaign-level performance (from bulkCampaigns upload; later: live sync). */
  campaigns: CampaignRow[] | null
  /** Daily account series (business report / bulk daily tabs). */
  daily: DailySeriesPoint[] | null
  /** SKU-level economics (master profit + fee/COGS merges). */
  skus: SkuRow[] | null
  searchTerms: SearchTermRow[] | null
  targeting: TargetingRow[] | null
  placements: PlacementRow[] | null
  bulkStructure: BulkEntityRow[] | null
  restock: RestockRow[] | null
  /** Which source provided each slot — drives gate display. */
  sources: Partial<Record<AuditSlot, SourceMeta>>
}

export type AuditSlot =
  | 'campaigns' | 'daily' | 'skus' | 'searchTerms' | 'targeting'
  | 'placements' | 'bulkStructure' | 'restock'

function meta(r: UploadedReport | undefined): SourceMeta | undefined {
  if (!r) return undefined
  return {
    kind: 'upload',
    label: r.name,
    fileName: r.fileName,
    uploadedAt: r.uploadedAt,
    rowCount: r.rowCount,
    warnings: r.warnings,
  }
}

/** Live-synced Amazon Ads data for the client (from useAmazonConnections). */
export interface LiveSyncedData {
  campaigns?: unknown[]
  daily?: unknown[]
  audit?: Partial<Record<'searchTerm' | 'targeting' | 'placement', {
    window: { start: string; end: string }
    updatedAt: string
    rows: unknown[]
  }>>
  syncedAt?: string | null
}

function liveMeta(label: string, rows: number, updatedAt?: string | null): SourceMeta {
  return { kind: 'liveSync', label, rowCount: rows, uploadedAt: updatedAt ?? undefined }
}

export function buildAuditInputs(bundle: ClientBundle, live?: LiveSyncedData | null): AuditInputs {
  const reports = bundle.reports
  const sources: AuditInputs['sources'] = {}

  // Campaign performance + daily series: bulk campaign export upload wins;
  // live Amazon Ads sync fills the slot otherwise.
  const bulk = reports.bulkCampaigns?.parsed as BulkCampaignData | undefined
  let campaigns = bulk?.campaigns ?? null
  if (campaigns) sources.campaigns = meta(reports.bulkCampaigns)
  else if (live?.campaigns?.length) {
    campaigns = live.campaigns as CampaignRow[]
    sources.campaigns = liveMeta('Amazon Ads sync', live.campaigns.length, live.syncedAt)
  }

  // Daily series: prefer business report daily; fall back to bulk daily tab, then live sync.
  const business = reports.businessReport?.parsed as BusinessReportData | undefined
  let daily = business?.daily?.length ? business.daily : (bulk?.daily ?? null)
  if (daily) {
    sources.daily = business?.daily?.length ? meta(reports.businessReport) : meta(reports.bulkCampaigns)
  } else if (live?.daily?.length) {
    daily = live.daily as DailySeriesPoint[]
    sources.daily = liveMeta('Amazon Ads sync', live.daily.length, live.syncedAt)
  }

  // SKU economics — reuse the P&L merge used across the app.
  let skus: SkuRow[] | null = null
  if (reports.masterProfit) {
    const merged: MergedReports = {
      masterProfit: reports.masterProfit?.parsed as MasterProfitData | undefined,
      bulkCampaigns: bulk,
      businessReport: business,
      advertisedProduct: reports.advertisedProduct?.parsed as AdvertisedProductData | undefined,
      feePreview: reports.feePreview?.parsed as FeePreviewData | undefined,
      storageFee: reports.storageFee?.parsed as StorageFeeData | undefined,
      cogsMapping: reports.cogsMapping?.parsed as CogsMappingData | undefined,
    }
    const enriched = mergeReportsIntoSkus(merged)
    skus = enriched.skus.length ? enriched.skus : null
    if (skus) sources.skus = meta(reports.masterProfit)
  }

  const st = reports.searchTerm?.parsed as SearchTermData | undefined
  let searchTerms = st?.rows?.length ? st.rows : null
  if (searchTerms) sources.searchTerms = meta(reports.searchTerm)
  else if (live?.audit?.searchTerm?.rows?.length) {
    const a = live.audit.searchTerm
    searchTerms = a.rows as SearchTermRow[]
    sources.searchTerms = liveMeta(`Amazon Ads sync · ${a.window.start} → ${a.window.end}`, a.rows.length, a.updatedAt)
  }

  const tg = reports.targeting?.parsed as TargetingData | undefined
  let targeting = tg?.rows?.length ? tg.rows : null
  if (targeting) sources.targeting = meta(reports.targeting)
  else if (live?.audit?.targeting?.rows?.length) {
    const a = live.audit.targeting
    targeting = a.rows as TargetingRow[]
    sources.targeting = liveMeta(`Amazon Ads sync · ${a.window.start} → ${a.window.end}`, a.rows.length, a.updatedAt)
  }

  const pl = reports.placement?.parsed as PlacementData | undefined
  let placements = pl?.rows?.length ? pl.rows : null
  if (placements) sources.placements = meta(reports.placement)
  else if (live?.audit?.placement?.rows?.length) {
    const a = live.audit.placement
    placements = a.rows as PlacementRow[]
    sources.placements = liveMeta(`Amazon Ads sync · ${a.window.start} → ${a.window.end}`, a.rows.length, a.updatedAt)
  }

  const bs = reports.bulkStructure?.parsed as BulkStructureData | undefined
  const bulkStructure = bs?.rows?.length ? bs.rows : null
  if (bulkStructure) sources.bulkStructure = meta(reports.bulkStructure)

  const rs = reports.restock?.parsed as RestockData | undefined
  const restock = rs?.rows?.length ? rs.rows : null
  if (restock) sources.restock = meta(reports.restock)

  return {
    goals: bundle.goals,
    campaigns, daily, skus, searchTerms, targeting, placements, bulkStructure, restock,
    sources,
  }
}
