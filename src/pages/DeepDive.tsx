// Deep Dive — the full Evolved PART 6 strategic report for the current client.
// Executive summary, goal reality check, account health, efficiency leaks,
// scale levers, and campaign analysis by portfolio. Built for live client calls:
// clean, ruthless, print-ready. Move-by-move approvals live in the Action Center.

import React, { useMemo } from 'react'
import { FileText, Printer, Target, AlertTriangle, TrendingUp, Layers, ArrowRight, CircleCheck, CircleAlert, CircleX } from 'lucide-react'
import { Panel, EmptyState, Button, cx } from '../components/ui'
import { useStore } from '../lib/store'
import { useClientCampaigns } from '../lib/campaignData'
import { useSpApiConnections } from '../lib/spapi'
import { currencyWhole, multiplier, percent, num } from '../lib/format'
import { buildDeepDive, type Verdict, type HealthFlag } from '../utils/deepDive'

const VERDICT_BADGE: Record<Verdict, { label: string; cls: string; icon: React.ReactNode }> = {
  on_track:    { label: 'On track',             cls: 'bg-accent-mintSoft text-[#1f7a4a]', icon: <CircleCheck className="w-3.5 h-3.5" /> },
  realistic:   { label: 'Realistic',            cls: 'bg-accent-mintSoft text-[#1f7a4a]', icon: <CircleCheck className="w-3.5 h-3.5" /> },
  aggressive:  { label: 'Aggressive but possible', cls: 'bg-accent-goldSoft text-[#8b6a18]', icon: <CircleAlert className="w-3.5 h-3.5" /> },
  unrealistic: { label: 'Unrealistic as set',   cls: 'bg-accent-blushSoft text-[#9c4651]', icon: <CircleX className="w-3.5 h-3.5" /> },
  unknown:     { label: 'Goals not set',        cls: 'bg-[#f1f2f5] text-ink-mute',         icon: <CircleAlert className="w-3.5 h-3.5" /> },
}

const FLAG_TEXT: Record<HealthFlag, string> = {
  good: 'text-[#1f7a4a]', warn: 'text-[#8b6a18]', bad: 'text-[#9c4651]', none: 'text-ink',
}
const FLAG_DOT: Record<HealthFlag, string> = {
  good: 'bg-[#1f7a4a]', warn: 'bg-[#c79a2e]', bad: 'bg-[#c2606c]', none: 'bg-ink-faint',
}

