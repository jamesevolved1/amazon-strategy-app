// Evolved §2.2 — Account Mode ⇄ Lifecycle Phase. James picks an Account Mode;
// we independently classify the phase from the account's own data and let it
// CHALLENGE the mode when the numbers contradict it. The mode sets the profit
// posture every other tool reads. Pure + deterministic.

import type { AccountMode, CampaignRow, ClientGoals } from '../types'

export interface ModeInfo {
  id: AccountMode
  label: string
  phase: string
  trigger: string       // default trigger (when this phase applies)
  goal: string
  posture: string       // profit posture
  optimizer: string     // how it should tune optimization
  tone: 'mint' | 'peri' | 'gold' | 'blush' | 'plum'
}

export const ACCOUNT_MODES: ModeInfo[] = [
  { id: 'launch', label: 'Launch', phase: 'Launch',
    trigger: '<~60 reviews, not yet ranking core terms',
    goal: 'Velocity + rank + data',
    posture: "Break-even is the win — don't pull profit early",
    optimizer: 'Tolerate lower ROAS on ranking terms; protect velocity over efficiency',
    tone: 'peri' },
  { id: 'grow', label: 'Grow & Scale', phase: 'Expand',
    trigger: 'Ranking, reinvesting; ~60–800 reviews',
    goal: 'Aggressive scale',
    posture: 'Light profit (single–low double digits)',
    optimizer: 'Scale proven winners hard; keep discovery funded',
    tone: 'mint' },
  { id: 'harvest', label: 'Harvest', phase: 'Harvest',
    trigger: 'Rank cemented, moat; ~800+ reviews',
    goal: 'Max profit + defend',
    posture: 'Pull profit; prune hard',
    optimizer: 'Tighten bids to target; cut waste aggressively; defend brand',
    tone: 'gold' },
  { id: 'recovery', label: 'Recovery', phase: 'Recovery (off-cycle)',
    trigger: 'Rank / CVR / Buy-Box slipped',
    goal: 'Stabilize the leak first',
    posture: "Don't scale a broken offer",
    optimizer: 'Hold spend; fix control + offer before scaling',
    tone: 'blush' },
  { id: 'liquidation', label: 'Liquidation', phase: 'Liquidation (off-cycle)',
    trigger: 'Sell-through needed',
    goal: 'Move units',
    posture: 'Price-led (deal-for-ranking)',
    optimizer: 'Spend to move units; efficiency secondary',
    tone: 'plum' },
]

export const modeInfo = (m: AccountMode): ModeInfo => ACCOUNT_MODES.find(x => x.id === m) ?? ACCOUNT_MODES[1]

export interface PhaseSignal {
  suggested: AccountMode
  confidence: 'low' | 'medium' | 'high'
  reasons: string[]
  metrics: { roas: number; cvr: number; tacos: number | null; adSales: number }
}

const sum = (a: CampaignRow[], f: (c: CampaignRow) => number) => a.reduce((s, c) => s + (f(c) || 0), 0)

// Classify the lifecycle phase from the account's own data. Liquidation is never
// auto-suggested — it's a deliberate off-cycle choice. We read three signals:
// offer health (ad CVR), efficiency (ROAS vs target), and maturity/scale.
export function classifyPhase(campaigns: CampaignRow[], goals: ClientGoals, totalSales: number | null): PhaseSignal {
  const spend = sum(campaigns, c => c.spend)
  const adSales = sum(campaigns, c => c.adSales)
  const orders = sum(campaigns, c => c.orders)
  const clicks = sum(campaigns, c => c.clicks)
  const roas = spend > 0 ? adSales / spend : 0
  const cvr = clicks > 0 ? (orders / clicks) * 100 : 0
  const tacos = totalSales && totalSales > 0 ? (spend / totalSales) * 100 : null
  const targetRoas = goals.targetRoas || 0
  const minRoas = goals.minimumAcceptableRoas || 0

  const reasons: string[] = []
  let suggested: AccountMode = 'grow'
  let confidence: PhaseSignal['confidence'] = 'low'

  // 1) Broken offer / control → Recovery (highest priority signal).
  if (cvr > 0 && cvr < 5) {
    suggested = 'recovery'
    confidence = 'medium'
    reasons.push(`ad CVR is ${cvr.toFixed(1)}% (under the 5% conversion flag) — the offer or control needs fixing before scaling`)
  } else if (minRoas > 0 && roas > 0 && roas < minRoas * 0.8) {
    suggested = 'recovery'
    confidence = 'medium'
    reasons.push(`blended ROAS ${roas.toFixed(2)}× is well below the ${minRoas.toFixed(2)}× floor — stabilize efficiency first`)
  // 2) Mature (real scale) + efficient → Harvest. Efficiency alone isn't enough;
  //    a tiny account that happens to be cheap is still early-stage, not a moat.
  } else if (targetRoas > 0 && roas >= targetRoas && adSales >= 3000 && clicks >= 500 && tacos != null && tacos <= (goals.primaryTacosGoal || 12)) {
    suggested = 'harvest'
    confidence = tacos <= (goals.primaryTacosGoal || 12) * 0.8 ? 'high' : 'medium'
    reasons.push(`ROAS ${roas.toFixed(2)}× beats target at a lean ${tacos.toFixed(1)}% TACoS — the account looks mature and efficient enough to pull profit`)
  // 3) Small scale / thin data → Launch.
  } else if (adSales < 2000 || clicks < 300) {
    suggested = 'launch'
    confidence = 'low'
    reasons.push(`low ad volume (${clicks.toFixed(0)} clicks, ${Math.round(adSales).toLocaleString()} in ad sales) reads like an early-stage account still gathering data`)
  // 4) Default → Grow & Scale.
  } else {
    suggested = 'grow'
    confidence = 'medium'
    reasons.push(`ROAS ${roas.toFixed(2)}× with meaningful volume reads like a reinvesting, scaling account`)
  }

  return { suggested, confidence, reasons, metrics: { roas, cvr, tacos, adSales } }
}

// If the chosen mode contradicts the data, produce a blunt challenge (§2.2 example).
export function challengeMode(selected: AccountMode | undefined, signal: PhaseSignal): string | null {
  if (!selected || selected === signal.suggested) return null
  // Liquidation is a deliberate choice — never challenge it from data.
  if (selected === 'liquidation') return null
  const sel = modeInfo(selected)
  const sug = modeInfo(signal.suggested)
  return `You selected ${sel.label}, but the data reads closer to ${sug.label} — ${signal.reasons[0]}. ${postureClash(selected, signal.suggested)}`
}

function postureClash(selected: AccountMode, suggested: AccountMode): string {
  if (suggested === 'recovery') return 'I would not scale until the offer/control is fixed.'
  if (selected === 'launch' && suggested === 'harvest') return 'You may be leaving profit on the table — consider pulling efficiency.'
  if (selected === 'harvest' && (suggested === 'launch' || suggested === 'grow')) return 'Pruning hard now could choke growth that still needs feeding.'
  return 'Confirm the mode against rank, reviews, and Buy-Box before committing the posture.'
}
