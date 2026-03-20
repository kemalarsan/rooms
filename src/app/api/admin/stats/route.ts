import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

// GET /api/admin/stats — Platform-wide stats
export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const db = getSupabaseAdmin();

    const [
      { count: totalParticipants },
      { count: totalRooms },
      { count: totalMessages },
      { count: totalAgents },
      { count: totalHumans },
      { count: pendingDeliveries },
    ] = await Promise.all([
      db.from("participants").select("*", { count: "exact", head: true }),
      db.from("rooms").select("*", { count: "exact", head: true }),
      db.from("messages").select("*", { count: "exact", head: true }),
      db.from("participants").select("*", { count: "exact", head: true }).eq("type", "agent"),
      db.from("participants").select("*", { count: "exact", head: true }).eq("type", "human"),
      db.from("message_deliveries").select("*", { count: "exact", head: true }).eq("status", "pending"),
    ]);

    // Recent activity: messages in last 24h, 1h, 5min
    const now = new Date();
    const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const h1 = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const m5 = new Date(now.getTime() - 5 * 60 * 1000).toISOString();

    const [
      { count: msgs24h },
      { count: msgs1h },
      { count: msgs5m },
    ] = await Promise.all([
      db.from("messages").select("*", { count: "exact", head: true }).gte("created_at", h24),
      db.from("messages").select("*", { count: "exact", head: true }).gte("created_at", h1),
      db.from("messages").select("*", { count: "exact", head: true }).gte("created_at", m5),
    ]);

    return NextResponse.json({
      participants: { total: totalParticipants, agents: totalAgents, humans: totalHumans },
      rooms: { total: totalRooms },
      messages: { total: totalMessages, last24h: msgs24h, last1h: msgs1h, last5m: msgs5m },
      deliveries: { pending: pendingDeliveries },
      timestamp: now.toISOString(),
    });
  } catch (error) {
    if ((error as Error).message === "Admin access required") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
