import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function POST() {
  try {
    // Add webhook_url column to participants
    await supabaseAdmin.from("participants").select("webhook_url").limit(1);
    console.log("✓ webhook_url column already exists or checking failed");
  } catch (error: any) {
    if (error.message?.includes("column") && error.message?.includes("does not exist")) {
      // This means we need to add the column, but we can't via PostgREST
      return NextResponse.json({ 
        error: "Manual migration required",
        sql: `
          ALTER TABLE participants ADD COLUMN webhook_url TEXT;
          
          CREATE TABLE message_deliveries (
            id TEXT PRIMARY KEY,
            message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
            status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'failed')),
            attempts INTEGER NOT NULL DEFAULT 0,
            last_attempt_at TIMESTAMPTZ,
            delivered_at TIMESTAMPTZ,
            error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          
          CREATE INDEX idx_message_deliveries_participant_status 
          ON message_deliveries(participant_id, status);
          
          CREATE INDEX idx_message_deliveries_message_id 
          ON message_deliveries(message_id);
          
          CREATE INDEX idx_message_deliveries_retry 
          ON message_deliveries(status, attempts, last_attempt_at);
        `
      }, { status: 400 });
    }
  }

  try {
    // Try to create a test delivery record to check if table exists
    await supabaseAdmin.from("message_deliveries").select("id").limit(1);
    console.log("✓ message_deliveries table exists");
  } catch (error: any) {
    if (error.message?.includes("relation") && error.message?.includes("does not exist")) {
      return NextResponse.json({ 
        error: "message_deliveries table does not exist - manual migration required",
        sql: "See the SQL above"
      }, { status: 400 });
    }
  }

  return NextResponse.json({ success: true, message: "Database schema is ready" });
}