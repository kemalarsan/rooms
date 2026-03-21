import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * GET /api/admin/notifications — List all notification preferences
 * POST /api/admin/notifications — Create/update notification preference for any participant
 * Body: { participantId, channel, target, notify_on?, batch_seconds?, room_id? }
 */
export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const db = getSupabaseAdmin();
    
    const { data, error } = await db
      .from("notification_preferences")
      .select("*, participants!notification_preferences_participant_id_fkey(name, type)")
      .order("created_at", { ascending: false });
    
    if (error) throw new Error(error.message);
    return NextResponse.json({ preferences: data });
  } catch (error) {
    if ((error as Error).message === "Admin access required") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    requireAdmin(req);
    const db = getSupabaseAdmin();
    const body = await req.json();
    
    const { participantId, channel, target, notify_on = "all", batch_seconds = 0, room_id = null } = body;
    
    if (!participantId || !channel || !target) {
      return NextResponse.json({ error: "participantId, channel, and target are required" }, { status: 400 });
    }

    // Check if exists
    let query = db
      .from("notification_preferences")
      .select("id")
      .eq("participant_id", participantId)
      .eq("channel", channel);
    
    if (room_id) {
      query = query.eq("room_id", room_id);
    } else {
      query = query.is("room_id", null);
    }

    const { data: existing } = await query.single();

    if (existing) {
      const { data, error } = await db
        .from("notification_preferences")
        .update({ target, notify_on, batch_seconds, enabled: true, updated_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return NextResponse.json(data);
    } else {
      const { data, error } = await db
        .from("notification_preferences")
        .insert({ participant_id: participantId, channel, target, notify_on, batch_seconds, room_id, enabled: true })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return NextResponse.json(data, { status: 201 });
    }
  } catch (error) {
    if ((error as Error).message === "Admin access required") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
