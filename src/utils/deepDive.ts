// Deep-dive report engine — the Evolved PART 6 strategic output, computed from
// the client's live campaign performance + goals. Pure + deterministic so the
// whole report renders instantly in the browser, client-call ready. Sections
// mirror the master prompt: Executive Summary, Goal Reality Check (PART 5),
// Account Health, Efficiency Leaks, Blockers to Scale, Campaign Analysis by
// Portfolio, and the prioritized action list (reused from recommendations.ts).

import type { CampaignRow, ClientGoals } from '../types'
import { buildActionReport, type ActionReport } from './recommendations'

export type Verdict = 'on_track' | 'realistic' | 'aggressive' | 'unrealistic' | 'unknown'
export type HealthFlag = 'good' | 'warn' | 'bad' | 'none'

export interface GoalCheck {
  hasGoals: boolean
  currentSales: number
  desiredSales: number
  salesGap: number
  growthPct: number | null
  currentDaily: number
  requiredDaily: number
  monthlyBudget: number
  targetTacos: number              // %
  maxSpendAtTargetTacos: number    // $ you can spend at target TACoS to hit desired sales
  salesSupportedByBudget: number | null  // $ sales the budget supports at target TACoS
  budgetConflict: boolean
  currentTacos: number | null
  currentRoas: number
  verdict: Verdict
  verdictText: string
}

export interface Health {
  spend: number
  adSales: number
  totalSales: number | null
  roas: number
  tacos: number | null
  ctr: number
  cpc: number
  cvr: number
  orders: number
  impressions: number
  clicks: number
  pacePct: number | null
  paceStatus: HealthFlag
  roasStatus: HealthFlag
  tacosStatus: HealthFlag
}

export interface Leak {
  campaign: string
  type: CampaignRow['type']
  portfolio: string
  spend: number
  adSales: number
  roas: number
  recoverable: number
  reason: string
}

export interface ScaleItem {
  campaign: string
  type: CampaignRow['type']
  roas: number
  adSales: number
  spend: number
  salesShare: number     // % of total ad sales
  note: string
}

export interface PortfolioRow {
  name: string
  count: number
  spend: number
  adSales: number
  roas: number
  status: HealthFlag
  note: string
}

export interface DeepDive {
  clientName: string
  goalCheck: GoalCheck
  health: Health
  leaks: Leak[]
  scale: ScaleItem[]
  portfolios: PortfolioRow[]
  action: ActionReport
  execSummary: string[]
  concentration: { topShare: number; topCampaign: string } | null
}

interface Opts {
  totalSales?: number | null
  clientName?: string
  fmt?: (n: number) => string
}

const sum = (a: CampaignRow[], f: (c: CampaignRow) => number) => a.reduce((s, c) => s + (f(c) || 0), 0)

