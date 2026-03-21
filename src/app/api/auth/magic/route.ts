import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { verifyMagicToken } from '@/lib/magic-token';

/**
 * POST /api/auth/magic
 * 
 * Exchange a magic link token for participant credentials.
 * This endpoint enables seamless deep link authentication from notifications.
 * 
 * Body: { token: string }
 * Response: { ok: true, apiKey: string, participantId: string, participantName: string }
 * Error: 400/401 with { error: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token } = body;
    
    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { error: 'Token is required' },
        { status: 400 }
      );
    }
    
    // Verify the magic token
    const tokenData = verifyMagicToken(token);
    if (!tokenData) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }
    
    // Look up the participant
    const db = getSupabaseAdmin();
    const { data: participant, error } = await db
      .from('participants')
      .select('id, name, api_key')
      .eq('id', tokenData.pid)
      .single();
    
    if (error || !participant) {
      return NextResponse.json(
        { error: 'Participant not found' },
        { status: 401 }
      );
    }
    
    // Return the participant's credentials
    return NextResponse.json({
      ok: true,
      apiKey: participant.api_key,
      participantId: participant.id,
      participantName: participant.name,
    });
    
  } catch (error) {
    console.error('[magic-auth] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}