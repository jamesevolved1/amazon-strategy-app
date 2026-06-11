// Ad Potential funnel forecast.
// Budget → CPC → Clicks → CVR → Orders → AOV → Paid Sales → Organic Lift → Total Sales → TACOS.
// Target ROAS is a *benchmark*, never the primary formula.

import type { ClientGoals } from '../types'

export interface FunnelInputs {
  budget: number          // monthly ad budget
  cpc: number             // expected CPC
  ctr?: number            // %, impression → click (optional — used to derive impressions in scenarios)
  cvr: number             // %, click → order
  aov: number             // average order value, paid
  organicLiftRatio: number // paid → organic multiplier, e.g. 0.6 means 60% of paid sales come back as organic
  targetRoas: number      // benchmark only
  minRoas: number
  primaryTacos: number    // % goal
  ceilingTacos: number    // % ceiling
}

export interface FunnelResult {
  budget: number
  cpc: number
  clicks: number
  cvr: number
  orders: number
  aov: number
  paidSales: number
  organicLift: number
  totalSales: number
  tacos: number
  roas: number
  targetRoasGap: number     // positive = above target, negative = below
  riskLevel: 'low' | 'medium' | 'high'
  warnings: string[]
  whatNeedsToBeTrue: WhatNeedsToBeTrue
  explanation: string
}

export interface WhatNeedsToBeTrue {
  conversionsPerDay: number
  clicksPerDay: number
  trafficGrowthVsBaselinePct: number | null
  productPagesViewedPerDay: number
  cpcCeiling: number       // max CPC to stay within target TACOS
}

export function defaultInputsFromGoals(goals: ClientGoals, baseline?: Partial<FunnelInputs>): FunnelInputs {
  return {
    budget: goals.monthlyAdBudget || 0,
    cpc: baseline?.cpc ?? 1.0,
    ctr: baseline?.ctr ?? 0.5,
    cvr: baseline?.cvr ?? 10,
    aov: baseline?.aov ?? 35,
    organicLiftRatio: baseline?.organicLiftRatio ?? 0.6,
    targetRoas: goals.targetRoas || 5,
    minRoas: goals.minimumAcceptableRoas || 3,
    primaryTacos: goals.primaryTacosGoal || 12,
    ceilingTacos: goals.acceptableTacosCeiling || 18,
  }
}

/**
 * Run the funnel anchored to a click target instead of a budget. Used by the
 * editable scenarios table where the strategist drives by clicks ("what if we
 * pushed 25,000 clicks?") and the budget is derived: budget = clicks × cpc.
 */
export function runFunnelByClicks(i: FunnelInputs, clicks: number): FunnelResult & { impressions: number } {
  const budget = clicks * i.cpc
  const r = runFunnel({ ...i, budget })
  const impressions = i.ctr && i.ctr > 0 ? clicks / (i.ctr / 100) : 0
  return { ...r, impressions }
}

