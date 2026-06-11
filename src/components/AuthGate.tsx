import React, { useEffect, useState } from 'react'
import { getSupabase, isSupabaseConfigured } from '../lib/supabase'
import { Button, Panel, Spinner, TextField } from './ui'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const supabase = getSupabase()
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'sign_in' | 'sign_up'>('sign_in')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase) { setReady(true); return }
    supabase.auth.getSession().then(({ data }) => {
      setSignedIn(!!data.session)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session)
    })
    return () => { sub.subscription.unsubscribe() }
  }, [supabase])

  if (!isSupabaseConfigured()) {
    return <>{children}</>
  }

  if (!ready) {
    return <div className="h-screen w-screen flex items-center justify-center bg-canvas"><Spinner size={24} /></div>
  }

  if (signedIn) return <>{children}</>

  const submit = async () => {
    if (!supabase) return
    setBusy(true); setErr(null)
    try {
      if (mode === 'sign_in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
      <Panel className="w-full max-w-sm" padding="p-7">
        <div className="flex items-center gap-2 mb-5">
          <span className="w-8 h-8 rounded-lg bg-ink flex items-center justify-center">
            <svg viewBox="0 0 32 32" className="w-4 h-4">
              <path d="M9 21 L13 13 L19 18 L23 11" stroke="#9aa6f0" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="23" cy="11" r="1.8" fill="#a7d9b9" />
            </svg>
          </span>
          <div>
            <div className="text-sm font-semibold text-ink leading-tight">Amazon Strategy</div>
            <div className="text-2xs text-ink-faint">Sign in to continue</div>
          </div>
        </div>
        <div className="space-y-3">
          <TextField label="Email" type="email" value={email} onChange={setEmail} placeholder="you@agency.com" />
          <TextField label="Password" type="password" value={password} onChange={setPassword} />
          {err && <p className="text-xs text-[#9c4651] bg-accent-blushSoft border border-accent-blush/30 rounded-md px-2.5 py-1.5">{err}</p>}
          <Button onClick={submit} disabled={busy} className="w-full justify-center">
            {busy ? <Spinner size={14} /> : (mode === 'sign_in' ? 'Sign in' : 'Create account')}
          </Button>
          <button
            type="button"
            onClick={() => setMode(mode === 'sign_in' ? 'sign_up' : 'sign_in')}
            className="block w-full text-center text-xs text-ink-mute hover:text-ink"
          >
            {mode === 'sign_in' ? 'No account? Sign up' : 'Have an account? Sign in'}
          </button>
        </div>
      </Panel>
    </div>
  )
}
