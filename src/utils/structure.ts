// Structure gap analysis — Evolved PART 3. Classifies every campaign in the
// bulk structure into the four canonical categories (Performance / Shielding /
// Research / Ranking), grades the category mix against the account's spend,
// and produces build / rebuild / retire cards. Pure + deterministic.

import type { BulkEntityRow, CampaignRow, ClientGoals } from '../types'

export type StructureCategory = 'performance' | 'shielding' | 'research' | 'ranking' | 'unknown'

export const CATEGORY_INFO: Record<StructureCategory, { label: string; role: string }> = {
  performance: { label: 'Performance', role: 'Proven winners — exact keywords & product targets carrying efficient sales' },
  shielding:   { label: 'Brand Shielding', role: 'Defend your brand terms & product pages from competitors' },
  research:    { label: 'Research', role: 'Discovery — auto + broad/phrase feeding the harvest loop' },
  ranking:     { label: 'Ranking', role: 'Single-keyword campaigns pushing organic rank on core terms' },
  unknown:     { label: 'Unclassified', role: 'Structure unclear — review naming & composition' },
}

export interface CampaignProfile {
  campaignName: string
  campaignId: string
  category: StructureCategory
  targetingType: string          // AUTO | MANUAL
  adGroups: number
  keywords: number
  exactKeywords: number
  broadPhraseKeywords: number
  productTargets: number
  brandKeywords: number
  skus: string[]
  maxKeywordsPerAdGroup: number
  mixedMatchAdGroups: number     // ad groups mixing exact with broad/phrase
  // Joined performance (when campaign perf data is present):
  spend: number
  adSales: number
  roas: number
  hasPerf: boolean
}

export type CardKind = 'build' | 'rebuild' | 'retire'

export interface StructureCard {
  kind: CardKind
  title: string
  detail: string
  campaignName?: string
  category: StructureCategory
  impact: number        // $ at stake, for sorting
}

export interface CategorySummary {
  category: StructureCategory
  campaigns: number
  spend: number
  adSales: number
  roas: number
  spendShare: number    // % of classified spend
}

export interface StructureReport {
  profiles: CampaignProfile[]
  categories: CategorySummary[]
  cards: StructureCard[]
  totalSpend: number
  classifiedCampaigns: number
}

const norm = (s: string) => (s || '').trim().toLowerCase()
const round2 = (n: number) => Math.round(n * 100) / 100