export function runFunnel(i: FunnelInputs): FunnelResult {
  const warnings: string[] = []
  const clicks = i.cpc > 0 ? i.budget / i.cpc : 0
  const orders = clicks * (i.cvr / 100)
  const paidSales = orders * i.aov
  const organicLift = paidSales * Math.max(0, i.organicLiftRatio)
  const totalSales = paidSales + organicLift
  const roas = i.budget > 0 ? paidSales / i.budget : 0
  const tacos = totalSales > 0 ? (i.budget / totalSales) * 100 : 0
  const targetRoasGap = roas - i.targetRoas

  // Risk
  let risk: FunnelResult['riskLevel'] = 'low'
  if (roas < i.minRoas || tacos > i.ceilingTacos) risk = 'high'
  else if (roas < i.targetRoas * 0.85 || tacos > i.primaryTacos * 1.25) risk = 'medium'

  if (i.budget <= 0) warnings.push('Budget is zero — no clicks possible.')
  if (i.cpc <= 0) warnings.push('CPC must be positive.')
  if (i.cvr <= 0) warnings.push('CVR must be positive.')
  if (i.aov <= 0) warnings.push('AOV must be positive.')
  if (roas < i.minRoas) warnings.push(`Forecast ROAS ${roas.toFixed(2)}× is below minimum (${i.minRoas.toFixed(2)}×).`)
  if (tacos > i.ceilingTacos) warnings.push(`Forecast TACOS ${tacos.toFixed(1)}% is above ceiling (${i.ceilingTacos.toFixed(1)}%).`)
  if (i.organicLiftRatio > 1.5) warnings.push('Organic lift assumption above 150% is aggressive. Verify with historical paid-to-organic ratio.')

  // What needs to be true
  const days = 30
  const conversionsPerDay = orders / days
  const clicksPerDay = clicks / days
  // CPC ceiling: if you must hit primary TACOS, paidSales = budget / (TACOS/100 * (1+lift)) doesn't apply since TACOS already includes total.
  // Simpler: target paidSales >= budget / (primaryTacos/100 / (1+lift)) -> paidSales >= budget * (1+lift)/ (primaryTacos/100)
  const requiredPaidSales = i.primaryTacos > 0 ? i.budget * (1 + i.organicLiftRatio) / (i.primaryTacos / 100) - 0 : paidSales
  // requiredPaidSales = orders * aov; orders = clicks * cvr; clicks = budget / cpc
  // -> cpc <= budget * cvr/100 * aov * (1+lift) / requiredBudget_x_primaryTacos
  // Solving: cpcCeiling = aov * cvr/100 * (primaryTacos/100) / (1+lift)
  const cpcCeiling = i.aov * (i.cvr / 100) * (i.primaryTacos / 100) / (1 + i.organicLiftRatio)
  const trafficGrowthVsBaselinePct = null
  const productPagesViewedPerDay = clicksPerDay // approx — paid clicks ≈ ad-attributed PDP views

  const what: WhatNeedsToBeTrue = {
    conversionsPerDay,
    clicksPerDay,
    trafficGrowthVsBaselinePct,
    productPagesViewedPerDay,
    cpcCeiling: Math.max(0, cpcCeiling),
  }

  const explanation = clientExplanation(i, { clicks, orders, paidSales, organicLift, totalSales, roas, tacos })

  return {
    budget: i.budget, cpc: i.cpc, clicks, cvr: i.cvr, orders, aov: i.aov,
    paidSales, organicLift, totalSales, tacos, roas, targetRoasGap,
    riskLevel: risk, warnings, whatNeedsToBeTrue: what, explanation,
  }
}

function clientExplanation(i: FunnelInputs, r: { clicks: number; orders: number; paidSales: number; organicLift: number; totalSales: number; roas: number; tacos: number }): string {
  const parts: string[] = []
  parts.push(`At ${currency(i.budget)} budget and ${currency(i.cpc)} CPC, the plan buys about ${Math.round(r.clicks).toLocaleString()} clicks.`)
  parts.push(`A ${i.cvr.toFixed(1)}% conversion rate turns those into ~${Math.round(r.orders).toLocaleString()} paid orders at a ${currency(i.aov)} AOV — about ${currency(r.paidSales)} in paid sales.`)
  if (i.organicLiftRatio > 0) {
    parts.push(`Assuming the established ${(i.organicLiftRatio * 100).toFixed(0)}% organic lift, total sales land near ${currency(r.totalSales)}.`)
  }
  parts.push(`That works out to ${(r.roas).toFixed(2)}× ROAS and ${r.tacos.toFixed(1)}% TACOS.`)
  if (r.roas < i.targetRoas) {
    parts.push(`ROAS comes in below the ${i.targetRoas.toFixed(1)}× benchmark — treat the benchmark as a guardrail, not the plan.`)
  }
  return parts.join(' ')
}

function currency(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0)
}
