import React, { useMemo, useState } from 'react'
import {
  Calendar, Check, ChevronDown, ChevronRight, Plus, Sparkles, Trash2, X, Activity, Eraser, History,
} from 'lucide-react'
import { Panel, Pill, EmptyState, TextField, Button, cx, SegmentedControl } from '../components/ui'
import { useStore } from '../lib/store'
import { timestamp } from '../lib/format'
import {
  buildPlaybookTasks, CADENCE_LABEL, CADENCE_ORDER, CATEGORY_LABEL, CATEGORY_ORDER, CATEGORY_TONE,
  PLAYBOOK, scoreCoverage,
} from '../lib/playbook'
import type { Client, ClientBundle, OptCadence, OptCategory, OptimizationTask } from '../types'

type View = 'today' | 'coverage' | 'client'

export function OptimizationCalendar() {
  const {
    state, clients, currentClient,
    addTaskFor, addTasksFor, toggleTaskFor, deleteTaskFor, clearPlaybookFor,
  } = useStore()
  const [view, setView] = useState<View>('today')
  const [focusClientId, setFocusClientId] = useState<string | null>(currentClient?.id ?? null)

  if (clients.length === 0) {
    return <EmptyState title="Add a client first" description="The Optimization Calendar covers every client. Add clients in the Clients page to begin." />
  }

  const today = todayIso()

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Optimization Calendar</h1>
          <p className="text-sm text-ink-mute mt-0.5">
            Sophie Society playbook · {clients.length} {clients.length === 1 ? 'client' : 'clients'} · {today}
          </p>
        </div>
        <SegmentedControl<View>
          value={view}
          onChange={setView}
          options={[
            { id: 'today', label: 'Today across clients' },
            { id: 'coverage', label: 'Coverage grid' },
            { id: 'client', label: 'Per-client playbook' },
          ]}
        />
      </header>

      {view === 'today' && <TodayView state={state} clients={clients} onToggle={toggleTaskFor} onDelete={deleteTaskFor} />}

      {view === 'coverage' && (
        <CoverageGrid
          state={state}
          clients={clients}
          onFocusClient={(id) => { setFocusClientId(id); setView('client') }}
        />
      )}

      {view === 'client' && (
        <ClientPlaybook
          state={state}
          clients={clients}
          focusClientId={focusClientId ?? clients[0]?.id ?? null}
          setFocusClientId={setFocusClientId}
          onSeed={addTasksFor}
          onClear={clearPlaybookFor}
          onToggle={toggleTaskFor}
          onDelete={deleteTaskFor}
          onAdd={addTaskFor}
        />
      )}

      <CompletionLog state={state} />
    </div>
  )
}

// ---------- Today across clients ----------