/** Build per-campaign composition profiles from the bulk structure. */
export function profileCampaigns(
  rows: BulkEntityRow[],
  perf: CampaignRow[] | null,
  brandTerms: string[],
): CampaignProfile[] {
  const brands = brandTerms.map(norm).filter(Boolean)
  const perfByName = new Map<string, CampaignRow>()
  for (const c of perf ?? []) perfByName.set(norm(c.campaign), c)

  interface Acc {
    campaignName: string; campaignId: string; targetingType: string
    adGroups: Set<string>; skus: Set<string>
    kwByAdGroup: Map<string, { exact: number; other: number }>
    exact: number; broadPhrase: number; pt: number; brandKw: number
  }
  const acc = new Map<string, Acc>()
  const get = (r: BulkEntityRow): Acc => {
    const k = norm(r.campaignName)
    if (!acc.has(k)) {
      acc.set(k, {
        campaignName: r.campaignName, campaignId: r.campaignId, targetingType: '',
        adGroups: new Set(), skus: new Set(), kwByAdGroup: new Map(),
        exact: 0, broadPhrase: 0, pt: 0, brandKw: 0,
      })
    }
    return acc.get(k)!
  }

  for (const r of rows) {
    if (!r.campaignName) continue
    // Skip archived rows — they don't describe the live structure.
    if (norm(r.state ?? '') === 'archived') continue
    const a = get(r)
    if (r.entity === 'Campaign') {
      a.targetingType = (r.targetingType ?? a.targetingType) || ''
      if (r.campaignId) a.campaignId = r.campaignId
    }
    if (r.adGroupName) a.adGroups.add(norm(r.adGroupName))
    if (r.entity === 'Product Ad' && (r.sku || r.asin)) a.skus.add(r.sku || r.asin!)
    if (r.entity === 'Keyword' && r.keywordText) {
      const mt = norm(r.matchType ?? '')
      const ag = norm(r.adGroupName ?? '')
      const slot = a.kwByAdGroup.get(ag) ?? { exact: 0, other: 0 }
      if (mt === 'exact') { a.exact++; slot.exact++ } else { a.broadPhrase++; slot.other++ }
      a.kwByAdGroup.set(ag, slot)
      if (brands.length && brands.some(b => norm(r.keywordText!).includes(b))) a.brandKw++
    }
    if (r.entity === 'Product Targeting') a.pt++
  }

  return [...acc.values()].map(a => {
    const keywords = a.exact + a.broadPhrase
    const p = perfByName.get(norm(a.campaignName))
    const spend = p?.spend ?? 0
    const adSales = p?.adSales ?? 0
    let maxKw = 0, mixed = 0
    for (const slot of a.kwByAdGroup.values()) {
      maxKw = Math.max(maxKw, slot.exact + slot.other)
      if (slot.exact > 0 && slot.other > 0) mixed++
    }
    return {
      campaignName: a.campaignName, campaignId: a.campaignId,
      category: classify(a, keywords),
      targetingType: a.targetingType || (keywords + a.pt > 0 ? 'MANUAL' : ''),
      adGroups: a.adGroups.size, keywords,
      exactKeywords: a.exact, broadPhraseKeywords: a.broadPhrase,
      productTargets: a.pt, brandKeywords: a.brandKw,
      skus: [...a.skus],
      maxKeywordsPerAdGroup: maxKw, mixedMatchAdGroups: mixed,
      spend, adSales, roas: spend > 0 ? adSales / spend : 0, hasPerf: !!p,
    }
  }).sort((x, y) => y.spend - x.spend)
}

function classify(a: { targetingType: string; exact: number; broadPhrase: number; pt: number; brandKw: number }, keywords: number): StructureCategory {
  if (norm(a.targetingType) === 'auto') return 'research'
  // Majority-brand keyword campaigns defend the brand.
  if (keywords > 0 && a.brandKw / keywords > 0.5) return 'shielding'
  // Tiny all-exact campaigns are rank pushers.
  if (a.exact > 0 && a.broadPhrase === 0 && a.exact <= 3 && a.pt === 0) return 'ranking'
  // Exact/PT-led → performance; broad/phrase-led → research.
  if (a.exact + a.pt > 0 && a.exact + a.pt >= a.broadPhrase) return 'performance'
  if (a.broadPhrase > 0) return 'research'
  if (a.pt > 0) return 'performance'
  return 'unknown'
}

