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

export interface OptSettings {
  targetRoas: number         // primary lever
  minCpc: number             // floor for any bid
  maxCpc: number             // hard ceiling for any bid
  brandTerms: string[]       // lowercase substrings; protected from cuts/negation
  minClicksToAct: number     // need this many clicks before changing a bid
  minClicksToNegate: number  // zero-sale spend needs this many clicks to negate
  nudgeFloor: number         // skip bid changes smaller than this ($)
  safetyCapPct: number       // max single-pass move as a fraction of current bid (e.g. 0.5 = ±50%)
}

export function defaultSettings(targetRoas: number): OptSettings {
  return {
    targetRoas: targetRoas > 0 ? targetRoas : 4,
    minCpc: 0.15,
    maxCpc: 5.0,
    brandTerms: [],
    minClicksToAct: 5,
    minClicksToNegate: 10,
    nudgeFloor: 0.03,
    safetyCapPct: 0.5,
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

    // Zero-sale spend → negate (never auto-negate a brand term).
    if (sales <= 0 && clicks >= s.minClicksToNegate) {
      if (isBrand) continue
      changes.push(mk(e, 'negate', bid, null, 0, roas, rpc, isBrand,
        `${money(cost)} over ${clicks} clicks, no sales`))
      considered++
      continue
    }

    if (clicks < s.minClicksToAct) continue
    considered++

    // RPC target, clamped to CPC guardrails, then to the single-pass safety cap.
    const target = clamp(rpc, s.minCpc, s.maxCpc)
    const capUp = bid * (1 + s.safetyCapPct)
    const capDown = bid * (1 - s.safetyCapPct)
    let newBid = round2(clamp(target, capDown, capUp))

    // Brand protection: never lower a brand term below its current bid.
    if (isBrand && newBid < bid) continue

    const delta = newBid - bid
    if (Math.abs(delta) < s.nudgeFloor) continue   // hold — change too small to bother

    const deltaPct = bid > 0 ? delta / bid : 0
    const action: BidAction = delta > 0 ? 'raise' : 'lower'
    const reason = action === 'raise'
      ? `ROAS ${roas.toFixed(1)}× — underbid vs RPC target ${money(rpc)}`
      : `ROAS ${roas.toFixed(1)}× — overbid vs RPC target ${money(rpc)}`
    changes.push(mk(e, action, bid, newBid, deltaPct, roas, rpc, isBrand, reason))
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
