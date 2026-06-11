// Client + per-client state. localStorage as primary; Supabase as optional mirror.
// Persists all client-specific data: reports, goals, scenarios, optimization history.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type {
  Client,
  ClientBundle,
  ClientGoals,
  OptimizationTask,
  ReportKey,
  Scenario,
  UploadedReport,
} from '../types'
import { getSupabase, isSupabaseConfigured } from './supabase'

const LS_KEY = 'asa.state.v1'

interface PersistedShape {
  clientOrder: string[]
  currentClientId: string | null
  bundles: Record<string, ClientBundle>
}

function defaultGoals(): ClientGoals {
  return {
    monthlyAdBudget: 0,
    primaryTacosGoal: 12,
    acceptableTacosCeiling: 18,
    targetRoas: 5,
    minimumAcceptableRoas: 3,
    currentProjectedMonthlySales: 0,
    desiredNext30DaySales: 0,
    couponGoal: 5,
  }
}

function defaultBundle(client: Client): ClientBundle {
  return {
    client,
    goals: defaultGoals(),
    scenarios: [
      {
        id: cryptoRandomId(),
        name: 'Baseline',
        adSpendMultiplier: 1,
        cogsAdjustment: 0,
        priceAdjustment: 0,
        couponRateOverride: null,
        createdAt: new Date().toISOString(),
      },
    ],
    activeScenarioId: null,
    reports: {},
    optimization: [],
  }
}

function load(): PersistedShape {
  if (typeof window === 'undefined') return { clientOrder: [], currentClientId: null, bundles: {} }
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return { clientOrder: [], currentClientId: null, bundles: {} }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { clientOrder: [], currentClientId: null, bundles: {} }
    return {
      clientOrder: Array.isArray(parsed.clientOrder) ? parsed.clientOrder : [],
      currentClientId: typeof parsed.currentClientId === 'string' ? parsed.currentClientId : null,
      bundles: parsed.bundles && typeof parsed.bundles === 'object' ? parsed.bundles : {},
    }
  } catch {
    return { clientOrder: [], currentClientId: null, bundles: {} }
  }
}

function save(state: PersistedShape) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state))
  } catch {
    // Storage quota — silently ignore; UI never crashes on persist.
  }
}

export function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
}

interface StoreCtx {
  state: PersistedShape
  currentClient: Client | null
  currentBundle: ClientBundle | null
  clients: Client[]
  supabaseConfigured: boolean

  // client mgmt
  addClient: (name: string, marketplace: Client['marketplace'], currency: Client['currency']) => Client
  renameClient: (id: string, name: string) => void
  deleteClient: (id: string) => void
  switchClient: (id: string) => void

  // goals
  setGoals: (g: Partial<ClientGoals>) => void

  // scenarios
  addScenario: (s: Omit<Scenario, 'id' | 'createdAt'>) => Scenario
  updateScenario: (id: string, patch: Partial<Omit<Scenario, 'id' | 'createdAt'>>) => void
  deleteScenario: (id: string) => void
  setActiveScenario: (id: string | null) => void

  // reports
  setReport: (key: ReportKey, report: UploadedReport) => void
  clearReport: (key: ReportKey) => void
  clearAllReports: () => void

  // optimization
  addTask: (t: Omit<OptimizationTask, 'id' | 'createdAt' | 'clientId'>) => OptimizationTask
  updateTask: (id: string, patch: Partial<OptimizationTask>) => void
  toggleTask: (id: string) => void
  deleteTask: (id: string) => void
}

