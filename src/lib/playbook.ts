// Sophie Society Optimization Calendar playbook.
// Encodes the Daily / Weekly / Monthly / Quarterly cadence of standard agency work.
// "Apply playbook" seeds a client's optimization calendar with these tasks at the
// correct cadence, due date, and category.

import type { OptCadence, OptCategory, OptimizationTask } from '../types'
import { cryptoRandomId } from './store'

export interface PlaybookTemplate {
  key: string                  // stable id used to detect duplicates
  title: string
  detail?: string
  category: OptCategory
  cadence: OptCadence
  weekday?: 'mon' | 'tue' | 'wed' | 'thu' | 'fri'  // for weekly cadence
  monthDay?: number            // for monthly / quarterly
}

export const PLAYBOOK: PlaybookTemplate[] = [
  // --- Daily — Bid Optimization (active product-launch posture) ---
  { key: 'd-bid-launch-bids',        title: 'Adjust keyword / ASIN bids and placements during product launch', category: 'bid',      cadence: 'daily' },
  { key: 'd-bid-rank-tracking',      title: 'Track keyword rankings during product launch',                     category: 'bid',      cadence: 'daily' },

  // --- Weekly — Bid Optimization (Monday block) ---
  { key: 'w-bid-low-acos',           title: 'Adjust bids for keywords/ASINs with low ACOS',                      category: 'bid',      cadence: 'weekly', weekday: 'mon' },
  { key: 'w-bid-high-acos',          title: 'Adjust bids for keywords/ASINs with high ACOS',                     category: 'bid',      cadence: 'weekly', weekday: 'mon' },
  { key: 'w-bid-low-impressions',    title: 'Adjust bids for keywords/ASINs with low impressions',               category: 'bid',      cadence: 'weekly', weekday: 'mon' },
  { key: 'w-bid-clicks-no-sales',    title: 'Adjust bids for keywords/ASINs with high clicks, no sales',         category: 'bid',      cadence: 'weekly', weekday: 'mon' },

  // --- Weekly — Bid Optimization (Thursday block) ---
  { key: 'w-bid-mid-review',         title: 'Review bid changes made at the beginning of the week',              category: 'bid',      cadence: 'weekly', weekday: 'thu' },
  { key: 'w-bid-mid-correct',        title: 'Make additional bid changes only if something goes out of line',    category: 'bid',      cadence: 'weekly', weekday: 'thu' },

  // --- Weekly — Campaign Optimization ---
  { key: 'w-camp-negatives',         title: 'Add negative keywords / ASINs',                                     category: 'campaign', cadence: 'weekly', weekday: 'tue' },
  { key: 'w-camp-placement',         title: 'Adjust search placement, business placement & audience modifiers',   category: 'campaign', cadence: 'weekly', weekday: 'tue' },
  { key: 'w-camp-graduate',          title: 'Graduate well-performing keywords',                                  category: 'campaign', cadence: 'weekly', weekday: 'wed' },
  { key: 'w-camp-isolate',           title: 'Isolate high-sales keywords',                                        category: 'campaign', cadence: 'weekly', weekday: 'wed' },
  { key: 'w-camp-budgets',           title: 'Adjust campaign budgets',                                            category: 'campaign', cadence: 'weekly', weekday: 'fri' },
  { key: 'w-camp-deepdive',          title: 'Complete ad account deep-dive',                                      category: 'campaign', cadence: 'weekly', weekday: 'fri' },

  // --- Monthly — Campaign Optimization (structure expansion) ---
  { key: 'm-camp-match-types',       title: 'Expand campaign structure: add new match types (phrase, broad)',     category: 'campaign', cadence: 'monthly', monthDay: 5 },
  { key: 'm-camp-campaign-types',    title: 'Expand campaign structure: add new campaign types (SB, SD)',         category: 'campaign', cadence: 'monthly', monthDay: 7 },
  { key: 'm-camp-creatives',         title: 'Expand campaign structure: add new creatives (video, custom images)', category: 'campaign', cadence: 'monthly', monthDay: 10 },
  { key: 'm-camp-lookback',          title: 'Expand campaign structure: add additional lookback periods',          category: 'campaign', cadence: 'monthly', monthDay: 12 },
  { key: 'm-camp-keyword-groups',    title: 'Expand campaign structure: add new keyword groups (same word stem)',  category: 'campaign', cadence: 'monthly', monthDay: 15 },

  // --- Monthly — Creatives ---
  { key: 'm-crea-video-test',        title: 'Split test and adjust video creatives',                              category: 'creatives', cadence: 'monthly', monthDay: 18 },
  { key: 'm-crea-image-test',        title: 'Split test and adjust custom image creatives',                       category: 'creatives', cadence: 'monthly', monthDay: 20 },

  // --- Monthly — SEO (lighter touch) ---
  { key: 'm-seo-light',              title: 'Light refresh: title, bullets, A+ content if a quick win surfaces',  category: 'seo',      cadence: 'monthly', monthDay: 25 },

  // --- Quarterly — SEO ---
  { key: 'q-seo-title-bullets',      title: 'Refresh title, bullet points and A+ content based on best converters', category: 'seo',     cadence: 'quarterly', monthDay: 8 },
  { key: 'q-seo-backend-kw',         title: 'Adjust backend keywords based on best converting keywords',           category: 'seo',      cadence: 'quarterly', monthDay: 10 },
  { key: 'q-seo-images',             title: 'Adjust images & graphics to better match the customer avatar',        category: 'seo',      cadence: 'quarterly', monthDay: 14 },

  // --- Quarterly — Additional ---
  { key: 'q-add-dayparting',         title: 'Implement additional tactics: dayparting',                            category: 'additional', cadence: 'quarterly', monthDay: 18 },
  { key: 'q-add-reverse-asin',       title: 'Expand keyword base via Reverse ASIN search on top 3 competitors',    category: 'additional', cadence: 'quarterly', monthDay: 22 },
]

