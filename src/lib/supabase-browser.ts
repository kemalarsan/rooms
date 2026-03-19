import { createClient } from '@supabase/supabase-js'
import { config } from './config'

// Browser-safe Supabase client (uses only NEXT_PUBLIC_ env vars)
export const supabase = createClient(config.supabase.url, config.supabase.anonKey)
