import React, { useMemo, useState } from 'react'
import { Calendar, Check, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { Panel, Pill, EmptyState, TextField, Button, cx } from '../components/ui'
import { useStore } from '../lib/store'
import { timestamp } from '../lib/format'

export function OptimizationCalendar() {
  const { currentClient, currentBundle, addTask, updateTask, toggleTask, deleteTask } = useStore()
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set())
  const [newTitle, setNewTitle] = useState('')
  const [newDetail, setNewDetail] = useState('')
  const [newDue, setNewDue] = useState(today())
  const [newCategory, setNewCategory] = useState('')

  if (!currentClient || !currentBundle) return <EmptyState title="No client selected" />

  const tasks = currentBundle.optimization
  const byDay = useMemo(() => groupByDay(tasks), [tasks])

  const dayKeys = Array.from(byDay.keys()).sort()
  const todayKey = today()
  const todayList = byDay.get(todayKey) ?? []
  const upcoming = dayKeys.filter(d => d > todayKey)
  const past = dayKeys.filter(d => d < todayKey)

  const log = useMemo(() => tasks.filter(t => t.completed && t.completedAt).sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')), [tasks])

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-ink">Optimization Calendar</h1>
          <p className="text-sm text-ink-mute mt-0.5">
            {todayList.length === 0 ? 'No tasks scheduled for today.' : `${todayList.filter(t => !t.completed).length} of ${todayList.length} open today.`}
          </p>
        </div>
        <Pill tone="peri">{currentClient.name}</Pill>
      </header>

      <Panel>
        <h2 className="text-base font-semibold text-ink mb-3">Add task</h2>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <TextField className="md:col-span-4" label="Title" value={newTitle} onChange={setNewTitle} placeholder="Negate non-converters in SP-Auto-Prospect" />
          <TextField className="md:col-span-4" label="Detail" value={newDetail} onChange={setNewDetail} placeholder="Threshold: 25+ clicks, 0 orders" />
          <TextField className="md:col-span-2" label="Due" type="date" value={newDue} onChange={setNewDue} />
          <TextField className="md:col-span-1" label="Category" value={newCategory} onChange={setNewCategory} placeholder="PPC" />
          <div className="md:col-span-1 flex items-end">
            <Button
              onClick={() => {
                if (!newTitle.trim()) return
                addTask({ title: newTitle.trim(), detail: newDetail.trim() || undefined, due: newDue, category: newCategory.trim() || undefined, completed: false })
                setNewTitle(''); setNewDetail(''); setNewCategory('')
              }}
              icon={<Plus className="w-4 h-4" />}
              className="w-full justify-center"
            >
              Add
            </Button>
          </div>
        </div>
      </Panel>

      <DaySection title={`Today · ${todayKey}`} tasks={todayList} tone="peri"
        onToggle={toggleTask} onDelete={deleteTask} onUpdate={updateTask}
        collapsed={collapsedDays.has(todayKey)} onCollapse={() => toggleSet(collapsedDays, todayKey, setCollapsedDays)}
      />

      {upcoming.map(d => (
        <DaySection
          key={d} title={`${d}`} tasks={byDay.get(d) ?? []} tone="lavender"
          onToggle={toggleTask} onDelete={deleteTask} onUpdate={updateTask}
          collapsed={collapsedDays.has(d)} onCollapse={() => toggleSet(collapsedDays, d, setCollapsedDays)}
        />
      ))}

      {past.length > 0 && (
        <DaySection
          title="Past due" tasks={past.flatMap(d => byDay.get(d) ?? []).filter(t => !t.completed)} tone="blush"
          onToggle={toggleTask} onDelete={deleteTask} onUpdate={updateTask}
          collapsed={collapsedDays.has('past')} onCollapse={() => toggleSet(collapsedDays, 'past', setCollapsedDays)}
        />
      )}

      <Panel>
        <h2 className="text-base font-semibold text-ink mb-3">Completion log</h2>
        {log.length === 0 ? (
          <p className="text-sm text-ink-faint">No completions yet.</p>
        ) : (
          <div className="divide-y divide-line text-sm">
            {log.slice(0, 50).map(t => (
              <div key={t.id} className="py-2 flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Check className="w-3.5 h-3.5 text-[#1f7a4a]" />
                    <span className="text-ink">{t.title}</span>
                    {t.category && <Pill tone="peri">{t.category}</Pill>}
                  </div>
                  {t.detail && <div className="text-xs text-ink-mute ml-5 mt-0.5">{t.detail}</div>}
                </div>
                <span className="text-2xs text-ink-faint tnum shrink-0">{timestamp(t.completedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

function toggleSet(s: Set<string>, key: string, setter: (s: Set<string>) => void) {
  const next = new Set(s)
  if (next.has(key)) next.delete(key); else next.add(key)
  setter(next)
}

function DaySection({
  title, tasks, tone, collapsed, onCollapse, onToggle, onDelete, onUpdate,
}: {
  title: string
  tasks: import('../types').OptimizationTask[]
  tone: 'peri' | 'lavender' | 'blush'
  collapsed: boolean
  onCollapse: () => void
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  onUpdate: (id: string, patch: Partial<import('../types').OptimizationTask>) => void
}) {
  if (tasks.length === 0) return null
  return (
    <Panel padding="p-0">
      <button onClick={onCollapse} className="w-full flex items-center justify-between px-5 py-3">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-ink-mute" />
          <span className="text-sm font-semibold text-ink">{title}</span>
          <Pill tone={tone}>{tasks.length}</Pill>
        </div>
        {collapsed ? <ChevronDown className="w-4 h-4 text-ink-faint" /> : <ChevronUp className="w-4 h-4 text-ink-faint" />}
      </button>
      {!collapsed && (
        <div className="border-t border-line divide-y divide-line">
          {tasks.map(t => (
            <div key={t.id} className="px-5 py-3 flex items-start gap-3">
              <button
                onClick={() => onToggle(t.id)}
                className={cx(
                  'w-4 h-4 mt-0.5 rounded border flex items-center justify-center shrink-0',
                  t.completed ? 'bg-ink border-ink' : 'bg-canvas-panel border-line hover:border-ink',
                )}
                aria-label={t.completed ? 'Mark incomplete' : 'Mark complete'}
              >
                {t.completed && <Check className="w-3 h-3 text-white" />}
              </button>
              <div className="flex-1 min-w-0">
                <input
                  value={t.title}
                  onChange={e => onUpdate(t.id, { title: e.target.value })}
                  className={cx(
                    'w-full bg-transparent text-sm focus:outline-none',
                    t.completed ? 'text-ink-faint line-through' : 'text-ink',
                  )}
                />
                {t.detail !== undefined && (
                  <textarea
                    value={t.detail ?? ''}
                    rows={1}
                    onChange={e => onUpdate(t.id, { detail: e.target.value })}
                    placeholder="Add detail..."
                    className="w-full mt-0.5 bg-transparent text-xs text-ink-mute focus:outline-none resize-none"
                  />
                )}
                {t.completedAt && (
                  <div className="text-2xs text-ink-faint mt-1">Completed {timestamp(t.completedAt)}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {t.category && <Pill tone="peri">{t.category}</Pill>}
                <button
                  onClick={() => onDelete(t.id)}
                  className="text-ink-faint hover:text-[#9c4651]"
                  aria-label="Delete task"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function groupByDay(tasks: import('../types').OptimizationTask[]): Map<string, import('../types').OptimizationTask[]> {
  const m = new Map<string, import('../types').OptimizationTask[]>()
  for (const t of tasks) {
    if (!m.has(t.due)) m.set(t.due, [])
    m.get(t.due)!.push(t)
  }
  return m
}
