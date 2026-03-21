import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * POST /api/admin/rooms/clear — Clear messages from rooms (keep room + members)
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

    if (roomIds.length > 100) {
      return NextResponse.json({ error: "Max 100 rooms per request" }, { status: 400 });
    }

    const results: Record<string, number> = {};

    // 1. Get all messages in these rooms
    const { data: msgs } = await db
      .from("messages")
      .select("id")
      .in("room_id", roomIds);
    
    const msgIds = msgs?.map(m => m.id) || [];

    // 2. Delete message deliveries for those messages
    if (msgIds.length > 0) {
      let delCount = 0;
      for (let i = 0; i < msgIds.length; i += 100) {
        const chunk = msgIds.slice(i, i + 100);
        const { count } = await db
          .from("message_deliveries")
          .delete({ count: "exact" })
          .in("message_id", chunk);
        delCount += count || 0;
      }
      results.deliveries = delCount;
    }

    // 3. Delete messages
    const { count: msgCount } = await db
      .from("messages")
      .delete({ count: "exact" })
      .in("room_id", roomIds);
    results.messages = msgCount || 0;

    return NextResponse.json({
      ok: true,
      deleted: results,
      summary: `Cleared ${results.messages || 0} messages from ${roomIds.length} room${roomIds.length === 1 ? '' : 's'}`,
    });
  } catch (error) {
    if ((error as Error).message === "Admin access required") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}