const Ctx = createContext<StoreCtx | null>(null)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PersistedShape>(() => load())

  useEffect(() => { save(state) }, [state])

  // Optional Supabase mirror — fire-and-forget upsert on each save.
  useEffect(() => {
    if (!isSupabaseConfigured()) return
    const sb = getSupabase()
    if (!sb) return
    const t = setTimeout(() => {
      sb.from('app_state').upsert({ id: 'singleton', payload: state, updated_at: new Date().toISOString() }).then(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [state])

  // First-time hydration from Supabase if local is empty.
  useEffect(() => {
    if (!isSupabaseConfigured()) return
    const sb = getSupabase()
    if (!sb) return
    if (state.clientOrder.length > 0) return
    sb.from('app_state').select('payload').eq('id', 'singleton').single().then(({ data }) => {
      if (data?.payload) {
        setState(data.payload as PersistedShape)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentClient = state.currentClientId ? state.bundles[state.currentClientId]?.client ?? null : null
  const currentBundle = state.currentClientId ? state.bundles[state.currentClientId] ?? null : null
  const clients = state.clientOrder.map(id => state.bundles[id]?.client).filter(Boolean) as Client[]

  const update = useCallback((fn: (s: PersistedShape) => PersistedShape) => {
    setState(prev => fn(prev))
  }, [])

  const updateBundle = useCallback((fn: (b: ClientBundle) => ClientBundle) => {
    setState(prev => {
      if (!prev.currentClientId) return prev
      const existing = prev.bundles[prev.currentClientId]
      if (!existing) return prev
      return { ...prev, bundles: { ...prev.bundles, [prev.currentClientId]: fn(existing) } }
    })
  }, [])

  const addClient: StoreCtx['addClient'] = useCallback((name, marketplace, currency) => {
    const client: Client = {
      id: cryptoRandomId(),
      name: name.trim() || 'Untitled client',
      marketplace,
      currency,
      createdAt: new Date().toISOString(),
    }
    setState(prev => ({
      clientOrder: [...prev.clientOrder, client.id],
      currentClientId: prev.currentClientId ?? client.id,
      bundles: { ...prev.bundles, [client.id]: defaultBundle(client) },
    }))
    return client
  }, [])

  const renameClient: StoreCtx['renameClient'] = useCallback((id, name) => {
    update(prev => {
      const b = prev.bundles[id]
      if (!b) return prev
      return { ...prev, bundles: { ...prev.bundles, [id]: { ...b, client: { ...b.client, name: name.trim() || b.client.name } } } }
    })
  }, [update])

  const deleteClient: StoreCtx['deleteClient'] = useCallback((id) => {
    update(prev => {
      const order = prev.clientOrder.filter(x => x !== id)
      const bundles = { ...prev.bundles }
      delete bundles[id]
      const currentClientId = prev.currentClientId === id ? (order[0] ?? null) : prev.currentClientId
      return { clientOrder: order, currentClientId, bundles }
    })
  }, [update])

  const switchClient: StoreCtx['switchClient'] = useCallback((id) => {
    update(prev => prev.bundles[id] ? { ...prev, currentClientId: id } : prev)
  }, [update])

  const setGoals: StoreCtx['setGoals'] = useCallback((g) => {
    updateBundle(b => ({ ...b, goals: { ...b.goals, ...g } }))
  }, [updateBundle])

  const addScenario: StoreCtx['addScenario'] = useCallback((s) => {
    const scenario: Scenario = { ...s, id: cryptoRandomId(), createdAt: new Date().toISOString() }
    updateBundle(b => ({ ...b, scenarios: [...b.scenarios, scenario] }))
    return scenario
  }, [updateBundle])

  const updateScenario: StoreCtx['updateScenario'] = useCallback((id, patch) => {
    updateBundle(b => ({ ...b, scenarios: b.scenarios.map(x => x.id === id ? { ...x, ...patch } : x) }))
  }, [updateBundle])

  const deleteScenario: StoreCtx['deleteScenario'] = useCallback((id) => {
    updateBundle(b => ({
      ...b,
      scenarios: b.scenarios.filter(x => x.id !== id),
      activeScenarioId: b.activeScenarioId === id ? null : b.activeScenarioId,
    }))
  }, [updateBundle])

  const setActiveScenario: StoreCtx['setActiveScenario'] = useCallback((id) => {
    updateBundle(b => ({ ...b, activeScenarioId: id }))
  }, [updateBundle])

  const setReport: StoreCtx['setReport'] = useCallback((key, report) => {
    updateBundle(b => ({ ...b, reports: { ...b.reports, [key]: report } }))
  }, [updateBundle])

  const clearReport: StoreCtx['clearReport'] = useCallback((key) => {
    updateBundle(b => {
      const reports = { ...b.reports }
      delete reports[key]
      return { ...b, reports }
    })
  }, [updateBundle])

  const clearAllReports: StoreCtx['clearAllReports'] = useCallback(() => {
    updateBundle(b => ({ ...b, reports: {} }))
  }, [updateBundle])

  const addTask: StoreCtx['addTask'] = useCallback((t) => {
    const task: OptimizationTask = {
      ...t,
      id: cryptoRandomId(),
      createdAt: new Date().toISOString(),
      clientId: state.currentClientId ?? '',
    }
    updateBundle(b => ({ ...b, optimization: [task, ...b.optimization] }))
    return task
  }, [state.currentClientId, updateBundle])

  const updateTask: StoreCtx['updateTask'] = useCallback((id, patch) => {
    updateBundle(b => ({ ...b, optimization: b.optimization.map(t => t.id === id ? { ...t, ...patch } : t) }))
  }, [updateBundle])

  const toggleTask: StoreCtx['toggleTask'] = useCallback((id) => {
    updateBundle(b => ({
      ...b,
      optimization: b.optimization.map(t => {
        if (t.id !== id) return t
        const completed = !t.completed
        return { ...t, completed, completedAt: completed ? new Date().toISOString() : undefined }
      }),
    }))
  }, [updateBundle])

  const deleteTask: StoreCtx['deleteTask'] = useCallback((id) => {
    updateBundle(b => ({ ...b, optimization: b.optimization.filter(t => t.id !== id) }))
  }, [updateBundle])

  const ctx = useMemo<StoreCtx>(() => ({
    state, currentClient, currentBundle, clients,
    supabaseConfigured: isSupabaseConfigured(),
    addClient, renameClient, deleteClient, switchClient,
    setGoals,
    addScenario, updateScenario, deleteScenario, setActiveScenario,
    setReport, clearReport, clearAllReports,
    addTask, updateTask, toggleTask, deleteTask,
  }), [state, currentClient, currentBundle, clients,
       addClient, renameClient, deleteClient, switchClient,
       setGoals,
       addScenario, updateScenario, deleteScenario, setActiveScenario,
       setReport, clearReport, clearAllReports,
       addTask, updateTask, toggleTask, deleteTask])

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
}

export function useStore(): StoreCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStore must be used inside <StoreProvider>')
  return v
}
