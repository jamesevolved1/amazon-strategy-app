// Lazy Supabase client. Activates only when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
// are present at build/runtime. Otherwise the app runs against localStorage only.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cached: SupabaseClient | null | undefined

export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!url || !key) {
    cached = null
    return null
  }
  cached = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  })
  return cached
}

export function isSupabaseConfigured(): boolean {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY)
}
