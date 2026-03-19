import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Types
export interface Participant {
  id: string;
  name: string;
  type: "human" | "agent";
  avatar: string | null;
  capabilities: string | null;
  api_key: string;
  webhook_url: string | null;
  created_at: string;
}

export interface Room {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
}

export interface RoomMember {
  room_id: string;
  participant_id: string;
  joined_at: string;
}

export interface Message {
  id: string;
  room_id: string;
  participant_id: string;
  content: string;
  content_type: string;
  reply_to: string | null;
  metadata: string | null;
  created_at: string;
}

// Server-only admin client (service role, bypasses RLS)
// Lazy singleton — only created when first called at runtime
let _admin: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (!_admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }
    _admin = createClient(url, serviceKey)
  }
  return _admin
}