export function buildStructureReport(
  rows: BulkEntityRow[],
  perf: CampaignRow[] | null,
  goals: ClientGoals,
  brandTerms: string[],
): StructureReport {
  const profiles = profileCampaigns(rows, perf, brandTerms)
  const totalSpend = profiles.reduce((t, p) => t + p.spend, 0)
  const minRoas = goals.minimumAcceptableRoas || 0
  const targetRoas = goals.targetRoas || 0

  // ---- Category rollup ----
  const cats = new Map<StructureCategory, CategorySummary>()
  for (const c of ['performance', 'shielding', 'research', 'ranking', 'unknown'] as StructureCategory[]) {
    cats.set(c, { category: c, campaigns: 0, spend: 0, adSales: 0, roas: 0, spendShare: 0 })
  }
  for (const p of profiles) {
    const c = cats.get(p.category)!
    c.campaigns++; c.spend += p.spend; c.adSales += p.adSales
  }
  for (const c of cats.values()) {
    c.roas = c.spend > 0 ? c.adSales / c.spend : 0
    c.spendShare = totalSpend > 0 ? (c.spend / totalSpend) * 100 : 0
    c.spend = round2(c.spend); c.adSales = round2(c.adSales)
  }
  const categories = [...cats.values()].filter(c => c.category !== 'unknown' || c.campaigns > 0)

  // ---- Gap cards ----
  const cards: StructureCard[] = []

  // BUILD: canonical categories with no live campaigns.
  const missing: Array<[StructureCategory, string]> = [
    ['research', 'No discovery running — nothing feeds the harvest loop. Launch an Auto (or Broad) research campaign per core product.'],
    ['performance', 'No exact/PT performance home — harvested winners have nowhere efficient to land. Build an exact campaign per core product.'],
    ['shielding', brandTerms.length ? 'Brand terms are undefended — competitors can buy your traffic. Launch a brand-defense exact campaign.' : 'Set brand terms (Optimizer / Harvest settings) and launch a brand-defense campaign so competitors can\'t buy your traffic.'],
    ['ranking', 'No single-keyword ranking pushes. Optional until core terms need an organic-rank push — build one exact SKW per priority term.'],
  ]
  for (const [cat, detail] of missing) {
    if ((cats.get(cat)?.campaigns ?? 0) === 0) {
      cards.push({ kind: 'build', category: cat, title: `Build: ${CATEGORY_INFO[cat].label}`, detail, impact: cat === 'ranking' ? 0 : totalSpend * 0.1 })
    }
  }

  // Category balance: research shouldn't dominate a maturing account.
  const research = cats.get('research')!
  const performance = cats.get('performance')!
  if (totalSpend > 0 && research.spendShare > 50 && performance.campaigns > 0) {
    cards.push({
      kind: 'rebuild', category: 'research',
      title: 'Discovery is eating the budget',
      detail: `Research holds ${research.spendShare.toFixed(0)}% of spend at ${research.roas.toFixed(2)}× vs Performance at ${performance.roas.toFixed(2)}×. Harvest winners to exact and shift budget toward Performance.`,
      impact: research.spend,
    })
  }

  // REBUILD / RETIRE per campaign.
  for (const p of profiles) {
    const issues: string[] = []
    if (p.mixedMatchAdGroups > 0) issues.push(`${p.mixedMatchAdGroups} ad group${p.mixedMatchAdGroups === 1 ? '' : 's'} mix exact with broad/phrase — bids can't be controlled per intent`)
    if (p.maxKeywordsPerAdGroup > 20) issues.push(`${p.maxKeywordsPerAdGroup} keywords in one ad group — too wide to bid precisely`)
    if (issues.length && (p.spend > 50 || !p.hasPerf)) {
      cards.push({
        kind: 'rebuild', category: p.category, campaignName: p.campaignName,
        title: `Rebuild: ${p.campaignName}`,
        detail: `${issues.join('; ')}. Split into tight single-intent ad groups (keep history running until the rebuild earns its data).`,
        impact: p.spend,
      })
    }
    // RETIRE: meaningful spend, well under the floor, and not brand defense.
    if (p.hasPerf && minRoas > 0 && p.spend >= 100 && p.roas < minRoas * 0.6 && p.category !== 'shielding') {
      cards.push({
        kind: 'retire', category: p.category, campaignName: p.campaignName,
        title: `Retire: ${p.campaignName}`,
        detail: `${p.roas.toFixed(2)}× ROAS on $${Math.round(p.spend)} spend — far below the ${minRoas.toFixed(1)}× floor${targetRoas ? ` (target ${targetRoas.toFixed(1)}×)` : ''}. Harvest anything converting, then pause the campaign.`,
        impact: p.spend,
      })
    }
  }

  const KIND_ORDER: Record<CardKind, number> = { retire: 0, rebuild: 1, build: 2 }
  cards.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.impact - a.impact)

  return {
    profiles, categories, cards,
    totalSpend: round2(totalSpend),
    classifiedCampaigns: profiles.length,
  }
}
