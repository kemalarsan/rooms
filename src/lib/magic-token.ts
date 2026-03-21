/**
 * Magic Link Token System for Hivium
 * 
 * Generates JWT-based magic tokens for seamless notification deep links.
 * No new database table needed — uses signed JWTs with participant/room data.
 */

import { createHmac, randomBytes } from 'crypto';

interface MagicTokenPayload {
  pid: string;  // participantId
  rid: string;  // roomId
  iat: number;  // issued at (Unix timestamp)
  exp: number;  // expires at (Unix timestamp)
}

interface VerifyResult {
  pid: string;
  rid: string;
}

/**
 * Get the secret key for signing/verifying tokens
 * Uses MAGIC_TOKEN_SECRET env var, falls back to HIVIUM_INTERNAL_KEY
 */
function getSecret(): string {
  const secret = process.env.MAGIC_TOKEN_SECRET || process.env.HIVIUM_INTERNAL_KEY;
  if (!secret) {
    throw new Error('MAGIC_TOKEN_SECRET or HIVIUM_INTERNAL_KEY environment variable is required');
  }
  return secret;
}

/**
 * Simple JWT-like token implementation using HMAC-SHA256
 * Format: base64(header).base64(payload).base64(signature)
 */
function createToken(payload: MagicTokenPayload): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  
  const headerBase64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  
  const data = `${headerBase64}.${payloadBase64}`;
  const signature = createHmac('sha256', getSecret())
    .update(data)
    .digest('base64url');
  
  return `${data}.${signature}`;
}

/**
 * Verify and decode a magic token
 * Returns null if invalid/expired
 */
function verifyToken(token: string): MagicTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [headerBase64, payloadBase64, signatureBase64] = parts;
    
    // Verify signature
    const data = `${headerBase64}.${payloadBase64}`;
    const expectedSignature = createHmac('sha256', getSecret())
      .update(data)
      .digest('base64url');
    
    if (signatureBase64 !== expectedSignature) return null;
    
    // Decode payload
    const payload = JSON.parse(Buffer.from(payloadBase64, 'base64url').toString()) as MagicTokenPayload;
    
    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;
    
    return payload;
  } catch {
    return null;
  }
}

/**
 * Generate a magic link token for a participant/room pair
 * Token expires in 7 days (notification links might be clicked days later)
 */
export function generateMagicToken(participantId: string, roomId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: MagicTokenPayload = {
    pid: participantId,
    rid: roomId,
    iat: now,
    exp: now + (7 * 24 * 60 * 60), // 7 days
  };
  
  return createToken(payload);
}

/**
 * Verify a magic token and extract participant/room data
 * Returns null if token is invalid or expired
 */
export function verifyMagicToken(token: string): VerifyResult | null {
  const payload = verifyToken(token);
  if (!payload) return null;
  
  return {
    pid: payload.pid,
    rid: payload.rid,
  };
}