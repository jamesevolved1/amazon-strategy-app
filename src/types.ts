// Domain types shared across utilities, store, and UI.

export type Marketplace = 'US' | 'CA' | 'MX' | 'UK' | 'DE' | 'FR' | 'ES' | 'IT' | 'JP' | 'AU' | 'NL' | 'SE' | 'PL' | 'TR' | 'AE' | 'IN' | 'SG' | 'BR'

export type Currency = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'MXN' | 'JPY' | 'AUD' | 'SEK' | 'PLN' | 'TRY' | 'AED' | 'INR' | 'SGD' | 'BRL'

export interface Client {
  id: string
  name: string
  marketplace: Marketplace
  currency: Currency
  createdAt: string
  inLaunch?: boolean
  launchSku?: string
  launchStartedAt?: string
}

export interface ClientGoals {
  monthlyAdBudget: number
  primaryTacosGoal: number     // %, e.g. 12
  acceptableTacosCeiling: number // %, e.g. 18
  targetRoas: number             // x, e.g. 5
  minimumAcceptableRoas: number  // x, e.g. 3
  currentProjectedMonthlySales: number
  desiredNext30DaySales: number
  couponGoal: number             // % of sales
}

export interface Scenario {
  id: string
  name: string
  adSpendMultiplier: number   // 1.0 = unchanged
  cogsAdjustment: number      // additive shift % to COGS, default 0
  priceAdjustment: number     // additive shift % to price, default 0
  couponRateOverride: number | null // % or null
  createdAt: string
}

export type ReportKey =
  | 'masterProfit'
  | 'bulkCampaigns'
  | 'businessReport'
  | 'advertisedProduct'
  | 'feePreview'
  | 'storageFee'
  | 'cogsMapping'
  | 'strategyDoc'
  | 'optimizationSchedule'
  // PPC audit engine sources (Evolved deep-dive intake gate):
  | 'searchTerm'
  | 'targeting'
  | 'placement'
  | 'bulkStructure'
  | 'restock'

export interface UploadedReport {
  key: ReportKey
  name: string
  uploadedAt: string
  fileName: string
  // Parsed contents — each parser produces its own shape. Stored as JSON.
  parsed: unknown
  rowCount?: number
  warnings?: string[]
}

export interface SkuRow {
  sku: string
  asin?: string
  parentAsin?: string
  title?: string
  sales: number
  units: number
  price?: number
  referralFees: number
  fbaFees: number
  storageFees: number
  shippingToAmazon: number
  cogs: number
  adSpend: number
  adSales: number
  couponCosts: number
  // Derived (filled by calc layer):
  profit?: number
  margin?: number
  tacos?: number
  breakEvenTacos?: number
  maxProfitableAdSpend?: number
  status?: SkuStatus
}

export type SkuStatus =
  | 'profit_leader'
  | 'scale_candidate'
  | 'optimize'
  | 'breakeven'
  | 'unprofitable'
  | 'inactive'

export interface ParentAsinRow {
  parentAsin: string
  title?: string
  childCount: number
  sales: number
  units: number
  adSpend: number
  adSales: number
  cogs: number
  fees: number
  profit: number
  margin: number
  tacos: number
  breakEvenTacos: number
  status: SkuStatus
  customTacosTarget?: number
  customMarginTarget?: number
  children: SkuRow[]
}

export interface CampaignRow {
  campaign: string
  campaignId?: string
  type: 'SP' | 'SB' | 'SD' | 'OTHER'
  state?: 'enabled' | 'paused' | 'archived'
  portfolio?: string
  portfolioId?: string
  impressions: number
  clicks: number
  spend: number
  adSales: number
  orders: number
  ctr: number     // %
  cvr: number     // %
  roas: number    // x
  acos: number    // %
  cpc: number
  product?: string
}

export interface DailySeriesPoint {
  date: string      // YYYY-MM-DD
  spend: number
  adSales: number
  orders: number          // ad-attributed orders (purchases) — drives ad CVR
  totalOrders?: number    // total order items from the Business Report (all sources)
  impressions: number
  clicks: number
  totalSales?: number
  organicSales?: number
  cvr?: number      // %
  ctr?: number      // %
}

// ---------- PPC audit engine report rows ----------

/** One row of the SP Search Term report (Customer Search Term level). */
export interface SearchTermRow {
  campaignName: string
  adGroupName: string
  targeting: string        // the keyword/expression the term matched against
  matchType: string        // BROAD | PHRASE | EXACT | auto group ("close-match" etc.)
  searchTerm: string
  impressions: number
  clicks: number
  spend: number
  sales: number
  orders: number
  ctr: number   // %
  cpc: number
  roas: number  // x
  acos: number  // %
}

