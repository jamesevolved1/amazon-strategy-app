import React, { useMemo, useState } from 'react'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import { Panel, Pill, Button, EmptyState, TextField, cx } from '../components/ui'
import { useStore } from '../lib/store'
import { currency, num, percent } from '../lib/format'
import { evaluateGoalRealism, totalsFromSeries } from '../utils/pnl'
import { resolveRange, sliceSeries } from '../utils/dateRange'
import type { BulkCampaignData } from '../utils/parsers'
import type { Currency, DailySeriesPoint, Marketplace } from '../types'

const MARKETPLACES: Marketplace[] = ['US','CA','MX','UK','DE','FR','ES','IT','JP','AU','NL','SE','PL','TR','AE','IN','SG','BR']
const CURRENCIES: Currency[] = ['USD','EUR','GBP','CAD','MXN','JPY','AUD','SEK','PLN','TRY','AED','INR','SGD','BRL']

export function Clients() {
  const { state, clients, currentClient, currentBundle, addClient, renameClient, deleteClient, switchClient, setGoals } = useStore()
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newMkt, setNewMkt] = useState<Marketplace>('US')
  const [newCcy, setNewCcy] = useState<Currency>('USD')
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  // Goal realism for the current client (if data available)
  const realism = useMemo(() => {
    if (!currentBundle) return null
    const bulk = currentBundle.reports.bulkCampaigns?.parsed as BulkCampaignData | undefined
    const series = (bulk?.daily ?? []) as DailySeriesPoint[]
    const range = resolveRange(series, '30d')
    const totals = range ? totalsFromSeries(sliceSeries(series, range.start, range.end), range.days) : null
    return evaluateGoalRealism(currentBundle.goals, totals)
  }, [currentBundle])

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Clients</h1>
          <p className="text-sm text-ink-mute mt-0.5">{num(clients.length)} {clients.length === 1 ? 'client' : 'clients'} · each keeps its own reports, scenarios, and history.</p>
        </div>
        {!adding && (
          <Button onClick={() => setAdding(true)} icon={<Plus className="w-4 h-4" />}>Add client</Button>
        )}
      </header>

      {adding && (
        <Panel>
          <h2 className="text-base font-semibold text-ink mb-3">New client</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <TextField label="Name" value={newName} onChange={setNewName} placeholder="Acme Brands" />
            <label className="block">
              <span className="block text-xs font-medium text-ink-mute mb-1.5">Marketplace</span>
              <select value={newMkt} onChange={e => { setNewMkt(e.target.value as Marketplace); setNewCcy(currencyFor(e.target.value as Marketplace)) }} className="w-full rounded-lg border border-line bg-canvas-panel text-sm px-3 py-2">
                {MARKETPLACES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-ink-mute mb-1.5">Currency</span>
              <select value={newCcy} onChange={e => setNewCcy(e.target.value as Currency)} className="w-full rounded-lg border border-line bg-canvas-panel text-sm px-3 py-2">
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <div className="flex items-end gap-2">
              <Button onClick={() => { if (newName.trim()) { addClient(newName, newMkt, newCcy); setNewName(''); setAdding(false) } }}>Create</Button>
              <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        </Panel>
      )}

      <Panel padding="p-0" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-canvas-tint text-ink-mute text-2xs uppercase tracking-wider">
                <th className="text-left px-5 py-2.5 font-medium">Name</th>
                <th className="text-left px-3 py-2.5 font-medium">Marketplace</th>
                <th className="text-left px-3 py-2.5 font-medium">Currency</th>
                <th className="text-right px-3 py-2.5 font-medium">Reports</th>
                <th className="text-right px-3 py-2.5 font-medium">Scenarios</th>
                <th className="text-left px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 pr-5" />
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-sm text-ink-faint">No clients yet.</td></tr>
              )}
              {clients.map(c => {
                const b = state.bundles[c.id]
                const reports = b ? Object.keys(b.reports).length : 0
                const scenarios = b ? b.scenarios.length : 0
                const isCurrent = currentClient?.id === c.id
                return (
                  <tr key={c.id} className={cx('border-t border-line hover:bg-canvas-tint', isCurrent && 'bg-canvas-tint')}>
                    <td className="px-5 py-2.5">
                      {renameId === c.id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            value={renameVal}
                            onChange={e => setRenameVal(e.target.value)}
                            className="px-2 py-1 rounded-md border border-line text-sm"
                            autoFocus
                          />
                          <button className="text-[#1f7a4a] p-1" onClick={() => { renameClient(c.id, renameVal); setRenameId(null) }}><Check className="w-3.5 h-3.5" /></button>
                          <button className="text-ink-faint p-1" onClick={() => setRenameId(null)}><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-ink">{c.name}</span>
                          {isCurrent && <Pill tone="peri">Active</Pill>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">{c.marketplace}</td>
                    <td className="px-3 py-2.5">{c.currency}</td>
                    <td className="px-3 py-2.5 text-right tnum">{num(reports)}</td>
                    <td className="px-3 py-2.5 text-right tnum">{num(scenarios)}</td>
                    <td className="px-3 py-2.5">
                      <Pill tone={reports >= 2 ? 'mint' : reports > 0 ? 'gold' : 'mute'}>
                        {reports >= 2 ? 'Ready' : reports > 0 ? 'Partial' : 'Empty'}
                      </Pill>
                    </td>
                    <td className="px-3 py-2.5 pr-5 text-right">
                      <div className="inline-flex items-center gap-1">
                        {!isCurrent && (
                          <button onClick={() => switchClient(c.id)} className="text-xs text-ink-mute hover:text-ink px-2 py-1 rounded-md">Switch</button>
                        )}
                        <button onClick={() => { setRenameId(c.id); setRenameVal(c.name) }} className="text-ink-faint hover:text-ink p-1.5" aria-label="Rename"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => { setDeleteId(c.id); setDeleteConfirm('') }} className="text-ink-faint hover:text-[#9c4651] p-1.5" aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {currentBundle && (
        <Panel>
          <div className="flex items-end justify-between gap-3 mb-3 flex-wrap">
            <div>
              <h2 className="text-base font-semibold text-ink">Goals · {currentClient?.name}</h2>
              <p className="text-xs text-ink-mute mt-0.5">Drives risk colors, ad potential benchmarks, and scenario constraints.</p>
            </div>
            {realism && (
              <Pill tone={realism.level === 'good' ? 'mint' : realism.level === 'warn' ? 'gold' : 'blush'}>
                {realism.factors.length === 0 ? 'Awaiting data' : realism.feasible ? 'Goal feasible' : 'Goal at risk'}
              </Pill>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <TextField label="Monthly ad budget" type="number" prefix={curSym(currentClient!.currency)} value={currentBundle.goals.monthlyAdBudget} onChange={v => setGoals({ monthlyAdBudget: Number(v) || 0 })} />
            <TextField label="Primary TACOS goal" type="number" suffix="%" value={currentBundle.goals.primaryTacosGoal} onChange={v => setGoals({ primaryTacosGoal: Number(v) || 0 })} />
            <TextField label="Acceptable TACOS ceiling" type="number" suffix="%" value={currentBundle.goals.acceptableTacosCeiling} onChange={v => setGoals({ acceptableTacosCeiling: Number(v) || 0 })} />
            <TextField label="Target ROAS" type="number" step="0.1" suffix="×" value={currentBundle.goals.targetRoas} onChange={v => setGoals({ targetRoas: Number(v) || 0 })} />
            <TextField label="Minimum acceptable ROAS" type="number" step="0.1" suffix="×" value={currentBundle.goals.minimumAcceptableRoas} onChange={v => setGoals({ minimumAcceptableRoas: Number(v) || 0 })} />
            <TextField label="Current projected monthly sales" type="number" prefix={curSym(currentClient!.currency)} value={currentBundle.goals.currentProjectedMonthlySales} onChange={v => setGoals({ currentProjectedMonthlySales: Number(v) || 0 })} />
            <TextField label="Desired next-30-day sales" type="number" prefix={curSym(currentClient!.currency)} value={currentBundle.goals.desiredNext30DaySales} onChange={v => setGoals({ desiredNext30DaySales: Number(v) || 0 })} />
            <TextField label="Coupon goal" type="number" suffix="%" value={currentBundle.goals.couponGoal} onChange={v => setGoals({ couponGoal: Number(v) || 0 })} />
          </div>
          {realism && (
            <div className="mt-4 rounded-lg border border-line p-3 bg-canvas-tint">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-ink">Goal realism</h3>
                <Pill tone={realism.factors.length === 0 ? 'mute' : realism.level === 'good' ? 'mint' : realism.level === 'warn' ? 'gold' : 'blush'}>
                  {realism.factors.length === 0 ? 'Awaiting data' : realism.feasible ? 'Feasible' : 'At risk'}
                </Pill>
              </div>
              <p className="text-sm text-ink">{realism.message}</p>
              {realism.factors.length > 0 && (
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                  {realism.factors.map((f, i) => (
                    <div key={i} className="rounded-md bg-canvas-panel border border-line p-2">
                      <div className="text-2xs text-ink-faint">{f.label}</div>
                      <div className="text-sm tnum text-ink mt-0.5">{f.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Panel>
      )}

      {deleteId && (
        <DeleteModal
          name={state.bundles[deleteId]?.client.name ?? 'this client'}
          confirm={deleteConfirm}
          onConfirm={setDeleteConfirm}
          onCancel={() => { setDeleteId(null); setDeleteConfirm('') }}
          onDelete={() => { deleteClient(deleteId); setDeleteId(null); setDeleteConfirm('') }}
        />
      )}
    </div>
  )
}

function DeleteModal({ name, confirm, onConfirm, onCancel, onDelete }: { name: string; confirm: string; onConfirm: (v: string) => void; onCancel: () => void; onDelete: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 px-4">
      <Panel className="w-full max-w-md" padding="p-6">
        <h2 className="text-base font-semibold text-ink">Delete {name}?</h2>
        <p className="text-sm text-ink-mute mt-1">This removes all reports, scenarios, goals, and optimization history for this client. Type <code className="px-1 py-0.5 rounded bg-canvas-tint text-ink">DELETE</code> to confirm.</p>
        <TextField label="Type DELETE" value={confirm} onChange={onConfirm} className="mt-4" />
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="danger" disabled={confirm !== 'DELETE'} onClick={onDelete}>Delete client</Button>
        </div>
      </Panel>
    </div>
  )
}

function currencyFor(m: Marketplace): Currency {
  switch (m) {
    case 'US': return 'USD'; case 'CA': return 'CAD'; case 'MX': return 'MXN'
    case 'UK': return 'GBP'
    case 'DE': case 'FR': case 'ES': case 'IT': case 'NL': return 'EUR'
    case 'JP': return 'JPY'; case 'AU': return 'AUD'; case 'SE': return 'SEK'
    case 'PL': return 'PLN'; case 'TR': return 'TRY'; case 'AE': return 'AED'
    case 'IN': return 'INR'; case 'SG': return 'SGD'; case 'BR': return 'BRL'
  }
}

function curSym(c: Currency): string {
  const map: Record<string, string> = { USD:'$', EUR:'€', GBP:'£', CAD:'C$', MXN:'MX$', JPY:'¥', AUD:'A$', SEK:'kr', PLN:'zł', TRY:'₺', AED:'AED', INR:'₹', SGD:'S$', BRL:'R$' }
  return map[c] ?? '$'
}

// Suppress unused-import warnings for currency/percent in dev.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _u = [currency, percent]
