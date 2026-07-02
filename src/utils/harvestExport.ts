// Bulk-operations export for search-term mining. One workbook, two sheets:
//   "Sponsored Products Campaigns" — Negative Keyword / Negative Product
//     Targeting create rows (the negation seeds) + Keyword / Product Targeting
//     create rows for harvested terms that have an exact home with IDs.
//   "Needs new campaign" — harvested terms with no exact home; feed these to
//     the Campaign Builder.
// Rows without campaign/ad-group IDs can't be uploaded — they land on the
// second sheet with names so nothing is silently dropped.

import * as XLSX from 'xlsx'
import type { HarvestCandidate, NegateCandidate } from './harvest'

const round2 = (n: number) => Math.round((n || 0) * 100) / 100

type Row = Record<string, string | number>

const BULK_COLS = [
  'Product', 'Entity', 'Operation', 'Campaign ID', 'Ad Group ID', 'Keyword ID',
  'Product Targeting ID', 'Campaign Name', 'Ad Group Name', 'Keyword Text',
  'Match Type', 'Product Targeting Expression', 'State', 'Bid',
] as const

function base(): Row {
  const r: Row = {}
  for (const c of BULK_COLS) r[c] = ''
  r['Product'] = 'Sponsored Products'
  r['Operation'] = 'Create'
  r['State'] = 'enabled'
  return r
}

function negativeRow(n: NegateCandidate): Row {
  const r = base()
  r['Entity'] = n.isAsin ? 'Negative Product Targeting' : 'Negative Keyword'
  r['Campaign ID'] = n.campaignId ?? ''
  r['Ad Group ID'] = n.adGroupId ?? ''
  r['Campaign Name'] = n.campaignName
  r['Ad Group Name'] = n.adGroupName
  if (n.isAsin) r['Product Targeting Expression'] = `asin="${n.term.toUpperCase()}"`
  else { r['Keyword Text'] = n.term; r['Match Type'] = 'negativeExact' }
  return r
}

function harvestRow(h: HarvestCandidate, bid: number): Row {
  const r = base()
  r['Entity'] = h.isAsin ? 'Product Targeting' : 'Keyword'
  r['Campaign ID'] = h.home?.campaignId ?? ''
  r['Ad Group ID'] = h.home?.adGroupId ?? ''
  r['Campaign Name'] = h.home?.campaignName ?? ''
  r['Ad Group Name'] = h.home?.adGroupName ?? ''
  if (h.isAsin) r['Product Targeting Expression'] = `asin="${h.term.toUpperCase()}"`
  else { r['Keyword Text'] = h.term; r['Match Type'] = 'exact' }
  r['Bid'] = round2(bid)
  return r
}

/** Seed negatives: negative-exact the harvested term in every discovery source
 *  so the new exact takes the traffic cleanly. */
function seedNegatives(h: HarvestCandidate): Row[] {
  return h.sources
    .filter(s => s.campaignId)     // uploadable only — sources without IDs are skipped
    .map(s => {
      const r = base()
      r['Entity'] = h.isAsin ? 'Negative Product Targeting' : 'Negative Keyword'
      r['Campaign ID'] = s.campaignId!
      r['Ad Group ID'] = s.adGroupId ?? ''
      r['Campaign Name'] = s.campaignName
      r['Ad Group Name'] = s.adGroupName
      if (h.isAsin) r['Product Targeting Expression'] = `asin="${h.term.toUpperCase()}"`
      else { r['Keyword Text'] = h.term; r['Match Type'] = 'negativeExact' }
      return r
    })
}

export interface HarvestExportInput {
  harvests: Array<{ candidate: HarvestCandidate; bid: number }>
  negatives: NegateCandidate[]
}

export interface HarvestExportSummary {
  uploadRows: number
  needsCampaign: number
}

export function downloadHarvestSheet(input: HarvestExportInput, filename: string): HarvestExportSummary {
  const upload: Row[] = []
  const needsCampaign: Row[] = []

  for (const n of input.negatives) {
    if (n.campaignId) upload.push(negativeRow(n))
    else needsCampaign.push({ 'Type': 'negative (no IDs)', 'Term': n.term, 'Campaign': n.campaignName, 'Ad Group': n.adGroupName, 'Spend': round2(n.spend), 'Clicks': n.clicks, 'Suggested bid': '' })
  }

  for (const { candidate: h, bid } of input.harvests) {
    if (h.home?.campaignId) {
      upload.push(harvestRow(h, bid))
      upload.push(...seedNegatives(h))
    } else {
      needsCampaign.push({
        'Type': h.isAsin ? 'harvest ASIN' : 'harvest keyword',
        'Term': h.term,
        'Campaign': h.sources[0]?.campaignName ?? '',
        'Ad Group': h.sources[0]?.adGroupName ?? '',
        'Spend': round2(h.spend), 'Clicks': h.clicks,
        'Orders': h.orders, 'Sales': round2(h.sales),
        'Suggested bid': round2(bid),
      })
    }
  }

  const wb = XLSX.utils.book_new()
  if (upload.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(upload, { header: [...BULK_COLS] }), 'Sponsored Products Campaigns')
  }
  if (needsCampaign.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(needsCampaign), 'Needs new campaign')
  }
  if (upload.length || needsCampaign.length) XLSX.writeFile(wb, filename)
  return { uploadRows: upload.length, needsCampaign: needsCampaign.length }
}
