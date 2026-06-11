import React, { useEffect, useRef, useState } from 'react'
import { StoreProvider, useStore } from './lib/store'
import { AuthGate } from './components/AuthGate'
import { Sidebar, type PageId } from './components/Sidebar'
import { ReportingDashboard } from './pages/ReportingDashboard'
import { PnLDashboard } from './pages/PnLDashboard'
import { ParentASIN } from './pages/ParentASIN'
import { AdPotential } from './pages/AdPotential'
import { PerformanceReview } from './pages/PerformanceReview'
import { OptimizationCalendar } from './pages/OptimizationCalendar'
import { UploadReports } from './pages/UploadReports'
import { Clients } from './pages/Clients'
import { Settings } from './pages/Settings'
import { EmptyState, Button } from './components/ui'

const NAV_LABEL: Record<PageId, string> = {
  reporting: 'Reporting Dashboard',
  pnl: 'P&L Dashboard',
  parent: 'Parent ASIN P&L',
  adPotential: 'Ad Potential',
  performance: 'Performance Review',
  optimization: 'Optimization Calendar',
  upload: 'Upload Reports',
  clients: 'Clients',
  settings: 'Settings',
}

export default function App() {
  return (
    <StoreProvider>
      <AuthGate>
        <Shell />
      </AuthGate>
    </StoreProvider>
  )
}

function Shell() {
  const [page, setPage] = useState<PageId>(() => readHash())
  const [mobileNav, setMobileNav] = useState(false)
  const { clients, addClient, currentClient } = useStore()

  useEffect(() => {
    const onHash = () => setPage(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (location.hash !== `#/${page}`) location.hash = `/${page}`
  }, [page])

  // Auto-create a demo client on first run so the app is usable immediately.
  // Guard with a ref to survive React StrictMode's double-invocation in dev.
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current) return
    if (clients.length === 0) {
      seededRef.current = true
      addClient('My first client', 'US', 'USD')
    } else {
      seededRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen flex bg-canvas">
      {/* Mobile top bar */}
      <div className="lg:hidden fixed inset-x-0 top-0 z-40 h-12 bg-canvas-panel border-b border-line px-4 flex items-center justify-between">
        <button
          onClick={() => setMobileNav(true)}
          className="p-2 -ml-2 rounded-lg text-ink-mute hover:text-ink hover:bg-canvas-tint"
          aria-label="Open menu"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="text-sm font-medium text-ink">{NAV_LABEL[page]}</div>
        <div className="w-7" />
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar current={page} onNavigate={setPage} />
      </div>

      {/* Mobile drawer */}
      {mobileNav && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setMobileNav(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[260px]">
            <Sidebar current={page} onNavigate={(p) => { setPage(p); setMobileNav(false) }} forceExpanded />
          </div>
        </div>
      )}

      <main className="flex-1 min-w-0 px-4 lg:px-8 pt-16 lg:pt-8 pb-12 overflow-x-hidden">
        {!currentClient ? (
          <EmptyState
            title="Welcome"
            description="Start by adding a client from the Clients page."
            action={<Button onClick={() => setPage('clients')}>Go to Clients</Button>}
          />
        ) : (
          <PageRouter page={page} />
        )}
      </main>
    </div>
  )
}

function PageRouter({ page }: { page: PageId }) {
  switch (page) {
    case 'reporting':    return <ReportingDashboard />
    case 'pnl':          return <PnLDashboard />
    case 'parent':       return <ParentASIN />
    case 'adPotential':  return <AdPotential />
    case 'performance':  return <PerformanceReview />
    case 'optimization': return <OptimizationCalendar />
    case 'upload':       return <UploadReports />
    case 'clients':      return <Clients />
    case 'settings':     return <Settings />
  }
}

function readHash(): PageId {
  const h = (location.hash || '').replace(/^#\/?/, '')
  switch (h) {
    case 'reporting': case 'pnl': case 'parent': case 'adPotential':
    case 'performance': case 'optimization': case 'upload': case 'clients': case 'settings':
      return h
    default:
      return 'reporting'
  }
}
