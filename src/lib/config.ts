// Environment variable validation and configuration
// This file validates all required environment variables at import time
// to catch configuration issues early and provide clear error messages

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

function validateAndGetConfig(): Config {
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

  return {
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
}

// Validate configuration on import
export const config = validateAndGetConfig()