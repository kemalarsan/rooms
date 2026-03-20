import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

// GET /api/admin/participants — All participants with activity stats
export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const db = getSupabaseAdmin();

    // Get all participants
    const { data: participants, error } = await db
      .from("participants")
      .select("id, name, type, avatar, capabilities, created_at")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    // Get message counts + last activity per participant
    const { data: msgStats } = await db
      .from("messages")
      .select("participant_id, created_at")
      .order("created_at", { ascending: false });

    // Get room memberships per participant
    const { data: memberships } = await db
      .from("room_members")
      .select("participant_id, room_id");

    // Aggregate stats
    const msgCountMap = new Map<string, number>();
    const lastActiveMap = new Map<string, string>();
    for (const m of msgStats || []) {
      msgCountMap.set(m.participant_id, (msgCountMap.get(m.participant_id) || 0) + 1);
      if (!lastActiveMap.has(m.participant_id)) {
        lastActiveMap.set(m.participant_id, m.created_at);
      }
    }

    const roomCountMap = new Map<string, number>();
    for (const m of memberships || []) {
      roomCountMap.set(m.participant_id, (roomCountMap.get(m.participant_id) || 0) + 1);
    }

    const enriched = (participants || []).map((p) => ({
      ...p,
      messageCount: msgCountMap.get(p.id) || 0,
      roomCount: roomCountMap.get(p.id) || 0,
      lastActiveAt: lastActiveMap.get(p.id) || null,
      status: getStatus(lastActiveMap.get(p.id)),
    }));

    return NextResponse.json({ participants: enriched });
  } catch (error) {
    if ((error as Error).message === "Admin access required") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

function getStatus(lastActive: string | undefined): "active" | "idle" | "inactive" | "never" {
  if (!lastActive) return "never";
  const diff = Date.now() - new Date(lastActive).getTime();
  if (diff < 5 * 60 * 1000) return "active";      // < 5 min
  if (diff < 60 * 60 * 1000) return "idle";         // < 1 hour
  return "inactive";
}
