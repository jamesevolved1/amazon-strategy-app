import React, { useEffect, useState } from 'react'
import {
  BarChart3, LineChart, Boxes, Target, ClipboardCheck, CalendarDays, Upload, Users, Settings, Plus, ChevronsUpDown, Check, Trash2, PanelLeftClose, PanelLeftOpen, Megaphone, Zap,
} from 'lucide-react'
import { useStore } from '../lib/store'
import { cx } from './ui'
import type { Marketplace } from '../types'

export type PageId =
  | 'reporting' | 'actions' | 'campaigns' | 'pnl' | 'parent' | 'adPotential' | 'performance'
  | 'optimization' | 'upload' | 'clients' | 'settings'

interface Item {
  id: PageId
  label: string
  icon: React.ReactNode
}

const NAV: Item[] = [
  { id: 'reporting',    label: 'Reporting Dashboard', icon: <LineChart className="w-4 h-4" /> },
  { id: 'actions',      label: 'Action Center',        icon: <Zap className="w-4 h-4" /> },
  { id: 'campaigns',    label: 'Campaign Manager',     icon: <Megaphone className="w-4 h-4" /> },
  { id: 'pnl',          label: 'P&L Dashboard',        icon: <BarChart3 className="w-4 h-4" /> },
  { id: 'parent',       label: 'Parent ASIN P&L',      icon: <Boxes className="w-4 h-4" /> },
  { id: 'adPotential',  label: 'Ad Potential',         icon: <Target className="w-4 h-4" /> },
  { id: 'performance',  label: 'Performance Review',   icon: <ClipboardCheck className="w-4 h-4" /> },
  { id: 'optimization', label: 'Optimization Calendar', icon: <CalendarDays className="w-4 h-4" /> },
  { id: 'upload',       label: 'Upload Reports',        icon: <Upload className="w-4 h-4" /> },
  { id: 'clients',      label: 'Clients',               icon: <Users className="w-4 h-4" /> },
  { id: 'settings',     label: 'Settings',              icon: <Settings className="w-4 h-4" /> },
]

const COLLAPSE_KEY = 'asa.sidebar.collapsed'

export function Sidebar({
  current, onNavigate, forceExpanded,
}: { current: PageId; onNavigate: (p: PageId) => void; forceExpanded?: boolean }) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (forceExpanded) return false
    try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false }
  })

  useEffect(() => {
    if (forceExpanded) return
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0') } catch {}
  }, [collapsed, forceExpanded])

  const isCollapsed = collapsed && !forceExpanded

  return (
    <aside
      className={cx(
        'shrink-0 h-screen flex flex-col bg-canvas-panel border-r border-line transition-[width] duration-200 ease-out',
        isCollapsed ? 'w-[64px]' : 'w-[240px]',
      )}
    >
      <div className={cx('flex items-center gap-2 pt-5 pb-3', isCollapsed ? 'px-3 justify-center' : 'px-5')}>
        <span className="w-7 h-7 rounded-lg bg-ink flex items-center justify-center shrink-0">
          <svg viewBox="0 0 32 32" className="w-4 h-4">
            <path d="M9 21 L13 13 L19 18 L23 11" stroke="#9aa6f0" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="23" cy="11" r="1.8" fill="#a7d9b9" />
          </svg>
        </span>
        {!isCollapsed && (
          <div className="leading-tight flex-1 min-w-0">
            <div className="text-sm font-semibold text-ink truncate">Amazon Strategy</div>
            <div className="text-2xs text-ink-faint truncate">Profit · PPC · Plans</div>
          </div>
        )}
        {!forceExpanded && !isCollapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="p-1 -mr-1 rounded-md text-ink-faint hover:text-ink hover:bg-canvas-tint"
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
          >
            <PanelLeftClose className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {!forceExpanded && isCollapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="mx-2 mb-1 p-2 rounded-lg text-ink-faint hover:text-ink hover:bg-canvas-tint flex items-center justify-center"
          aria-label="Expand sidebar"
          title="Expand sidebar"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      )}

      <nav className={cx('flex-1 overflow-y-auto', isCollapsed ? 'px-2' : 'px-2 mt-2')}>
        {NAV.map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            title={isCollapsed ? item.label : undefined}
            className={cx(
              'w-full flex items-center my-0.5 rounded-lg text-sm transition-colors',
              isCollapsed ? 'h-9 justify-center' : 'gap-2.5 px-3 py-2',
              current === item.id ? 'bg-ink text-white' : 'text-ink-mute hover:text-ink hover:bg-[#f3f4f7]',
            )}
          >
            <span className={current === item.id ? 'text-white' : 'text-ink-faint'}>{item.icon}</span>
            {!isCollapsed && <span className="truncate">{item.label}</span>}
          </button>
        ))}
      </nav>

      <ClientSwitcher collapsed={isCollapsed} />
    </aside>
  )
}

