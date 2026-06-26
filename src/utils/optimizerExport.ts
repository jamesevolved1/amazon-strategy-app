// Build the Amazon Sponsored Products bulk-operations sheets from approved bid
// changes — an apply sheet (push to Amazon) and a reverse sheet (one upload to
// roll everything back). Same row shape, opposite values.

import * as XLSX from 'xlsx'
import type { BidChange } from './bidOptimizer'

const round2 = (n: number) => Math.round((n || 0) * 100) / 100

// One SP bulk row for a keyword update (bid change) or pause (negation).
function bulkRow(c: BidChange, mode: 'apply' | 'reverse'): Record<string, string | number> {
  const isNeg = c.action === 'negate'
  let bid: number
  let state: string
  if (mode === 'apply') {
    state = isNeg ? 'paused' : 'enabled'
    bid = isNeg ? c.currentBid : (c.newBid ?? c.currentBid)
  } else {
    state = 'enabled'          // reverse: re-enable + restore the prior bid
    bid = c.currentBid
  }
  return {
    'Product': 'Sponsored Products',
    'Entity': 'Keyword',
    'Operation': 'Update',
    'Campaign ID': c.campaignId,
    'Ad Group ID': c.adGroupId,
    'Keyword ID': c.id,
    'Keyword Text': c.text,
    'Match Type': c.matchType ?? '',
    'State': state,
    'Bid': round2(bid),
  }
}

function writeSheet(rows: Record<string, unknown>[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sponsored Products Campaigns')
  XLSX.writeFile(wb, filename)
}

export function downloadBulkSheet(changes: BidChange[], filename: string) {
  writeSheet(changes.map(c => bulkRow(c, 'apply')), filename)
}

export function downloadReverseSheet(changes: BidChange[], filename: string) {
  writeSheet(changes.map(c => bulkRow(c, 'reverse')), filename)
}
