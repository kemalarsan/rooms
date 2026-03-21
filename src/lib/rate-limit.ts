// Simple in-memory rate limiter using token bucket algorithm
// Production apps should use Redis or external rate limiting service

interface RateLimitConfig {
  windowMs: number     // Time window in milliseconds
  maxRequests: number  // Max requests per window
}

interface TokenBucket {
  tokens: number
  lastRefill: number
  maxTokens: number
  refillRate: number  // tokens per ms
}

// In-memory storage - will reset on server restart
const buckets = new Map<string, TokenBucket>()

// Default configurations for different endpoint types
export const RATE_LIMITS = {
  messages: { windowMs: 60 * 1000, maxRequests: 60 },  // 60 messages per minute (1/sec sustained)
  rooms: { windowMs: 60 * 1000, maxRequests: 10 },     // 10 room operations per minute
  general: { windowMs: 60 * 1000, maxRequests: 120 }   // 120 general requests per minute
} as const

export function checkRateLimit(key: string, config: RateLimitConfig): { allowed: boolean; remaining: number; resetTime: number } {
  const now = Date.now()
  
  // Get or create bucket for this key
  let bucket = buckets.get(key)
  if (!bucket) {
    bucket = {
      tokens: config.maxRequests,
      lastRefill: now,
      maxTokens: config.maxRequests,
      refillRate: config.maxRequests / config.windowMs
    }
    buckets.set(key, bucket)
  }

  // Calculate tokens to add based on time elapsed
  const timeSinceRefill = now - bucket.lastRefill
  const tokensToAdd = timeSinceRefill * bucket.refillRate
  
  // Update bucket
  bucket.tokens = Math.min(bucket.maxTokens, bucket.tokens + tokensToAdd)
  bucket.lastRefill = now

  // Check if request is allowed
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      resetTime: now + ((bucket.maxTokens - bucket.tokens) / bucket.refillRate)
    }
  } else {
    return {
      allowed: false,
      remaining: 0,
      resetTime: now + ((1 - bucket.tokens) / bucket.refillRate)
    }
  }
}

export function rateLimitByApiKey(apiKey: string, endpoint: keyof typeof RATE_LIMITS) {
  const key = `${endpoint}:${apiKey}`
  const config = RATE_LIMITS[endpoint]
  return checkRateLimit(key, config)
}

// Cleanup old buckets periodically to prevent memory leaks
function cleanup() {
  const now = Date.now()
  const staleThreshold = 5 * 60 * 1000 // 5 minutes
  
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.lastRefill > staleThreshold) {
      buckets.delete(key)
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanup, 5 * 60 * 1000)