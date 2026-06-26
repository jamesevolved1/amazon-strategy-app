// Decision engine. Turns current campaign performance + the client's goals into
// a prioritized list of "this week's moves" — in the agency's ROAS-based
// playbook language (never ACOS): cut waste, reduce losers, scale winners, tune
// the middle, fix weak creative. Pure + deterministic so it runs instantly in
// the browser with no API calls.

import type { CampaignRow, ClientGoals } from '../types'

export type ActionKind = 'negate' | 'reduce' | 'scale' | 'fix_bids' | 'low_ctr'
export type Status = 'good' | 'warn' | 'bad' | 'none'

export interface Action {
  id: string
  key: string           // stable signature (kind + campaign) for persisting decisions
  kind: ActionKind
  tone: 'mint' | 'blush' | 'gold' | 'peri'
  campaign: string
  type: CampaignRow['type']
  headline: string      // imperative label, e.g. "Scale up"
  detail: string        // the why, with the numbers
  move: string          // the concrete recommended move
  impact: number        // $ at stake — drives ranking within a kind
  impactLabel: string
  roas: number
  spend: number
}

export interface AccountSummary {
  spend: number
  adSales: number
  roas: number
  orders: number
  targetRoas: number
  minRoas: number
  monthlyBudget: number
  pacePct: number | null   // 30-day spend ÷ monthly budget
  paceStatus: Status
  roasStatus: Status
  tacos: number | null
  tacosGoal: number
  tacosCeiling: number
  tacosStatus: Status
  totalSales: number | null
}

export interface ActionReport {
  summary: AccountSummary
  actions: Action[]
  considered: number   // # live campaigns analyzed
}

// Thresholds. Conservative so we don't flag trivial or low-signal campaigns.
const MIN_SPEND = 10
const MIN_CLICKS_DEAD = 10
const LOW_CTR = 0.25
const LOW_CTR_MIN_IMPR = 2000

const KIND_PRIORITY: Record<ActionKind, number> = {
  negate: 0, reduce: 1, scale: 2, fix_bids: 3, low_ctr: 4,
}

interface Opts {
  totalSales?: number | null
  fmt?: (n: number) => string   // currency formatter (client currency)
}

