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
  orders: number
  impressions: number
  clicks: number
  totalSales?: number
  organicSales?: number
  cvr?: number      // %
  ctr?: number      // %
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
  templateKey?: string  // links back to a Sophie Society playbook template
  clientId: string
  createdAt: string
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
}
