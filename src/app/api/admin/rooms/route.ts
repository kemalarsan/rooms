import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

// GET /api/admin/rooms — All rooms with member/message stats
export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const db = getSupabaseAdmin();

    // Get all rooms
    const { data: rooms, error } = await db
      .from("rooms")
      .select("id, name, description, topic, context, room_type, created_by, created_at, max_message_length, humans_only, locked, ttl_hours")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    // Get members per room with participant info
    const { data: memberships } = await db
      .from("room_members")
      .select("room_id, participant_id, role, joined_at, muted_until, participants!inner(id, name, type, avatar)")
      .order("joined_at", { ascending: true });

    // Get message stats per room
    const { data: msgStats } = await db
      .from("messages")
      .select("room_id, created_at, participant_id")
      .order("created_at", { ascending: false });

    // Get pending deliveries per room
    const { data: pendingDels } = await db
      .from("message_deliveries")
      .select("message_id, messages!inner(room_id)")
      .eq("status", "pending");

    // Aggregate
    const memberMap = new Map<string, any[]>();
    for (const m of memberships || []) {
      if (!memberMap.has(m.room_id)) memberMap.set(m.room_id, []);
      memberMap.get(m.room_id)!.push({
        id: (m as any).participants?.id,
        name: (m as any).participants?.name,
        type: (m as any).participants?.type,
        avatar: (m as any).participants?.avatar,
        role: m.role,
        joinedAt: m.joined_at,
        muted: m.muted_until ? new Date(m.muted_until) > new Date() : false,
      });
    }

    const msgCountMap = new Map<string, number>();
    const lastMsgMap = new Map<string, string>();
    const uniqueSenders = new Map<string, Set<string>>();
    for (const m of msgStats || []) {
      msgCountMap.set(m.room_id, (msgCountMap.get(m.room_id) || 0) + 1);
      if (!lastMsgMap.has(m.room_id)) lastMsgMap.set(m.room_id, m.created_at);
      if (!uniqueSenders.has(m.room_id)) uniqueSenders.set(m.room_id, new Set());
      uniqueSenders.get(m.room_id)!.add(m.participant_id);
    }

    const pendingMap = new Map<string, number>();
    for (const d of pendingDels || []) {
      const rid = (d as any).messages?.room_id;
      if (rid) pendingMap.set(rid, (pendingMap.get(rid) || 0) + 1);
    }

    const enriched = (rooms || []).map((r) => ({
      ...r,
      members: memberMap.get(r.id) || [],
      memberCount: (memberMap.get(r.id) || []).length,
      messageCount: msgCountMap.get(r.id) || 0,
      activeSenders: uniqueSenders.get(r.id)?.size || 0,
      lastMessageAt: lastMsgMap.get(r.id) || null,
      pendingDeliveries: pendingMap.get(r.id) || 0,
      status: getRoomStatus(lastMsgMap.get(r.id)),
    }));

    return NextResponse.json({ rooms: enriched });
  } catch (error) {
    if ((error as Error).message === "Admin access required") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

function getRoomStatus(lastMsg: string | undefined): "active" | "quiet" | "dormant" {
  if (!lastMsg) return "dormant";
  const diff = Date.now() - new Date(lastMsg).getTime();
  if (diff < 30 * 60 * 1000) return "active";    // < 30 min
  if (diff < 24 * 60 * 60 * 1000) return "quiet"; // < 24h
  return "dormant";
}
