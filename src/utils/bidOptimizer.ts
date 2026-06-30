// Bid optimizer engine. ROAS-based (never ACOS): RPC bid = (Revenue / Clicks) /
// Target ROAS. Given each targetable entity (keyword or product/auto target)
// with its CURRENT bid + recent performance, it proposes a new bid or a
// negation, with guardrails. Pure + deterministic — the UI reviews its output
// and exports the Amazon bulk sheet + a reverse file + change log.

export type EntityKind = 'keyword' | 'target'
export type BidAction = 'raise' | 'lower' | 'negate' | 'hold'

// One targetable row joined from the keyword/target list (bid) + the
// spTargeting performance report (clicks/cost/sales).
export interface OptEntity {
  id: string                 // keywordId or targetId
  kind: EntityKind
  text: string               // keyword text or target expression
  matchType?: string         // EXACT / PHRASE / BROAD (keywords)
  state: string
  campaignId: string
  campaignName?: string
  adGroupId: string
  currentBid: number
  clicks: number
  cost: number
  sales: number              // attributed sales (14d)
  orders: number
}

// Mirrors the Evolved PART 2.8 config block (James overrides any of these).
export interface OptSettings {
  targetRoas: number         // primary lever; target ACoS = 1 ÷ target ROAS
  minCpc: number             // bid_floor
  maxCpc: number             // bid_ceiling
  minSpend: number           // min_spend_for_action ($)
  brandTerms: string[]       // lowercase substrings; never cut/negate brand terms
  minClicksToAct: number     // min_clicks_for_action (never act on <10-click data)
  minClicksToNegate: number  // zero-sale spend needs more than this many clicks to negate
  nudgeFloor: number         // skip bid changes smaller than this ($)
  safetyCapPct: number       // bid_increment — controlled step toward the RPC target (0.15 = ±15%)
  roasLowTrigger: number     // lower the bid if observed ROAS < this (1.2)
  roasHighTrigger: number    // raise the bid if observed ROAS > this (1.9)
}

export function defaultSettings(targetRoas: number): OptSettings {
  return {
    targetRoas: targetRoas > 0 ? targetRoas : 4,
    minCpc: 0.20,
    maxCpc: 5.0,
    minSpend: 10,
    brandTerms: [],
    minClicksToAct: 10,
    minClicksToNegate: 10,
    nudgeFloor: 0.03,
    safetyCapPct: 0.15,
    roasLowTrigger: 1.2,
    roasHighTrigger: 1.9,
  }
}

export interface BidChange {
  id: string
  kind: EntityKind
  text: string
  matchType?: string
  campaignName?: string
  campaignId: string
  adGroupId: string
  action: BidAction
  currentBid: number
  newBid: number | null      // null for negate / hold
  deltaPct: number           // (newBid-current)/current, 0 for negate/hold
  clicks: number
  cost: number
  sales: number
  roas: number               // observed (sales/cost)
  rpcBid: number             // uncapped RPC target
  isBrand: boolean
  reason: string
}

export interface OptResult {
  changes: BidChange[]       // actionable only (raise/lower/negate), sorted by spend
  raises: number
  lowers: number
  negations: number
  considered: number         // entities with enough data to evaluate
  negateSpend: number        // $ on the negation candidates
}

const round2 = (n: number) => Math.round(n * 100) / 100
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function optimizeBids(entities: OptEntity[], settings: OptSettings): OptResult {
  const s = settings
  const changes: BidChange[] = []
  let considered = 0

  for (const e of entities) {
    if (e.state !== 'enabled' && e.state !== 'ENABLED') continue
    const bid = e.currentBid
    if (!Number.isFinite(bid) || bid <= 0) continue
    const clicks = e.clicks || 0
    const cost = e.cost || 0
    const sales = e.sales || 0
    const roas = cost > 0 ? sales / cost : 0
    const rpc = clicks > 0 ? (sales / clicks) / s.targetRoas : 0
    const isBrand = s.brandTerms.length > 0 && s.brandTerms.some(t => e.text.toLowerCase().includes(t))

    // Negate zero-sale spend (Evolved 2.8: spend > min, clicks > threshold, 0 orders).
    // Never auto-negate a brand term — brand stays defended.
    if (sales <= 0 && clicks > s.minClicksToNegate && cost > s.minSpend) {
      if (isBrand) continue
      changes.push(mk(e, 'negate', bid, null, 0, roas, rpc, isBrand,
        `${money(cost)} over ${clicks} clicks, no sales — pause`))
      considered++
      continue
    }

    // Need enough data + spend to touch a bid (never act on <10-click data).
    if (clicks < s.minClicksToAct || cost < s.minSpend) continue
    considered++

    // ROAS deadband — hold inside [low, high]; only move clear winners/losers (2.8).
    if (roas >= s.roasLowTrigger && roas <= s.roasHighTrigger) continue

    // Step ±safetyCap (the controlled increment) toward the RPC destination, then
    // clamp to the CPC floor/ceiling. target_bid is the destination; ±15% is the step.
    const target = clamp(rpc, s.minCpc, s.maxCpc)
    let newBid = roas < s.roasLowTrigger
      ? Math.max(target, bid * (1 - s.safetyCapPct))   // losing → step down toward target
      : Math.min(target, bid * (1 + s.safetyCapPct))   // winning → step up toward target
    newBid = round2(clamp(newBid, s.minCpc, s.maxCpc))

    // Brand protection: never lower a brand term below its current bid.
    if (isBrand && newBid < bid) continue

    const delta = newBid - bid
    if (Math.abs(delta) < s.nudgeFloor) continue   // hold — change too small to bother

    const step = Math.round(s.safetyCapPct * 100)
    const action: BidAction = delta > 0 ? 'raise' : 'lower'
    const reason = action === 'raise'
      ? `ROAS ${roas.toFixed(1)}× > ${s.roasHighTrigger}× — +${step}% toward RPC ${money(rpc)}`
      : `ROAS ${roas.toFixed(1)}× < ${s.roasLowTrigger}× — −${step}% toward RPC ${money(rpc)}`
    changes.push(mk(e, action, bid, newBid, bid > 0 ? delta / bid : 0, roas, rpc, isBrand, reason))
  }

  changes.sort((a, b) => b.cost - a.cost)
  return {
    changes,
    raises: changes.filter(c => c.action === 'raise').length,
    lowers: changes.filter(c => c.action === 'lower').length,
    negations: changes.filter(c => c.action === 'negate').length,
    considered,
    negateSpend: round2(changes.filter(c => c.action === 'negate').reduce((t, c) => t + c.cost, 0)),
  }
}

function mk(e: OptEntity, action: BidAction, currentBid: number, newBid: number | null, deltaPct: number, roas: number, rpc: number, isBrand: boolean, reason: string): BidChange {
  return {
    id: e.id, kind: e.kind, text: e.text, matchType: e.matchType,
    campaignName: e.campaignName, campaignId: e.campaignId, adGroupId: e.adGroupId,
    action, currentBid, newBid, deltaPct,
    clicks: e.clicks || 0, cost: e.cost || 0, sales: e.sales || 0,
    roas: round2(roas), rpcBid: round2(rpc), isBrand, reason,
  }
}

function money(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n || 0)
}