/** One row of the SP Targeting report (keyword/PT expression level). */
export interface TargetingRow {
  campaignName: string
  adGroupName: string
  targeting: string
  matchType: string
  impressions: number
  clicks: number
  spend: number
  sales: number
  orders: number
  cpc: number
  roas: number
  acos: number
}

/** One row of the SP Placement report (campaign × placement). */
export interface PlacementRow {
  campaignName: string
  placement: string        // 'Top of Search' | 'Rest of Search' | 'Product Pages' | raw label
  biddingStrategy: string
  impressions: number
  clicks: number
  spend: number
  sales: number
  orders: number
  cpc: number
  roas: number
}

/** One entity row from the "Sponsored Products Campaigns" bulk-operations sheet.
 *  This is the STRUCTURE view (bids, match types, negatives, budgets, IDs) —
 *  distinct from parseBulkCampaigns which reads campaign performance. */
export interface BulkEntityRow {
  entity:
    | 'Campaign' | 'Ad Group' | 'Product Ad' | 'Keyword' | 'Negative Keyword'
    | 'Campaign Negative Keyword' | 'Product Targeting' | 'Negative Product Targeting'
    | 'Bidding Adjustment' | string
  operation?: string
  campaignId: string
  campaignName: string
  adGroupId?: string
  adGroupName?: string
  portfolioId?: string
  state?: string
  dailyBudget?: number
  targetingType?: 'AUTO' | 'MANUAL' | string
  biddingStrategy?: string
  placement?: string
  percentage?: number
  keywordId?: string
  keywordText?: string
  matchType?: string
  productTargetingId?: string
  productTargetingExpression?: string
  sku?: string
  asin?: string
  bid?: number
  adGroupDefaultBid?: number
}

/** One row of the Restock Recommendations report. */
export interface RestockRow {
  sku: string
  asin?: string
  productName?: string
  available: number
  daysOfSupply?: number
  recommendedShipQty?: number
  alert?: string
}

export type OptCategory = 'bid' | 'campaign' | 'creatives' | 'seo' | 'additional'
export type OptCadence = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'oneoff'

export interface OptimizationTask {
  id: string
  title: string
  detail?: string
  notes?: string        // running log added by the user while working the task
  due: string           // YYYY-MM-DD
  completed: boolean
  completedAt?: string  // ISO
  category?: OptCategory | string
  cadence?: OptCadence
  recurring?: boolean         // when completed, auto-spawn the next occurrence at due + cadence
  recurrenceSpawned?: boolean // internal guard: next occurrence already created
  templateKey?: string  // links back to a Sophie Society playbook template
  clientId: string
  createdAt: string
}

// Approve/Deny + note a recommended Action Center move. Keyed by the action's
// stable signature so the decision survives re-runs of the engine.
export interface ActionDecision {
  status?: 'approved' | 'denied'   // undefined = not yet decided
  note?: string
  decidedAt: string   // ISO
}

// A bid/negation change exported from the Optimizer — the running audit trail.
export interface ChangeLogEntry {
  id: string
  date: string            // ISO when exported
  marketplace: string
  entityKind: 'keyword' | 'target'
  campaignId: string
  text: string
  matchType?: string
  action: 'raise' | 'lower' | 'negate'
  fromBid: number
  toBid: number | null    // null for negate
  note?: string
  batchId: string         // groups one export together (matches the reverse file)
}

export interface StrategyScorecard {
  currentMonth: StrategyMonth
  priorMonth: StrategyMonth
  projection: StrategyMonth
  dataCurrentThrough: string
  series: StrategySeries
}

export interface StrategyMonth {
  label: string
  totalSales: number
  organicSales: number
  adSales: number
  impressions: number
  clicks: number
  spend: number
  orders: number
  ctr: number
  cvr: number
  roas: number
  tacos: number
}

export interface StrategySeries {
  dates: string[]
  totalSales: number[]
  organicSales: number[]
  adSales: number[]
  impressions: number[]
  clicks: number[]
  ctr: number[]
  cvr: number[]
}

export interface ClientBundle {
  client: Client
  goals: ClientGoals
  scenarios: Scenario[]
  activeScenarioId: string | null
  reports: Partial<Record<ReportKey, UploadedReport>>
  optimization: OptimizationTask[]
  actionDecisions?: Record<string, ActionDecision>  // Action Center approve/deny + notes
  changeLog?: ChangeLogEntry[]                       // Optimizer export history (newest first)
}
