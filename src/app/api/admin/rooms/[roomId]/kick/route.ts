import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * POST /api/admin/rooms/[roomId]/kick — Remove member from room
 * Body: { participantId: string }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ roomId: string }> }) {
  try {
    requireAdmin(req);
    const db = getSupabaseAdmin();
    const { participantId } = await req.json();
    const { roomId } = await params;
    
    if (!participantId || !roomId) {
      return NextResponse.json({ error: "participantId and roomId required" }, { status: 400 });
    }

    // Delete from room_members where room_id and participant_id match
    const { data: removedMember, error } = await db
      .from("room_members")
      .delete()
      .eq("room_id", roomId)
      .eq("participant_id", participantId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: "Member not found in room" }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({
      ok: true,
      removed: removedMember,
      summary: `Removed participant from room`,
    });
  } catch (error) {
    if ((error as Error).message === "Admin access required") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}