export function DeepDive() {
  const { currentClient } = useStore()
  const campaigns = useClientCampaigns()
  const { connections } = useSpApiConnections()

  const ccy = currentClient?.currency ?? 'USD'
  const fmt = (n: number) => currencyWhole(n, ccy)

  const totalSales = useMemo(() => {
    if (!currentClient) return null
    const conn = connections.find(c => c.app_client_id === currentClient.id)
    const daily = conn?.synced_data?.daily ?? []
    if (!daily.length) return null
    const cutoff = isoDaysAgo(30)
    const s = daily.filter(d => d.date >= cutoff).reduce((acc, d) => acc + (d.totalSales || 0), 0)
    return s > 0 ? s : null
  }, [connections, currentClient?.id])

  const bundle = useStore().currentBundle
  const report = useMemo(
    () => (bundle && currentClient ? buildDeepDive(campaigns, bundle.goals, { totalSales, clientName: currentClient.name, fmt }) : null),
    [campaigns, bundle?.goals, totalSales, ccy, currentClient?.name],
  )

  if (!currentClient || !bundle || !report) return <EmptyState title="No client selected" />

  if (campaigns.length === 0) {
    return (
      <div className="space-y-5">
        <Header name={currentClient.name} />
        <Panel>
          <EmptyState
            title="No campaign data yet"
            description="Sync this client's Amazon Ads account (Reporting Dashboard → Sync) or upload a bulk campaign export, then generate the deep dive."
          />
        </Panel>
      </div>
    )
  }

  const { goalCheck: g, health: h, leaks, scale, portfolios, execSummary, action } = report
  const badge = VERDICT_BADGE[g.verdict]

  return (
    <div className="space-y-6 max-w-4xl print:max-w-none">
      <Header name={currentClient.name} onPrint={() => window.print()} />

      {/* 1 — Executive summary */}
      <Section icon={<FileText className="w-4 h-4" />} title="Executive summary">
        <Panel>
          <ol className="space-y-2.5">
            {execSummary.map((line, i) => (
              <li key={i} className="flex gap-2.5 text-sm text-ink leading-relaxed">
                <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-[#f1f2f5] text-ink-mute text-2xs font-semibold flex items-center justify-center">{i + 1}</span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </Section>

      {/* 2 — Goal reality check (PART 5) */}
      <Section icon={<Target className="w-4 h-4" />} title="Goal reality check">
        <div className={cx('rounded-xl2 border px-5 py-4',
          g.verdict === 'unrealistic' ? 'border-accent-blush/30 bg-accent-blushSoft/40'
          : g.verdict === 'aggressive' ? 'border-accent-gold/30 bg-accent-goldSoft/40'
          : g.verdict === 'unknown' ? 'border-line bg-canvas-panel'
          : 'border-accent-mint/30 bg-accent-mintSoft/40')}>
          <div className="flex items-center gap-2 mb-2">
            <span className={cx('inline-flex items-center gap-1 text-2xs font-semibold px-2 py-0.5 rounded-full', badge.cls)}>{badge.icon}{badge.label}</span>
          </div>
          <p className="text-sm text-ink leading-relaxed">{g.verdictText}</p>
          {g.hasGoals && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-3 mt-4 pt-4 border-t border-line/70">
              <Stat label="Current → desired" value={`${fmt(g.currentSales)} → ${fmt(g.desiredSales)}`} sub={g.growthPct != null ? `${g.growthPct >= 0 ? '+' : ''}${g.growthPct.toFixed(0)}% over 30 days` : 'set current sales'} />
              <Stat label="Daily run-rate needed" value={`${fmt(g.requiredDaily)}/day`} sub={`now ${fmt(g.currentDaily)}/day`} />
              <Stat label="Max spend @ target TACoS" value={fmt(g.maxSpendAtTargetTacos)} sub={`${percent(g.targetTacos, 0)} of ${fmt(g.desiredSales)}`} />
              <Stat label="Budget supports" value={g.salesSupportedByBudget != null ? fmt(g.salesSupportedByBudget) : '—'} sub={g.monthlyBudget > 0 ? `${fmt(g.monthlyBudget)}/mo budget` : 'set a budget'} flag={g.budgetConflict ? 'bad' : 'good'} />
            </div>
          )}
        </div>
      </Section>

      {/* 3 — Account health */}
      <Section icon={<Layers className="w-4 h-4" />} title="Account health" sub="Trailing 30 days">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Metric label="Ad spend" value={fmt(h.spend)} />
          <Metric label="Ad sales" value={fmt(h.adSales)} sub={`${num(h.orders)} orders`} />
          <Metric label="Total sales" value={h.totalSales != null ? fmt(h.totalSales) : '—'} sub={h.totalSales == null ? 'connect Seller Central' : 'all channels'} />
          <Metric label="Blended ROAS" value={multiplier(h.roas)} flag={h.roasStatus} />
          <Metric label="TACoS" value={h.tacos != null ? percent(h.tacos, 1) : '—'} flag={h.tacosStatus} />
          <Metric label="CTR" value={percent(h.ctr, 2)} />
          <Metric label="CPC" value={fmt(h.cpc)} />
          <Metric label="Ad CVR" value={percent(h.cvr, 1)} sub={h.cvr > 0 && h.cvr < 5 ? 'below 5% — conversion flag' : undefined} flag={h.cvr > 0 && h.cvr < 5 ? 'warn' : 'none'} />
        </div>
      </Section>

      {/* 4 — Efficiency leaks */}
      {leaks.length > 0 && (
        <Section icon={<AlertTriangle className="w-4 h-4" />} title="Top efficiency leaks" sub="Fix control before cutting — graduate winners + negatives first">
          <Panel padding="p-0">
            <Table head={['Campaign', 'Spend', 'Sales', 'ROAS', 'Recoverable', 'Why']}>
              {leaks.map((l, i) => (
                <tr key={i} className="border-t border-line/70">
                  <Td><span className="text-2xs px-1.5 py-0.5 rounded bg-[#f1f2f5] text-ink-mute mr-1.5">{l.type}</span>{l.campaign}</Td>
                  <Td num>{fmt(l.spend)}</Td>
                  <Td num>{fmt(l.adSales)}</Td>
                  <Td num className={l.roas > 0 ? 'text-[#9c4651]' : 'text-ink-mute'}>{l.roas > 0 ? multiplier(l.roas) : '—'}</Td>
                  <Td num className="font-semibold text-[#9c4651]">{fmt(l.recoverable)}</Td>
                  <Td className="text-ink-mute">{l.reason}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </Section>
      )}

      {/* 5 — Ready to scale */}
      {scale.length > 0 && (
        <Section icon={<TrendingUp className="w-4 h-4" />} title="Blockers to scale → proven winners" sub="Beating target — push spend, confirm budget headroom & ROAS holds">
          <Panel padding="p-0">
            <Table head={['Campaign', 'ROAS', 'Ad sales', '% of sales', 'Move']}>
              {scale.map((s, i) => (
                <tr key={i} className="border-t border-line/70">
                  <Td><span className="text-2xs px-1.5 py-0.5 rounded bg-[#f1f2f5] text-ink-mute mr-1.5">{s.type}</span>{s.campaign}</Td>
                  <Td num className="font-semibold text-[#1f7a4a]">{multiplier(s.roas)}</Td>
                  <Td num>{fmt(s.adSales)}</Td>
                  <Td num>{percent(s.salesShare, 0)}</Td>
                  <Td className="text-ink-mute">{s.note}</Td>
                </tr>
              ))}
            </Table>
          </Panel>
        </Section>
      )}

      {/* 6 — Campaign analysis by portfolio */}
      <Section icon={<Layers className="w-4 h-4" />} title="Campaign analysis by portfolio">
        <Panel padding="p-0">
          <Table head={['Portfolio', 'Campaigns', 'Spend', 'Ad sales', 'ROAS', 'Read']}>
            {portfolios.map((p, i) => (
              <tr key={i} className="border-t border-line/70">
                <Td><span className={cx('inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle', FLAG_DOT[p.status])} />{p.name}</Td>
                <Td num>{p.count}</Td>
                <Td num>{fmt(p.spend)}</Td>
                <Td num>{fmt(p.adSales)}</Td>
                <Td num className={FLAG_TEXT[p.status]}>{p.spend > 0 ? multiplier(p.roas) : '—'}</Td>
                <Td className="text-ink-mute">{p.note}</Td>
              </tr>
            ))}
          </Table>
        </Panel>
      </Section>

      {/* Footer — route to approvals */}
      <div className="rounded-xl2 border border-line bg-canvas-panel px-5 py-4 flex items-center justify-between flex-wrap gap-3 print:hidden">
        <p className="text-sm text-ink-mute">
          <span className="font-medium text-ink">{action.actions.length} prioritized moves</span> are ready to approve, with bulk upload + rollback sheets.
        </p>
        <a href="#/actions" className="inline-flex items-center gap-1.5 text-sm font-medium text-[#3b48a5] hover:underline">
          Go to the Action Center <ArrowRight className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  )
}

function Header({ name, onPrint }: { name: string; onPrint?: () => void }) {
  return (
    <header className="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <div className="text-xs text-ink-faint flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> Strategic deep dive · Evolved methodology</div>
        <h1 className="text-xl font-semibold text-ink mt-0.5">{name}</h1>
      </div>
      {onPrint && (
        <Button variant="secondary" icon={<Printer className="w-3.5 h-3.5" />} onClick={onPrint} className="print:hidden">Print / Save PDF</Button>
      )}
    </header>
  )
}

function Section({ icon, title, sub, children }: { icon: React.ReactNode; title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-ink-faint">{icon}</span>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {sub && <span className="text-2xs text-ink-faint">· {sub}</span>}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value, sub, flag = 'none' }: { label: string; value: string; sub?: string; flag?: HealthFlag }) {
  return (
    <div>
      <div className="text-2xs font-medium text-ink-faint uppercase tracking-wide">{label}</div>
      <div className={cx('text-sm font-semibold mt-0.5 tnum', FLAG_TEXT[flag])}>{value}</div>
      {sub && <div className="text-2xs text-ink-mute mt-0.5">{sub}</div>}
    </div>
  )
}

function Metric({ label, value, sub, flag = 'none' }: { label: string; value: string; sub?: string; flag?: HealthFlag }) {
  return (
    <Panel padding="p-3.5">
      <div className="text-2xs font-medium text-ink-faint uppercase tracking-wide">{label}</div>
      <div className={cx('text-xl font-semibold mt-1 tnum', FLAG_TEXT[flag])}>{value}</div>
      {sub && <div className="text-2xs text-ink-mute mt-0.5">{sub}</div>}
    </Panel>
  )
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-2xs font-medium text-ink-faint uppercase tracking-wide">
            {head.map((h, i) => (
              <th key={i} className={cx('px-4 py-2.5 text-left whitespace-nowrap', i > 0 && i < head.length - 1 && 'text-right')}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function Td({ children, num: isNum, className }: { children: React.ReactNode; num?: boolean; className?: string }) {
  return <td className={cx('px-4 py-2.5 align-top', isNum ? 'text-right tnum whitespace-nowrap' : 'text-ink', className)}>{children}</td>
}

function isoDaysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