export function buildActionReport(
  campaigns: CampaignRow[],
  goals: ClientGoals,
  opts: Opts = {},
): ActionReport {
  const fmt = opts.fmt ?? defaultMoney
  const targetRoas = goals.targetRoas || 0
  const minRoas = goals.minimumAcceptableRoas || 0

  // Only act on live campaigns (enabled, or unknown state from a bulk upload).
  const live = campaigns.filter(c => (c.state ? c.state === 'enabled' : true))

  const actions: Action[] = []
  let seq = 0
  const id = () => `act-${seq++}`
  // Inject a stable per-campaign-per-kind key so approve/deny + notes survive re-runs.
  const add = (a: Omit<Action, 'key'>) => actions.push({ ...a, key: `${a.kind}:${a.campaign}` })

  for (const c of live) {
    const spend = c.spend || 0
    if (spend < MIN_SPEND) continue
    const adSales = c.adSales || 0
    const clicks = c.clicks || 0
    const roas = c.roas || (spend > 0 ? adSales / spend : 0)

    // 1) Zero-sale spend → cut / negate (clearest waste)
    if (adSales <= 0 && clicks >= MIN_CLICKS_DEAD) {
      add({
        id: id(), kind: 'negate', tone: 'blush', campaign: c.campaign, type: c.type,
        headline: 'Cut wasted spend',
        detail: `${fmt(spend)} spent over ${whole(clicks)} clicks with zero sales.`,
        move: 'Pause it, or harvest any converting terms and negate the rest.',
        impact: spend, impactLabel: `${fmt(spend)} wasted`,
        roas, spend,
      })
      continue
    }

    // 2) Below the ROAS floor → reduce / restructure
    if (roas > 0 && minRoas > 0 && roas < minRoas) {
      const recoverable = Math.max(0, spend - adSales / minRoas)
      add({
        id: id(), kind: 'reduce', tone: 'blush', campaign: c.campaign, type: c.type,
        headline: 'Reduce / restructure',
        detail: `ROAS ${roas.toFixed(2)}× is below your ${minRoas.toFixed(2)}× floor on ${fmt(spend)} spend.`,
        move: 'Lower bids toward the RPC target, tighten targeting, or pause.',
        impact: recoverable || spend, impactLabel: `${fmt(recoverable)} recoverable`,
        roas, spend,
      })
      continue
    }

    // 3) Beating target ROAS → scale
    if (targetRoas > 0 && roas >= targetRoas) {
      const upside = adSales * 0.25   // rough incremental-revenue proxy for ranking
      add({
        id: id(), kind: 'scale', tone: 'mint', campaign: c.campaign, type: c.type,
        headline: 'Scale up',
        detail: `ROAS ${roas.toFixed(2)}× beats your ${targetRoas.toFixed(2)}× target — there's headroom.`,
        move: 'Raise budget/bids ~15–25% and confirm ROAS holds before pushing more.',
        impact: upside, impactLabel: `~${fmt(upside)}+ upside`,
        roas, spend,
      })
      continue
    }

    // 4) Between floor and target → tune bids toward target
    if (targetRoas > 0 && roas >= minRoas && roas < targetRoas) {
      const toOptimize = Math.max(0, spend - adSales / targetRoas)
      add({
        id: id(), kind: 'fix_bids', tone: 'gold', campaign: c.campaign, type: c.type,
        headline: 'Tune bids',
        detail: `ROAS ${roas.toFixed(2)}× is under your ${targetRoas.toFixed(2)}× target on ${fmt(spend)} spend.`,
        move: 'Nudge bids down toward the RPC target to lift efficiency.',
        impact: toOptimize, impactLabel: `${fmt(toOptimize)} to optimize`,
        roas, spend,
      })
      continue
    }
  }

  // 5) Low CTR with real impression volume → creative / relevance (skip if the
  //    campaign is already flagged as waste).
  for (const c of live) {
    const spend = c.spend || 0
    if (spend < MIN_SPEND) continue
    const impr = c.impressions || 0
    const ctr = c.ctr || (impr ? ((c.clicks || 0) / impr) * 100 : 0)
    if (impr >= LOW_CTR_MIN_IMPR && ctr > 0 && ctr < LOW_CTR) {
      // One move per campaign — don't double-flag something already actioned.
      if (actions.some(a => a.campaign === c.campaign)) continue
      add({
        id: id(), kind: 'low_ctr', tone: 'peri', campaign: c.campaign, type: c.type,
        headline: 'Fix creative / relevance',
        detail: `CTR ${ctr.toFixed(2)}% across ${whole(impr)} impressions — traffic isn't clicking.`,
        move: 'Refresh the main image/creative or tighten targeting to more relevant terms.',
        impact: spend, impactLabel: 'relevance',
        roas: c.roas || 0, spend,
      })
    }
  }

  actions.sort((a, b) => {
    const p = KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]
    return p !== 0 ? p : b.impact - a.impact
  })

  // ---- Account summary ----
  const spend = sumBy(campaigns, c => c.spend)
  const adSales = sumBy(campaigns, c => c.adSales)
  const orders = sumBy(campaigns, c => c.orders)
  const roas = spend > 0 ? adSales / spend : 0
  const monthlyBudget = goals.monthlyAdBudget || 0
  const pacePct = monthlyBudget > 0 ? (spend / monthlyBudget) * 100 : null
  const totalSales = opts.totalSales ?? null
  const tacos = totalSales && totalSales > 0 ? (spend / totalSales) * 100 : null
  const ceiling = goals.acceptableTacosCeiling || 0
  const tacosGoal = goals.primaryTacosGoal || 0

  const summary: AccountSummary = {
    spend, adSales, roas, orders,
    targetRoas, minRoas, monthlyBudget,
    pacePct,
    paceStatus: pacePct == null ? 'none' : pacePct > 110 ? 'bad' : pacePct < 70 ? 'warn' : 'good',
    roasStatus: targetRoas <= 0 ? 'none' : roas >= targetRoas ? 'good' : (minRoas > 0 && roas < minRoas) ? 'bad' : 'warn',
    tacos,
    tacosGoal, tacosCeiling: ceiling,
    tacosStatus: tacos == null ? 'none' : (ceiling > 0 && tacos > ceiling) ? 'bad' : (tacosGoal > 0 && tacos > tacosGoal) ? 'warn' : 'good',
    totalSales,
  }

  return { summary, actions, considered: live.length }
}

function sumBy(arr: CampaignRow[], f: (c: CampaignRow) => number): number {
  return arr.reduce((s, c) => s + (f(c) || 0), 0)
}
function whole(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n || 0))
}
function defaultMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0)
}
