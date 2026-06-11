import React from 'react'
import { Database, Github, Cloud, LogOut } from 'lucide-react'
import { Panel, Pill, Button } from '../components/ui'
import { useStore } from '../lib/store'
import { getSupabase, isSupabaseConfigured } from '../lib/supabase'

export function Settings() {
  const { supabaseConfigured, clients } = useStore()
  const onSignOut = async () => {
    const sb = getSupabase()
    if (!sb) return
    await sb.auth.signOut()
    location.reload()
  }
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-ink">Settings</h1>
        <p className="text-sm text-ink-mute mt-0.5">Environment, persistence, and account.</p>
      </header>

      <Panel>
        <div className="flex items-center gap-3 mb-3">
          <Cloud className="w-4 h-4 text-ink-mute" />
          <h2 className="text-base font-semibold text-ink">Persistence</h2>
          {supabaseConfigured
            ? <Pill tone="mint">Supabase + localStorage</Pill>
            : <Pill tone="gold">localStorage only</Pill>}
        </div>
        <p className="text-sm text-ink-mute leading-relaxed">
          {supabaseConfigured
            ? 'Your reports, scenarios, goals, and optimization history are mirrored to Supabase under your account. Switching devices is supported once signed in.'
            : 'Data lives in this browser only. To sync across devices, set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment and re-deploy.'}
        </p>
        <div className="mt-3 text-xs text-ink-mute tnum">
          {clients.length} {clients.length === 1 ? 'client' : 'clients'} stored locally.
        </div>
        {isSupabaseConfigured() && (
          <div className="mt-3">
            <Button variant="secondary" icon={<LogOut className="w-4 h-4" />} onClick={onSignOut}>Sign out</Button>
          </div>
        )}
      </Panel>

      <Panel>
        <div className="flex items-center gap-3 mb-3">
          <Database className="w-4 h-4 text-ink-mute" />
          <h2 className="text-base font-semibold text-ink">Report file safety</h2>
        </div>
        <ul className="text-sm text-ink-mute space-y-1.5 list-disc pl-5">
          <li>Files never leave the browser. Parsing happens entirely in the client.</li>
          <li>Only the parsed numeric rows are persisted — not the original file bytes.</li>
          <li>A signed-in Supabase session scopes data to your user via row-level security.</li>
        </ul>
      </Panel>

      <Panel>
        <div className="flex items-center gap-3 mb-3">
          <Github className="w-4 h-4 text-ink-mute" />
          <h2 className="text-base font-semibold text-ink">Deployment</h2>
        </div>
        <p className="text-sm text-ink-mute leading-relaxed">
          Hosted on GitHub Pages from the <code className="text-ink px-1 py-0.5 bg-canvas-tint rounded">main</code> branch via GitHub Actions. The build base path is set in <code className="text-ink px-1 py-0.5 bg-canvas-tint rounded">vite.config.ts</code>.
        </p>
      </Panel>
    </div>
  )
}
