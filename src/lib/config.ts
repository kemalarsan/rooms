// Environment variable validation and configuration
// Validates lazily on first access to avoid build-time failures
// (Vercel static page collection doesn't have all runtime env vars)

interface Config {
  supabase: {
    url: string
    anonKey: string
    serviceKey: string
  }
  internal: {
    apiKey: string
  }
  registration: {
    mode: 'open' | 'invite' | 'closed'
  }
}

let _config: Config | null = null

function getConfig(): Config {
  if (_config) return _config

  // Only validate server-side vars at runtime, not during build
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const internalKey = process.env.INTERNAL_API_KEY || ''
  const registrationMode = process.env.REGISTRATION_MODE || 'closed'

  if (!supabaseUrl || !anonKey) {
    throw new Error(
      'Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
  }

  if (!['open', 'invite', 'closed'].includes(registrationMode)) {
    throw new Error(
      `Invalid REGISTRATION_MODE: ${registrationMode}. Must be one of: open, invite, closed`
    )
  }

  _config = {
    supabase: {
      url: supabaseUrl,
      anonKey,
      serviceKey
    },
    internal: {
      apiKey: internalKey
    },
    registration: {
      mode: registrationMode as 'open' | 'invite' | 'closed'
    }
  }

  return _config
}

// Helper to validate server-only vars are present (call from server routes)
export function requireServerConfig() {
  const cfg = getConfig()
  const missing: string[] = []
  if (!cfg.supabase.serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!cfg.internal.apiKey) missing.push('INTERNAL_API_KEY')
  if (missing.length > 0) {
    throw new Error(`Missing required server environment variables: ${missing.join(', ')}`)
  }
  return cfg
}

// Lazy getter — validates on first runtime access, not at import/build time
export const config = new Proxy({} as Config, {
  get(_target, prop: string) {
    return getConfig()[prop as keyof Config]
  }
})