export function buildDeepDive(campaigns: CampaignRow[], goals: ClientGoals, opts: Opts = {}): DeepDive {
  const fmt = opts.fmt ?? ((n: number) => `$${Math.round(n).toLocaleString()}`)
  const totalSales = opts.totalSales ?? null
  const action = buildActionReport(campaigns, goals, { totalSales, fmt })

  // ---- Account totals ----
  const spend = sum(campaigns, c => c.spend)
  const adSales = sum(campaigns, c => c.adSales)
  const orders = sum(campaigns, c => c.orders)
  const clicks = sum(campaigns, c => c.clicks)
  const impressions = sum(campaigns, c => c.impressions)
  const roas = spend > 0 ? adSales / spend : 0
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0
  const cpc = clicks > 0 ? spend / clicks : 0
  const cvr = clicks > 0 ? (orders / clicks) * 100 : 0
  const tacos = totalSales && totalSales > 0 ? (spend / totalSales) * 100 : null

  const targetRoas = goals.targetRoas || 0
  const minRoas = goals.minimumAcceptableRoas || 0

  const health: Health = {
    spend, adSales, totalSales, roas, tacos, ctr, cpc, cvr, orders, impressions, clicks,
    pacePct: action.summary.pacePct,
    paceStatus: action.summary.paceStatus,
    roasStatus: action.summary.roasStatus,
    tacosStatus: action.summary.tacosStatus,
  }

  // ---- Goal Reality Check (PART 5) ----
  const targetTacos = goals.primaryTacosGoal || 0
  const currentSales = goals.currentProjectedMonthlySales || totalSales || 0
  const desiredSales = goals.desiredNext30DaySales || 0
  const hasGoals = desiredSales > 0
  const salesGap = desiredSales - currentSales
  const growthPct = currentSales > 0 ? (desiredSales / currentSales - 1) * 100 : null
  const monthlyBudget = goals.monthlyAdBudget || 0
  const maxSpendAtTargetTacos = targetTacos > 0 ? desiredSales * (targetTacos / 100) : 0
  const salesSupportedByBudget = targetTacos > 0 && monthlyBudget > 0 ? monthlyBudget / (targetTacos / 100) : null
  const budgetConflict = salesSupportedByBudget != null && desiredSales > 0 && salesSupportedByBudget < desiredSales * 0.98

  let verdict: Verdict = 'unknown'
  let verdictText = 'Set this client’s goals (desired sales, budget, target TACoS) to generate a reality check.'
  if (hasGoals) {
    const g = growthPct ?? 0
    if (salesGap <= 0) {
      verdict = 'on_track'
      verdictText = `Current run-rate (${fmt(currentSales)}/mo) already meets the ${fmt(desiredSales)} goal. Shift the posture from chasing volume to defending ROAS and pulling profit.`
    } else if (budgetConflict) {
      verdict = 'unrealistic'
      verdictText = `Math conflict: hitting ${fmt(desiredSales)}/mo at a ${targetTacos}% TACoS needs up to ${fmt(maxSpendAtTargetTacos)} in ad spend, but the ${fmt(monthlyBudget)} budget only supports about ${fmt(salesSupportedByBudget!)} in sales at that efficiency. Raise the budget, lift the TACoS ceiling, or trim the goal.`
    } else if (g <= 20) {
      verdict = 'realistic'
      verdictText = `Reaching ${fmt(desiredSales)}/mo is a ${g.toFixed(0)}% lift — realistic. Required run-rate is ${fmt(desiredSales / 30)}/day vs ${fmt(currentSales / 30)}/day today; the budget supports it at target efficiency.`
    } else if (g <= 60) {
      verdict = 'aggressive'
      verdictText = `${fmt(desiredSales)}/mo is a ${g.toFixed(0)}% jump in 30 days — aggressive but possible if CVR and inventory hold. Lean on scaling proven winners, not new discovery, to close the ${fmt(salesGap)} gap.`
    } else {
      verdict = 'unrealistic'
      verdictText = `${fmt(desiredSales)}/mo is a ${g.toFixed(0)}% jump in one month — unrealistic on the current offer and budget. Stage it over 2–3 months, or confirm a budget + CVR step-change first.`
    }
  }

  const goalCheck: GoalCheck = {
    hasGoals, currentSales, desiredSales, salesGap, growthPct,
    currentDaily: currentSales / 30, requiredDaily: desiredSales / 30,
    monthlyBudget, targetTacos, maxSpendAtTargetTacos, salesSupportedByBudget, budgetConflict,
    currentTacos: tacos, currentRoas: roas, verdict, verdictText,
  }

  // ---- Top Efficiency Leaks (live campaigns below the ROAS floor / zero-sale) ----
  const live = campaigns.filter(c => (c.state ? c.state === 'enabled' : true) && (c.spend || 0) >= 10)
  const leaks: Leak[] = live
    .map(c => {
      const cSpend = c.spend || 0
      const cSales = c.adSales || 0
      const cRoas = c.roas || (cSpend > 0 ? cSales / cSpend : 0)
      let recoverable = 0
      let reason = ''
      if (cSales <= 0 && (c.clicks || 0) >= 10) {
        recoverable = cSpend
        reason = `${fmt(cSpend)} over ${Math.round(c.clicks || 0)} clicks, zero sales`
      } else if (minRoas > 0 && cRoas > 0 && cRoas < minRoas) {
        recoverable = Math.max(0, cSpend - cSales / minRoas)
        reason = `ROAS ${cRoas.toFixed(2)}× below the ${minRoas.toFixed(2)}× floor`
      }
      return { campaign: c.campaign, type: c.type, portfolio: c.portfolio || '—', spend: cSpend, adSales: cSales, roas: cRoas, recoverable, reason }
    })
    .filter(l => l.recoverable > 0)
    .sort((a, b) => b.recoverable - a.recoverable)
    .slice(0, 8)

  // ---- Blockers to Scale: proven winners ready for more spend (confirm budget headroom) ----
  const scale: ScaleItem[] = live
    .filter(c => targetRoas > 0 && (c.roas || 0) >= targetRoas && (c.adSales || 0) > 0)
    .map(c => ({
      campaign: c.campaign, type: c.type, roas: c.roas || 0, adSales: c.adSales || 0, spend: c.spend || 0,
      salesShare: adSales > 0 ? ((c.adSales || 0) / adSales) * 100 : 0,
      note: `Beating target at ${(c.roas || 0).toFixed(2)}× — raise budget/bids ~15% and confirm ROAS holds`,
    }))
    .sort((a, b) => b.adSales - a.adSales)
    .slice(0, 6)

  // ---- Concentration risk (single campaign carrying too much of ad sales) ----
  let concentration: DeepDive['concentration'] = null
  if (adSales > 0 && live.length > 1) {
    const top = [...live].sort((a, b) => (b.adSales || 0) - (a.adSales || 0))[0]
    const share = ((top?.adSales || 0) / adSales) * 100
    if (share >= 40) concentration = { topShare: share, topCampaign: top.campaign }
  }

  // ---- Campaign Analysis by Portfolio ----
  const byPortfolio = new Map<string, CampaignRow[]>()
  for (const c of campaigns) {
    const key = c.portfolio || `${c.type} (no portfolio)`
    if (!byPortfolio.has(key)) byPortfolio.set(key, [])
    byPortfolio.get(key)!.push(c)
  }
  const portfolios: PortfolioRow[] = [...byPortfolio.entries()]
    .map(([name, rows]) => {
      const pSpend = sum(rows, r => r.spend)
      const pSales = sum(rows, r => r.adSales)
      const pRoas = pSpend > 0 ? pSales / pSpend : 0
      let status: HealthFlag = 'none'
      if (targetRoas > 0) status = pRoas >= targetRoas ? 'good' : (minRoas > 0 && pRoas < minRoas) ? 'bad' : 'warn'
      const note = status === 'good' ? 'Above target — scale candidate'
        : status === 'bad' ? 'Below floor — reduce / restructure'
        : status === 'warn' ? 'Between floor and target — tune bids'
        : 'Set ROAS targets to grade'
      return { name, count: rows.length, spend: pSpend, adSales: pSales, roas: pRoas, status, note }
    })
    .sort((a, b) => b.spend - a.spend)

  // ---- Executive Summary (ruthless, specific) ----
  const execSummary: string[] = []
  execSummary.push(
    `Across ${campaigns.length} campaigns, ads spent ${fmt(spend)} to drive ${fmt(adSales)} in sales — a blended ${roas.toFixed(2)}× ROAS${targetRoas > 0 ? ` against a ${targetRoas.toFixed(2)}× target` : ''}${tacos != null ? `, ${tacos.toFixed(1)}% TACoS` : ''}.`,
  )
  if (hasGoals) execSummary.push(verdictText)
  if (leaks.length) {
    const leakTotal = leaks.reduce((s, l) => s + l.recoverable, 0)
    execSummary.push(`Biggest leak: ${leaks[0].campaign} (${leaks[0].reason}). The top ${leaks.length} efficiency leaks put roughly ${fmt(leakTotal)} in recoverable spend in play — fix control before cutting.`)
  }
  if (scale.length) execSummary.push(`Clearest lever: ${scale[0].campaign} at ${scale[0].roas.toFixed(2)}× (${scale[0].salesShare.toFixed(0)}% of ad sales) — the readiest place to push spend.`)
  if (concentration) execSummary.push(`Concentration risk: ${concentration.topCampaign} carries ${concentration.topShare.toFixed(0)}% of ad sales. Build redundancy before it becomes a single point of failure.`)
  if (action.actions.length) execSummary.push(`${action.actions.length} prioritized moves are queued in the Action Center for approval.`)

  return {
    clientName: opts.clientName || 'Account',
    goalCheck, health, leaks, scale, portfolios, action, execSummary, concentration,
  }
}
