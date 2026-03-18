import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Client for browser/public operations
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server client with service role key for bypass RLS when needed
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Types
export interface Participant {
  id: string;
  name: string;
  type: "human" | "agent";
  avatar: string | null;
  capabilities: string | null;
  api_key: string;
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