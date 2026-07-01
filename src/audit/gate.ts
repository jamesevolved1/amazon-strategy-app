// Stage 1 — Report Intake & Data Validation Gate (master prompt PART 1).
// Gatekeeper only: no strategy, bids, builds, negatives, or files.
// Pure function over AuditInputs; source-agnostic (uploads today, live sync later).

import type { DataQualityIssue } from '../utils/pnl'
import type { AuditInputs, AuditSlot } from './inputs'

export type GateDecision = 'ready' | 'ready-with-limits' | 'not-ready'

export interface GateRequirement {
  slot: AuditSlot
  label: string
  /** required = full deep dive blocked without it; scale = scale decisions blocked; optional = unlocks deeper analysis */
  tier: 'required' | 'scale' | 'optional'
  /** What analysis this report unlocks / blocks (mirrors PART 1 language). */
  unlocks: string
}

export const GATE_REQUIREMENTS: GateRequirement[] = [
  { slot: 'searchTerms',   label: 'SP Search Term Report',          tier: 'required', unlocks: 'Search-term mining, harvest/negate decisions' },
  { slot: 'targeting',     label: 'SP Targeting Report',            tier: 'required', unlocks: 'Bid rules per keyword/target' },
  { slot: 'campaigns',     label: 'SP Campaign performance',        tier: 'required', unlocks: 'Campaign analysis, budget rules' },
  { slot: 'placements',    label: 'SP Placement Report',            tier: 'required', unlocks: 'Placement multiplier recommendations' },
  { slot: 'skus',          label: 'Business/profit data by SKU',    tier: 'required', unlocks: 'Economics engine, margin-based targets, ASIN health' },
  { slot: 'bulkStructure', label: 'Bulk Operations Export',         tier: 'required', unlocks: 'Structure gap analysis, exact IDs for bulk-file export' },
  { slot: 'daily',         label: 'Daily series (Business Report)', tier: 'scale',    unlocks: 'Run-rate, goal reality check, anomaly spikes' },
  { slot: 'restock',       label: 'Restock Recommendations',        tier: 'scale',    unlocks: 'Scale decisions gated on inventory' },
]

export interface GateReceivedItem {
  slot: AuditSlot
  label: string
  tier: GateRequirement['tier']
  present: boolean
  rows?: number
  sourceLabel?: string
  fileName?: string
  uploadedAt?: string
}

export interface GateResult {
  decision: GateDecision
  received: GateReceivedItem[]
  missingRequired: string[]
  missingScale: string[]
  issues: DataQualityIssue[]
  /** Decisions the deep dive must NOT make given what's missing. */
  blockedDecisions: string[]
  /** The single minimum next upload to request (PART 1: request the minimum missing item only). */
  minimumNextUpload: string | null
}

export function evaluateGate(inputs: AuditInputs): GateResult {
  const issues: DataQualityIssue[] = []
  const received: GateReceivedItem[] = GATE_REQUIREMENTS.map(req => {
    const data = inputs[req.slot]
    const present = Array.isArray(data) ? data.length > 0 : data != null
    const src = inputs.sources[req.slot]
    return {
      slot: req.slot, label: req.label, tier: req.tier, present,
      rows: Array.isArray(data) ? data.length : undefined,
      sourceLabel: src?.label, fileName: src?.fileName, uploadedAt: src?.uploadedAt,
    }
  })

  const missingRequired = received.filter(r => r.tier === 'required' && !r.present).map(r => r.label)
  const missingScale = received.filter(r => r.tier === 'scale' && !r.present).map(r => r.label)

  // Carry parser warnings through as data-quality notes.
  for (const [slot, src] of Object.entries(inputs.sources)) {
    for (const w of src?.warnings ?? []) {
      issues.push({ level: 'warn', message: w, source: GATE_REQUIREMENTS.find(r => r.slot === slot)?.label ?? slot })
    }
  }

  // Cross-report consistency: search-term / targeting / placement campaigns
  // should exist in the bulk structure (same account + export vintage check).
  if (inputs.bulkStructure) {
    const known = new Set(inputs.bulkStructure.map(r => r.campaignName))
    const check = (rows: Array<{ campaignName: string }> | null, label: string) => {
      if (!rows || known.size === 0) return
      const missing = new Set(rows.filter(r => !known.has(r.campaignName)).map(r => r.campaignName))
      if (missing.size > 0) {
        const frac = missing.size / new Set(rows.map(r => r.campaignName)).size
        issues.push({
          level: frac > 0.5 ? 'critical' : 'warn',
          message: `${missing.size} campaign name(s) in the ${label} not found in the Bulk Operations export${frac > 0.5 ? ' — reports may be from different accounts or date ranges' : ''}.`,
          count: missing.size,
          source: label,
        })
      }
    }
    check(inputs.searchTerms, 'SP Search Term Report')
    check(inputs.targeting, 'SP Targeting Report')
    check(inputs.placements, 'SP Placement Report')
  }

  // Bulk structure usefulness checks.
  if (inputs.bulkStructure) {
    const hasKeywords = inputs.bulkStructure.some(r => r.entity === 'Keyword')
    if (!hasKeywords) {
      issues.push({ level: 'warn', message: 'Bulk export has no Keyword entity rows — harvest dedupe and bid export will be limited.', source: 'Bulk Operations Export' })
    }
  }

  // Blocked decisions (PART 1 gate output #5).
  const blockedDecisions: string[] = []
  if (!inputs.restock) blockedDecisions.push('No aggressive scale recommendations (Restock report missing).')
  if (!inputs.daily) blockedDecisions.push('No run-rate/goal-pacing math (daily series missing).')
  if (!inputs.searchTerms) blockedDecisions.push('No harvest or negative recommendations (Search Term report missing).')
  if (!inputs.placements) blockedDecisions.push('No placement multiplier changes (Placement report missing).')
  if (!inputs.skus) blockedDecisions.push('No margin-based target ACoS/bid math (profit data missing).')
  blockedDecisions.push('No dayparting recommendation. Hourly data is not clear enough.') // hourly parser deferred by plan

  const hasCritical = issues.some(i => i.level === 'critical')
  const decision: GateDecision =
    missingRequired.length > 0 || hasCritical ? 'not-ready'
    : missingScale.length > 0 || issues.some(i => i.level === 'warn') ? 'ready-with-limits'
    : 'ready'

  // Minimum next upload: first missing required, else first missing scale.
  const minimumNextUpload = missingRequired[0] ?? missingScale[0] ?? null

  return { decision, received, missingRequired, missingScale, issues, blockedDecisions, minimumNextUpload }
}
