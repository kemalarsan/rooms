// Environment variable validation and configuration
// Validates lazily on first access to avoid build-time failures
// (Vercel static page collection doesn't have runtime env vars)

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

function validateAndGetConfig(): Config {
  if (_config) return _config

  const requiredEnvVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'INTERNAL_API_KEY'
  ]

  const missing: string[] = []
  
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      missing.push(envVar)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env.local file and ensure all required variables are set.'
    )
  }

  // Validate registration mode
  const registrationMode = process.env.REGISTRATION_MODE || 'closed'
  if (!['open', 'invite', 'closed'].includes(registrationMode)) {
    throw new Error(
      `Invalid REGISTRATION_MODE: ${registrationMode}. Must be one of: open, invite, closed`
    )
  }

  _config = {
    supabase: {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY!
    },
    internal: {
      apiKey: process.env.INTERNAL_API_KEY!
    },
    registration: {
      mode: registrationMode as 'open' | 'invite' | 'closed'
    }
  }

  return _config
}

// Lazy getter — validates on first runtime access, not at import/build time
export const config = new Proxy({} as Config, {
  get(_target, prop: string) {
    return validateAndGetConfig()[prop as keyof Config]
  }
})