// ---------- UI metadata ----------

export const CATEGORY_LABEL: Record<OptCategory, string> = {
  bid: 'Bid Optimization',
  campaign: 'Campaign Optimization',
  creatives: 'Creatives Optimization',
  seo: 'SEO Optimization',
  additional: 'Additional Optimizations',
}

export const CATEGORY_TONE: Record<OptCategory, 'peri' | 'lavender' | 'mint' | 'gold' | 'blush'> = {
  bid: 'peri',
  campaign: 'lavender',
  creatives: 'mint',
  seo: 'gold',
  additional: 'blush',
}

export const CATEGORY_ORDER: OptCategory[] = ['bid', 'campaign', 'creatives', 'seo', 'additional']

export const CADENCE_LABEL: Record<OptCadence, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  oneoff: 'One-off',
}

export const CADENCE_ORDER: OptCadence[] = ['daily', 'weekly', 'monthly', 'quarterly', 'oneoff']

// ---------- Due-date helpers ----------

const WEEKDAY_INDEX: Record<NonNullable<PlaybookTemplate['weekday']>, number> = {
  mon: 1, tue: 2, wed: 3, thu: 4, fri: 5,
}

export function nextDueDateFor(template: PlaybookTemplate, base = new Date()): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  switch (template.cadence) {
    case 'daily': return iso(d)
    case 'weekly': {
      const target = WEEKDAY_INDEX[template.weekday ?? 'mon']
      const today = d.getDay()
      const delta = (target - today + 7) % 7
      d.setDate(d.getDate() + delta)
      return iso(d)
    }
    case 'biweekly': {
      const target = WEEKDAY_INDEX[template.weekday ?? 'mon']
      const today = d.getDay()
      const delta = (target - today + 7) % 7
      d.setDate(d.getDate() + delta)
      return iso(d)
    }
    case 'monthly': {
      const day = template.monthDay ?? 15
      const candidate = new Date(d.getFullYear(), d.getMonth(), day)
      if (candidate < d) candidate.setMonth(candidate.getMonth() + 1)
      return iso(candidate)
    }
    case 'quarterly': {
      const day = template.monthDay ?? 15
      const q = Math.floor(d.getMonth() / 3)
      const candidate = new Date(d.getFullYear(), q * 3, day)
      if (candidate < d) candidate.setMonth(candidate.getMonth() + 3)
      return iso(candidate)
    }
    case 'oneoff':
    default:
      return iso(d)
  }
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ---------- Seeder ----------

export function buildPlaybookTasks(clientId: string, base = new Date()): OptimizationTask[] {
  const now = new Date().toISOString()
  return PLAYBOOK.map(t => ({
    id: cryptoRandomId(),
    title: t.title,
    detail: t.detail,
    due: nextDueDateFor(t, base),
    completed: false,
    category: t.category,
    cadence: t.cadence,
    templateKey: t.key,
    clientId,
    createdAt: now,
  }))
}

// ---------- Coverage scoring ----------

export interface CoverageStats {
  clientId: string
  cadence: OptCadence
  expected: number
  completed: number
  open: number
  overdue: number
}

/**
 * For each client × cadence, score how much of the current period's playbook has been completed.
 * "Current period" = today for daily, this week for weekly, this month for monthly, etc.
 */
export function scoreCoverage(
  tasks: OptimizationTask[],
  cadence: OptCadence,
  now = new Date(),
): { completed: number; open: number; overdue: number } {
  const { start, end } = periodWindow(cadence, now)
  let completed = 0, open = 0, overdue = 0
  for (const t of tasks) {
    if (t.cadence !== cadence) continue
    const dueTs = new Date(t.due + 'T00:00:00').getTime()
    if (dueTs < start.getTime() || dueTs > end.getTime()) continue
    if (t.completed) completed++
    else if (dueTs < now.getTime()) overdue++
    else open++
  }
  return { completed, open, overdue }
}

export function periodWindow(cadence: OptCadence, now = new Date()): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start)
  switch (cadence) {
    case 'daily':
      end.setHours(23, 59, 59, 999)
      return { start, end }
    case 'weekly':
    case 'biweekly': {
      // Sun=0 → roll back to Monday
      const dow = start.getDay()
      const back = dow === 0 ? 6 : dow - 1
      start.setDate(start.getDate() - back)
      end.setDate(start.getDate() + 6)
      end.setHours(23, 59, 59, 999)
      return { start, end }
    }
    case 'monthly': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1)
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
      return { start: s, end: e }
    }
    case 'quarterly': {
      const q = Math.floor(now.getMonth() / 3)
      const s = new Date(now.getFullYear(), q * 3, 1)
      const e = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999)
      return { start: s, end: e }
    }
    case 'oneoff':
    default: {
      // Anchor at "today" for one-offs.
      end.setHours(23, 59, 59, 999)
      return { start, end }
    }
  }
}