function TodayView({
  state, clients, onToggle, onDelete,
}: {
  state: ReturnType<typeof useStore>['state']
  clients: Client[]
  onToggle: (clientId: string, taskId: string) => void
  onDelete: (clientId: string, taskId: string) => void
}) {
  const today = todayIso()

  const dueByClient = useMemo(() => {
    return clients.map(c => {
      const bundle = state.bundles[c.id]
      const tasks = bundle?.optimization ?? []
      const todayTasks = tasks.filter(t => !t.completed && t.due <= today)
      const overdue = todayTasks.filter(t => t.due < today)
      const dueToday = todayTasks.filter(t => t.due === today)
      const completedToday = tasks.filter(t => t.completed && (t.completedAt ?? '').slice(0, 10) === today)
      return { client: c, dueToday, overdue, completedToday }
    })
  }, [clients, state.bundles, today])

  const totalDue = dueByClient.reduce((n, x) => n + x.dueToday.length + x.overdue.length, 0)
  const totalDone = dueByClient.reduce((n, x) => n + x.completedToday.length, 0)

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-accent-periSoft text-[#3b48a5] flex items-center justify-center">
              <Activity className="w-4 h-4" />
            </span>
            <div>
              <div className="text-sm font-semibold text-ink">Your work this morning</div>
              <div className="text-xs text-ink-mute mt-0.5">
                {totalDue === 0
                  ? 'Inbox zero — every account is current.'
                  : `${totalDue} task${totalDue === 1 ? '' : 's'} open across ${dueByClient.filter(x => x.dueToday.length + x.overdue.length > 0).length} client${dueByClient.filter(x => x.dueToday.length + x.overdue.length > 0).length === 1 ? '' : 's'}. ${totalDone} done so far today.`}
              </div>
            </div>
          </div>
          <Pill tone={totalDue === 0 ? 'mint' : totalDue > 15 ? 'blush' : 'gold'}>
            {totalDue === 0 ? 'All clear' : `${totalDue} open`}
          </Pill>
        </div>
      </Panel>

      {dueByClient.length === 0 && <EmptyState title="Add a client" description="Then run the playbook seeder to populate the calendar." />}

      {dueByClient.map(({ client, dueToday, overdue, completedToday }) => {
        const total = dueToday.length + overdue.length
        if (total === 0 && completedToday.length === 0) {
          return (
            <Panel key={client.id} padding="p-3" className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-md bg-[#eef0f4] text-ink text-xs font-semibold flex items-center justify-center">
                  {client.name.trim().slice(0, 2).toUpperCase()}
                </span>
                <span className="text-sm text-ink-mute">{client.name}</span>
              </div>
              <Pill tone="mute">No tasks today</Pill>
            </Panel>
          )
        }
        return (
          <Panel key={client.id} padding="p-0" className="overflow-hidden">
            <div className="px-5 py-3 flex items-center justify-between border-b border-line">
              <div className="flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-md bg-ink text-white text-xs font-semibold flex items-center justify-center">
                  {client.name.trim().slice(0, 2).toUpperCase()}
                </span>
                <div>
                  <div className="text-sm font-semibold text-ink leading-tight">{client.name}</div>
                  <div className="text-2xs text-ink-faint leading-tight">{client.marketplace} · {client.currency}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {overdue.length > 0 && <Pill tone="blush">{overdue.length} overdue</Pill>}
                {dueToday.length > 0 && <Pill tone="peri">{dueToday.length} today</Pill>}
                {completedToday.length > 0 && <Pill tone="mint">{completedToday.length} done</Pill>}
              </div>
            </div>
            <div className="divide-y divide-line">
              {[...overdue, ...dueToday].map(t => (
                <TaskRow key={t.id} task={t} client={client} onToggle={() => onToggle(client.id, t.id)} onDelete={() => onDelete(client.id, t.id)} showOverdue />
              ))}
            </div>
          </Panel>
        )
      })}
    </div>
  )
}

// ---------- Coverage grid ----------

function CoverageGrid({
  state, clients, onFocusClient,
}: {
  state: ReturnType<typeof useStore>['state']
  clients: Client[]
  onFocusClient: (clientId: string) => void
}) {
  const cadences: OptCadence[] = ['daily', 'weekly', 'monthly', 'quarterly']
  const today = new Date()

  return (
    <Panel padding="p-0" className="overflow-hidden">
      <div className="px-5 py-4 border-b border-line">
        <h2 className="text-base font-semibold text-ink">Coverage grid</h2>
        <p className="text-xs text-ink-mute mt-0.5">Each cell shows the completion of this period's playbook for that client. Click a row to drill in.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-canvas-tint text-ink-mute text-2xs uppercase tracking-wider">
              <th className="text-left px-5 py-2.5 font-medium">Client</th>
              {cadences.map(c => <th key={c} className="text-center px-3 py-2.5 font-medium">{CADENCE_LABEL[c]}</th>)}
              <th className="text-right px-5 py-2.5 font-medium">Overall</th>
            </tr>
          </thead>
          <tbody>
            {clients.map(c => {
              const tasks = state.bundles[c.id]?.optimization ?? []
              const rows = cadences.map(cad => ({ cad, stat: scoreCoverage(tasks, cad, today) }))
              const totalExpected = rows.reduce((n, r) => n + r.stat.completed + r.stat.open + r.stat.overdue, 0)
              const totalDone = rows.reduce((n, r) => n + r.stat.completed, 0)
              const overall = totalExpected > 0 ? Math.round((totalDone / totalExpected) * 100) : null
              const playbookSeeded = tasks.some(t => t.templateKey)
              return (
                <tr key={c.id} className="border-t border-line hover:bg-canvas-tint cursor-pointer" onClick={() => onFocusClient(c.id)}>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <span className="w-7 h-7 rounded-md bg-[#eef0f4] text-ink text-xs font-semibold flex items-center justify-center">
                        {c.name.trim().slice(0, 2).toUpperCase()}
                      </span>
                      <div>
                        <div className="text-sm font-medium text-ink leading-tight">{c.name}</div>
                        <div className="text-2xs text-ink-faint leading-tight">{c.marketplace} · {c.currency}</div>
                      </div>
                      {!playbookSeeded && <Pill tone="mute">No playbook</Pill>}
                    </div>
                  </td>
                  {rows.map(r => <CoverageCell key={r.cad} stat={r.stat} />)}
                  <td className="px-5 py-3 text-right">
                    {overall == null
                      ? <span className="text-2xs text-ink-faint">—</span>
                      : <Pill tone={overall >= 80 ? 'mint' : overall >= 50 ? 'peri' : overall >= 25 ? 'gold' : 'blush'}>{overall}%</Pill>
                    }
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function CoverageCell({ stat }: { stat: { completed: number; open: number; overdue: number } }) {
  const total = stat.completed + stat.open + stat.overdue
  if (total === 0) return <td className="px-3 py-3 text-center text-2xs text-ink-faint">—</td>
  const pct = (stat.completed / total) * 100
  return (
    <td className="px-3 py-3 text-center">
      <div className="inline-flex flex-col items-center gap-1.5 min-w-[88px]">
        <div className="w-full h-1.5 rounded-full bg-[#f1f2f5] overflow-hidden">
          <div
            className={cx('h-full rounded-full', pct >= 80 ? 'bg-accent-mint' : pct >= 50 ? 'bg-accent-peri' : pct >= 25 ? 'bg-accent-gold' : 'bg-accent-blush')}
            style={{ width: `${Math.max(4, pct)}%` }}
          />
        </div>
        <div className="text-2xs text-ink-mute tnum">
          {stat.completed}/{total}
          {stat.overdue > 0 && <span className="ml-1 text-[#9c4651]">· {stat.overdue} late</span>}
        </div>
      </div>
    </td>
  )
}

// ---------- Per-client playbook ----------

function ClientPlaybook({
  state, clients, focusClientId, setFocusClientId, onSeed, onClear, onToggle, onDelete, onAdd,
}: {
  state: ReturnType<typeof useStore>['state']
  clients: Client[]
  focusClientId: string | null
  setFocusClientId: (id: string) => void
  onSeed: (clientId: string, tasks: OptimizationTask[]) => void
  onClear: (clientId: string) => void
  onToggle: (clientId: string, taskId: string) => void
  onDelete: (clientId: string, taskId: string) => void
  onAdd: (clientId: string, t: Omit<OptimizationTask, 'id' | 'createdAt' | 'clientId'>) => OptimizationTask | null
}) {
  const focusClient = focusClientId ? clients.find(c => c.id === focusClientId) ?? clients[0] : clients[0]
  const bundle: ClientBundle | undefined = focusClient ? state.bundles[focusClient.id] : undefined
  const tasks = bundle?.optimization ?? []
  const playbookSeeded = tasks.some(t => t.templateKey)

  const [filter, setFilter] = useState<OptCadence | 'all'>('all')
  const [showCompleted, setShowCompleted] = useState(false)

  const visible = useMemo(() => {
    let rows = tasks.slice()
    if (filter !== 'all') rows = rows.filter(t => t.cadence === filter)
    if (!showCompleted) rows = rows.filter(t => !t.completed)
    return rows.sort((a, b) => a.due.localeCompare(b.due))
  }, [tasks, filter, showCompleted])

  const byCadence = useMemo(() => {
    const m = new Map<OptCadence, OptimizationTask[]>()
    for (const t of visible) {
      const cad = (t.cadence ?? 'oneoff') as OptCadence
      if (!m.has(cad)) m.set(cad, [])
      m.get(cad)!.push(t)
    }
    return m
  }, [visible])

  return (
    <div className="space-y-4">
      <Panel>
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-ink text-white text-sm font-semibold flex items-center justify-center">
              {focusClient?.name.trim().slice(0, 2).toUpperCase() ?? '—'}
            </span>
            <div>
              <label className="block text-2xs uppercase tracking-wider text-ink-mute font-semibold mb-1">Focused client</label>
              <select
                value={focusClient?.id ?? ''}
                onChange={e => setFocusClientId(e.target.value)}
                className="text-sm font-semibold text-ink bg-transparent focus:outline-none cursor-pointer"
              >
                {clients.map(c => <option key={c.id} value={c.id}>{c.name} · {c.marketplace}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {focusClient && (
              <>
                <Button
                  icon={<Sparkles className="w-4 h-4" />}
                  onClick={() => {
                    const seed = buildPlaybookTasks(focusClient.id)
                    onSeed(focusClient.id, seed)
                  }}
                  variant={playbookSeeded ? 'secondary' : 'primary'}
                >
                  {playbookSeeded ? 'Top up playbook' : 'Apply Sophie Society playbook'}
                </Button>
                {playbookSeeded && (
                  <Button
                    icon={<Eraser className="w-4 h-4" />}
                    variant="ghost"
                    onClick={() => {
                      if (confirm(`Clear the Sophie Society playbook tasks for ${focusClient.name}? One-off tasks you added manually are kept.`)) {
                        onClear(focusClient.id)
                      }
                    }}
                  >
                    Clear playbook
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <SegmentedControl<OptCadence | 'all'>
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all', label: 'All cadences' },
              { id: 'daily', label: 'Daily' },
              { id: 'weekly', label: 'Weekly' },
              { id: 'monthly', label: 'Monthly' },
              { id: 'quarterly', label: 'Quarterly' },
              { id: 'oneoff', label: 'One-off' },
            ]}
          />
          <label className="ml-2 inline-flex items-center gap-1.5 text-2xs text-ink-mute cursor-pointer">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={e => setShowCompleted(e.target.checked)}
              className="accent-ink"
            />
            Show completed
          </label>
        </div>
      </Panel>

      {!playbookSeeded && tasks.length === 0 && (
        <Panel>
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-accent-goldSoft text-[#8b6a18] flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </span>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-ink">Apply the Sophie Society playbook</h3>
              <p className="text-sm text-ink-mute mt-1 leading-relaxed">
                Seeds {PLAYBOOK.length} pre-categorized tasks ({CATEGORY_ORDER.length} categories × Daily / Weekly / Monthly / Quarterly cadences) for this client, with due dates auto-set for the current period. You can edit, delete, or add custom tasks afterwards.
              </p>
            </div>
          </div>
        </Panel>
      )}

      {CADENCE_ORDER.map(cad => {
        if (filter !== 'all' && filter !== cad) return null
        const rows = byCadence.get(cad) ?? []
        if (rows.length === 0) return null
        return (
          <CadenceSection
            key={cad}
            cadence={cad}
            tasks={rows}
            client={focusClient!}
            onToggle={(taskId) => onToggle(focusClient!.id, taskId)}
            onDelete={(taskId) => onDelete(focusClient!.id, taskId)}
          />
        )
      })}

      {focusClient && <AddTaskInline clientId={focusClient.id} onAdd={onAdd} />}
    </div>
  )
}

function CadenceSection({
  cadence, tasks, client, onToggle, onDelete,
}: {
  cadence: OptCadence
  tasks: OptimizationTask[]
  client: Client
  onToggle: (taskId: string) => void
  onDelete: (taskId: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const byCategory = useMemo(() => {
    const m = new Map<OptCategory, OptimizationTask[]>()
    for (const t of tasks) {
      const cat = (t.category ?? 'additional') as OptCategory
      if (!m.has(cat)) m.set(cat, [])
      m.get(cat)!.push(t)
    }
    return m
  }, [tasks])

  return (
    <Panel padding="p-0" className="overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-5 py-3 border-b border-line"
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronRight className="w-4 h-4 text-ink-faint" /> : <ChevronDown className="w-4 h-4 text-ink-faint" />}
          <h3 className="text-sm font-semibold text-ink">{CADENCE_LABEL[cadence]}</h3>
          <Pill tone="mute">{tasks.length}</Pill>
        </div>
        <span className="text-2xs text-ink-faint">{client.name}</span>
      </button>
      {!collapsed && (
        <div>
          {CATEGORY_ORDER.map(cat => {
            const rows = byCategory.get(cat) ?? []
            if (rows.length === 0) return null
            return (
              <div key={cat} className="border-b border-line last:border-b-0">
                <div className="px-5 pt-3 pb-1.5 flex items-center gap-2">
                  <span className={cx('w-1.5 h-1.5 rounded-full', stripeBg(CATEGORY_TONE[cat]))} />
                  <span className="text-2xs uppercase tracking-wider font-semibold text-ink-mute">{CATEGORY_LABEL[cat]}</span>
                </div>
                <div>
                  {rows.map(t => (
                    <TaskRow key={t.id} task={t} client={client} onToggle={() => onToggle(t.id)} onDelete={() => onDelete(t.id)} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

function stripeBg(tone: 'peri' | 'lavender' | 'mint' | 'gold' | 'blush'): string {
  switch (tone) {
    case 'peri': return 'bg-accent-peri'
    case 'lavender': return 'bg-accent-lavender'
    case 'mint': return 'bg-accent-mint'
    case 'gold': return 'bg-accent-gold'
    case 'blush': return 'bg-accent-blush'
  }
}

// ---------- Task row ----------

function TaskRow({
  task, client, onToggle, onDelete, showOverdue,
}: {
  task: OptimizationTask
  client: Client
  onToggle: () => void
  onDelete: () => void
  showOverdue?: boolean
}) {
  const tone = task.category ? CATEGORY_TONE[task.category as OptCategory] : 'lavender'
  const overdue = !task.completed && task.due < todayIso()
  return (
    <div className="px-5 py-2.5 flex items-start gap-3 hover:bg-canvas-tint">
      <button
        onClick={onToggle}
        className={cx(
          'w-4 h-4 mt-0.5 rounded border flex items-center justify-center shrink-0',
          task.completed ? 'bg-ink border-ink' : 'bg-canvas-panel border-line hover:border-ink',
        )}
        aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
      >
        {task.completed && <Check className="w-3 h-3 text-white" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={cx('text-sm', task.completed ? 'text-ink-faint line-through' : 'text-ink')}>
          {task.title}
        </div>
        {task.detail && (
          <div className="text-2xs text-ink-mute mt-0.5">{task.detail}</div>
        )}
        <div className="mt-1 flex items-center flex-wrap gap-1.5 text-2xs">
          {task.category && <Pill tone={tone}>{CATEGORY_LABEL[task.category as OptCategory] ?? task.category}</Pill>}
          {task.cadence && task.cadence !== 'oneoff' && <Pill tone="mute">{CADENCE_LABEL[task.cadence]}</Pill>}
          {client && <span className="text-ink-faint tnum">· {client.name}</span>}
          <span className="text-ink-faint tnum">· due {task.due}</span>
          {showOverdue && overdue && <Pill tone="blush">overdue</Pill>}
          {task.completedAt && <span className="text-ink-faint">· done {timestamp(task.completedAt)}</span>}
        </div>
      </div>
      <button
        onClick={onDelete}
        className="text-ink-faint hover:text-[#9c4651] mt-0.5"
        aria-label="Delete task"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ---------- Add task inline ----------

function AddTaskInline({
  clientId, onAdd,
}: {
  clientId: string
  onAdd: (clientId: string, t: Omit<OptimizationTask, 'id' | 'createdAt' | 'clientId'>) => OptimizationTask | null
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')
  const [category, setCategory] = useState<OptCategory>('campaign')
  const [cadence, setCadence] = useState<OptCadence>('oneoff')
  const [due, setDue] = useState(todayIso())

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl2 border border-dashed border-line text-sm text-ink-mute hover:text-ink hover:bg-canvas-panel transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add a custom task for this client
      </button>
    )
  }

  return (
    <Panel>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink">Custom task</h3>
        <button onClick={() => setOpen(false)} className="text-ink-faint hover:text-ink">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
        <TextField className="md:col-span-5" label="Title" value={title} onChange={setTitle} placeholder="Negate non-converters in SP-Auto-Prospect" />
        <TextField className="md:col-span-5" label="Detail" value={detail} onChange={setDetail} placeholder="Threshold: 25+ clicks, 0 orders" />
        <TextField className="md:col-span-2" label="Due" type="date" value={due} onChange={setDue} />
        <label className="md:col-span-3 block">
          <span className="block text-xs font-medium text-ink-mute mb-1.5">Category</span>
          <select value={category} onChange={e => setCategory(e.target.value as OptCategory)} className="w-full rounded-lg border border-line bg-canvas-panel text-sm px-3 py-2">
            {CATEGORY_ORDER.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </label>
        <label className="md:col-span-3 block">
          <span className="block text-xs font-medium text-ink-mute mb-1.5">Cadence</span>
          <select value={cadence} onChange={e => setCadence(e.target.value as OptCadence)} className="w-full rounded-lg border border-line bg-canvas-panel text-sm px-3 py-2">
            {CADENCE_ORDER.map(c => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
          </select>
        </label>
        <div className="md:col-span-6 flex items-end gap-2">
          <Button
            onClick={() => {
              if (!title.trim()) return
              onAdd(clientId, {
                title: title.trim(),
                detail: detail.trim() || undefined,
                due,
                completed: false,
                category,
                cadence,
              })
              setTitle(''); setDetail('')
            }}
            icon={<Plus className="w-4 h-4" />}
          >
            Add task
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </div>
    </Panel>
  )
}

// ---------- Completion log ----------

function CompletionLog({ state }: { state: ReturnType<typeof useStore>['state'] }) {
  const log = useMemo(() => {
    const all: Array<{ task: OptimizationTask; clientName: string }> = []
    for (const id of state.clientOrder) {
      const b = state.bundles[id]
      if (!b) continue
      for (const t of b.optimization) {
        if (t.completed && t.completedAt) all.push({ task: t, clientName: b.client.name })
      }
    }
    return all.sort((a, b) => (b.task.completedAt ?? '').localeCompare(a.task.completedAt ?? ''))
  }, [state])

  if (log.length === 0) return null

  return (
    <Panel padding="p-0" className="overflow-hidden">
      <div className="px-5 py-3 flex items-center justify-between border-b border-line">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-ink-mute" />
          <h2 className="text-sm font-semibold text-ink">Recent completions</h2>
          <Pill tone="mute">{log.length}</Pill>
        </div>
        <span className="text-2xs text-ink-faint">Across all clients</span>
      </div>
      <div className="divide-y divide-line">
        {log.slice(0, 25).map(({ task, clientName }) => (
          <div key={task.id} className="px-5 py-2.5 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <Check className="w-3.5 h-3.5 text-[#1f7a4a] mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm text-ink truncate">{task.title}</div>
                <div className="text-2xs text-ink-faint mt-0.5 flex items-center gap-1.5 flex-wrap">
                  <span>{clientName}</span>
                  {task.category && <Pill tone={CATEGORY_TONE[task.category as OptCategory]}>{CATEGORY_LABEL[task.category as OptCategory]}</Pill>}
                  {task.cadence && task.cadence !== 'oneoff' && <Pill tone="mute">{CADENCE_LABEL[task.cadence]}</Pill>}
                </div>
              </div>
            </div>
            <span className="text-2xs text-ink-faint tnum shrink-0">{timestamp(task.completedAt)}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ---------- Utils ----------

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Silence unused-import warning for Calendar icon (used in older revisions).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _u = Calendar