function ClientSwitcher({ collapsed }: { collapsed: boolean }) {
  const { currentClient, clients, switchClient, addClient } = useStore()
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [marketplace, setMarketplace] = useState<Marketplace>('US')

  return (
    <div className={cx('border-t border-line relative', collapsed ? 'p-2' : 'p-3')}>
      <button
        onClick={() => { setOpen(o => !o); setAdding(false) }}
        className={cx(
          'w-full flex items-center rounded-lg hover:bg-[#f3f4f7]',
          collapsed ? 'p-1.5 justify-center' : 'gap-2 px-2 py-2',
        )}
        title={collapsed && currentClient ? currentClient.name : undefined}
      >
        <span className="w-7 h-7 rounded-md bg-ink text-white text-xs font-semibold flex items-center justify-center shrink-0">
          {currentClient ? currentClient.name.trim().slice(0, 2).toUpperCase() : '—'}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 text-left min-w-0">
              <span className="block text-sm font-medium text-ink truncate leading-tight">
                {currentClient ? currentClient.name : 'No client'}
              </span>
              <span className="block text-2xs text-ink-faint leading-tight">
                {currentClient ? `${currentClient.marketplace} · ${currentClient.currency}` : 'Add one to begin'}
              </span>
            </span>
            <ChevronsUpDown className="w-4 h-4 text-ink-faint" />
          </>
        )}
      </button>

      {open && (
        <div className={cx(
          'absolute bottom-full mb-2 rounded-xl border border-line bg-canvas-panel shadow-pop overflow-hidden z-30',
          collapsed ? 'left-2 right-auto w-64' : 'left-3 right-3',
        )}>
          <div className="max-h-60 overflow-y-auto">
            {clients.length === 0 && (
              <div className="px-3 py-3 text-xs text-ink-mute">No clients yet.</div>
            )}
            {clients.map(c => (
              <button
                key={c.id}
                onClick={() => { switchClient(c.id); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#f3f4f7]"
              >
                <span className="w-7 h-7 rounded-md bg-[#eef0f4] text-ink text-xs font-semibold flex items-center justify-center">
                  {c.name.trim().slice(0, 2).toUpperCase()}
                </span>
                <span className="flex-1">
                  <span className="block text-sm text-ink leading-tight">{c.name}</span>
                  <span className="block text-2xs text-ink-faint leading-tight">{c.marketplace} · {c.currency}</span>
                </span>
                {currentClient?.id === c.id && <Check className="w-4 h-4 text-ink" />}
              </button>
            ))}
          </div>
          <div className="border-t border-line p-2">
            {!adding && (
              <button
                onClick={() => setAdding(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-ink-mute hover:text-ink hover:bg-[#f3f4f7]"
              >
                <Plus className="w-4 h-4" />
                Add client
              </button>
            )}
            {adding && (
              <div className="space-y-2">
                <input
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Client name"
                  className="w-full px-2.5 py-1.5 rounded-md border border-line bg-canvas-panel text-sm focus:outline-none focus:ring-2 focus:ring-ink/15"
                />
                <select
                  value={marketplace}
                  onChange={e => setMarketplace(e.target.value as Marketplace)}
                  className="w-full px-2.5 py-1.5 rounded-md border border-line bg-canvas-panel text-sm"
                >
                  {(['US','CA','MX','UK','DE','FR','ES','IT','JP','AU','NL','SE','PL','TR','AE','IN','SG','BR'] as Marketplace[]).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (!name.trim()) return
                      const ccy = currencyFor(marketplace)
                      addClient(name, marketplace, ccy)
                      setName('')
                      setAdding(false)
                      setOpen(false)
                    }}
                    className="flex-1 bg-ink text-white text-sm rounded-md py-1.5"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => setAdding(false)}
                    className="px-3 text-sm text-ink-mute"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function currencyFor(m: Marketplace): import('../types').Currency {
  switch (m) {
    case 'US': return 'USD'
    case 'CA': return 'CAD'
    case 'MX': return 'MXN'
    case 'UK': return 'GBP'
    case 'DE': case 'FR': case 'ES': case 'IT': case 'NL': return 'EUR'
    case 'JP': return 'JPY'
    case 'AU': return 'AUD'
    case 'SE': return 'SEK'
    case 'PL': return 'PLN'
    case 'TR': return 'TRY'
    case 'AE': return 'AED'
    case 'IN': return 'INR'
    case 'SG': return 'SGD'
    case 'BR': return 'BRL'
  }
}

// Silence unused import warning.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _u = Trash2
