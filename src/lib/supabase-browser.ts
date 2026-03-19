import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Browser-safe Supabase client (uses only NEXT_PUBLIC_ env vars)
// Lazy initialization to avoid build-time env var access
let _supabase: SupabaseClient | null = null

export function getSupabaseBrowser(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !anonKey) {
      throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
    }
    _supabase = createClient(url, anonKey)
  }
  return _supabase
}

// Legacy export for backward compatibility — lazy getter
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabaseBrowser() as any)[prop]
  }
})
