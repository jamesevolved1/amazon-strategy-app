// Campaign builder — Evolved PART 3 archetypes + naming framework. Generates
// upload-ready Sponsored Products bulk CREATE rows (Campaign → Ad Group →
// Product Ads → Keywords / Product Targets). New entities use the name-as-ID
// convention Amazon's bulk sheets expect for creates: the ID columns carry the
// new entity's name so rows link together.

import * as XLSX from 'xlsx'

export type ArchetypeId = 'auto_research' | 'broad_research' | 'exact_performance' | 'brand_defense' | 'ranking_skw' | 'pt_competitor'

export interface Archetype {
  id: ArchetypeId
  label: string
  category: 'Research' | 'Performance' | 'Shielding' | 'Ranking'
  namePart: string          // the {Type} slug in the naming framework
  targetingType: 'AUTO' | 'MANUAL'
  matchType?: 'exact' | 'broad' | 'phrase'
  isProductTargeting?: boolean
  keywordsRequired: boolean
  description: string
}

export const ARCHETYPES: Archetype[] = [
  { id: 'auto_research', label: 'Auto — Research', category: 'Research', namePart: 'Auto', targetingType: 'AUTO', keywordsRequired: false,
    description: 'Amazon-driven discovery. Feeds the harvest loop; no keywords needed.' },
  { id: 'broad_research', label: 'Broad — Research', category: 'Research', namePart: 'Broad', targetingType: 'MANUAL', matchType: 'broad', keywordsRequired: true,
    description: 'Keyword-steered discovery on your seed terms.' },
  { id: 'exact_performance', label: 'Exact — Performance', category: 'Performance', namePart: 'Exact', targetingType: 'MANUAL', matchType: 'exact', keywordsRequired: true,
    description: 'Proven winners at controlled bids — the harvest destination.' },
  { id: 'brand_defense', label: 'Brand Defense — Shielding', category: 'Shielding', namePart: 'Brand', targetingType: 'MANUAL', matchType: 'exact', keywordsRequired: true,
    description: 'Own your brand terms so competitors can\'t buy your traffic.' },
  { id: 'ranking_skw', label: 'Single Keyword — Ranking', category: 'Ranking', namePart: 'SKW', targetingType: 'MANUAL', matchType: 'exact', keywordsRequired: true,
    description: 'One campaign per priority term to push organic rank. One keyword each.' },
  { id: 'pt_competitor', label: 'Product Targeting — Performance', category: 'Performance', namePart: 'PT', targetingType: 'MANUAL', isProductTargeting: true, keywordsRequired: true,
    description: 'Target competitor/complementary ASINs (paste ASINs as the "keywords").' },
]

export interface BuildKeyword {
  text: string              // keyword text, or an ASIN for PT archetypes
  bid: number
}

export interface BuildSpec {
  archetype: ArchetypeId
  brandPrefix: string       // {Brand} — e.g. "RLC"
  detail: string            // {Detail} — e.g. "Sheets"
  skus: string[]
  dailyBudget: number
  defaultBid: number
  keywords: BuildKeyword[]  // empty for auto_research
}

/** Evolved naming framework: {Brand} | {Category} | {Type} | {Detail} */
export function campaignName(spec: BuildSpec): string {
  const a = ARCHETYPES.find(x => x.id === spec.archetype)!
  return [spec.brandPrefix.trim(), a.category, a.namePart, spec.detail.trim()]
    .filter(Boolean).join(' | ')
}

type Row = Record<string, string | number>

const COLS = [
  'Product', 'Entity', 'Operation', 'Campaign ID', 'Ad Group ID',
  'Campaign Name', 'Ad Group Name', 'Start Date', 'Targeting Type', 'State',
  'Daily Budget', 'Bidding Strategy', 'Ad Group Default Bid', 'SKU',
  'Keyword Text', 'Match Type', 'Product Targeting Expression', 'Bid',
] as const

function base(campaign: string): Row {
  const r: Row = {}
  for (const c of COLS) r[c] = ''
  r['Product'] = 'Sponsored Products'
  r['Operation'] = 'Create'
  r['State'] = 'enabled'
  r['Campaign ID'] = campaign     // name-as-ID for new entities
  r['Campaign Name'] = campaign
  return r
}

const round2 = (n: number) => Math.round((n || 0) * 100) / 100
const ASIN_RE = /^b0[a-z0-9]{8}$/i

export interface BuildResult {
  rows: Row[]
  campaigns: string[]
  warnings: string[]
}

/** One spec → bulk rows. ranking_skw fans out to one campaign per keyword. */
export function buildCampaignRows(spec: BuildSpec, startDate: string): BuildResult {
  const a = ARCHETYPES.find(x => x.id === spec.archetype)!
  const warnings: string[] = []
  if (spec.skus.length === 0) warnings.push('No SKUs — Amazon needs at least one Product Ad per ad group.')
  if (a.keywordsRequired && spec.keywords.length === 0) warnings.push(`${a.label} needs at least one ${a.isProductTargeting ? 'ASIN' : 'keyword'}.`)

  const specs: Array<{ name: string; keywords: BuildKeyword[] }> =
    spec.archetype === 'ranking_skw'
      ? spec.keywords.map(k => ({ name: `${campaignName(spec)} | ${k.text}`.slice(0, 128), keywords: [k] }))
      : [{ name: campaignName(spec), keywords: spec.keywords }]

  const rows: Row[] = []
  const campaigns: string[] = []

  for (const s of specs) {
    campaigns.push(s.name)
    const adGroup = a.isProductTargeting ? 'PT' : a.matchType ? cap(a.matchType) : 'Auto'

    const c = base(s.name)
    c['Entity'] = 'Campaign'
    c['Start Date'] = startDate
    c['Targeting Type'] = a.targetingType
    c['Daily Budget'] = round2(spec.dailyBudget)
    c['Bidding Strategy'] = 'Dynamic bids - down only'
    rows.push(c)

    const g = base(s.name)
    g['Entity'] = 'Ad Group'
    g['Ad Group ID'] = adGroup
    g['Ad Group Name'] = adGroup
    g['Ad Group Default Bid'] = round2(spec.defaultBid)
    rows.push(g)

    for (const sku of spec.skus) {
      const p = base(s.name)
      p['Entity'] = 'Product Ad'
      p['Ad Group ID'] = adGroup
      p['Ad Group Name'] = adGroup
      p['SKU'] = sku
      rows.push(p)
    }

    for (const kw of s.keywords) {
      const r = base(s.name)
      r['Ad Group ID'] = adGroup
      r['Ad Group Name'] = adGroup
      r['Bid'] = round2(kw.bid > 0 ? kw.bid : spec.defaultBid)
      if (a.isProductTargeting) {
        if (!ASIN_RE.test(kw.text.trim())) { warnings.push(`"${kw.text}" doesn't look like an ASIN — skipped.`); continue }
        r['Entity'] = 'Product Targeting'
        r['Product Targeting Expression'] = `asin="${kw.text.trim().toUpperCase()}"`
      } else {
        r['Entity'] = 'Keyword'
        r['Keyword Text'] = kw.text.trim()
        r['Match Type'] = a.matchType!
      }
      rows.push(r)
    }
  }

  return { rows, campaigns, warnings }
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1) }

export function downloadBuildSheet(results: BuildResult[], filename: string) {
  const rows = results.flatMap(r => r.rows)
  if (!rows.length) return
  const ws = XLSX.utils.json_to_sheet(rows, { header: [...COLS] })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sponsored Products Campaigns')
  XLSX.writeFile(wb, filename)
}
