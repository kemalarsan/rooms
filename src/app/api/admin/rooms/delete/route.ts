import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * POST /api/admin/rooms/delete — Delete rooms and all their data
 * Body: { roomIds: string[] }
 */
export async function POST(req: NextRequest) {
  try {
    requireAdmin(req);
    const db = getSupabaseAdmin();
    const { roomIds } = await req.json();
    
    if (!Array.isArray(roomIds) || roomIds.length === 0) {
      return NextResponse.json({ error: "roomIds required" }, { status: 400 });
    }

    const results: Record<string, number> = {};

    // 1. Get all messages in these rooms
    const { data: msgs } = await db.from("messages").select("id").in("room_id", roomIds);
    const msgIds = msgs?.map(m => m.id) || [];

    // 2. Delete deliveries for those messages
    if (msgIds.length > 0) {
      let delCount = 0;
      for (let i = 0; i < msgIds.length; i += 100) {
        const { count } = await db.from("message_deliveries").delete({ count: "exact" }).in("message_id", msgIds.slice(i, i + 100));
        delCount += count || 0;
      }
      results.deliveries = delCount;
    }

    // 3. Delete messages
    const { count: msgCount } = await db.from("messages").delete({ count: "exact" }).in("room_id", roomIds);
    results.messages = msgCount || 0;

    // 4. Delete room members
    const { count: memberCount } = await db.from("room_members").delete({ count: "exact" }).in("room_id", roomIds);
    results.members = memberCount || 0;

    // 5. Delete room memory
    const { count: memCount } = await db.from("room_memory").delete({ count: "exact" }).in("room_id", roomIds);
    results.memory = memCount || 0;

    // 6. Delete invite links
    const { count: invCount } = await db.from("invite_links").delete({ count: "exact" }).in("room_id", roomIds);
    results.invites = invCount || 0;

    // 7. Delete notification preferences for these rooms
    try {
      const { count: npCount } = await db.from("notification_preferences").delete({ count: "exact" }).in("room_id", roomIds);
      results.notifPrefs = npCount || 0;
    } catch { results.notifPrefs = 0; }

    // 8. Delete the rooms
    const { count: roomCount } = await db.from("rooms").delete({ count: "exact" }).in("id", roomIds);
    results.rooms = roomCount || 0;

    return NextResponse.json({ ok: true, deleted: results });
  } catch (error) {
    if ((error as Error).message === "Admin access required") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
