import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// GET /api/rooms/:roomId/members — List room members
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId } = await params;

    // Verify membership
    const { data: member } = await getSupabaseAdmin()
      .from("room_members")
      .select("*")
      .eq("room_id", roomId)
      .eq("participant_id", participant.id)
      .maybeSingle();

    if (!member) {
      return NextResponse.json(
        { error: "Not a member of this room" },
        { status: 403 }
      );
    }

    // Get all room members with participant details
    const { data: roomMembers, error } = await getSupabaseAdmin()
      .from("room_members")
      .select("participant_id, joined_at, role, muted_until, rate_limit_per_min, last_seen_at, last_status")
      .eq("room_id", roomId)
      .order("joined_at", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    // Fetch participant details
    const participantIds = roomMembers.map((rm: { participant_id: string }) => rm.participant_id);
    const { data: participants, error: pError } = await getSupabaseAdmin()
      .from("participants")
      .select("id, name, type, avatar, capabilities")
      .in("id", participantIds);

    if (pError) {
      throw new Error(pError.message);
    }

    // Merge
    const participantMap = new Map(participants.map((p: { id: string }) => [p.id, p]));
    const members = roomMembers.map((rm: { participant_id: string; joined_at: string; role: string; muted_until: string | null; rate_limit_per_min: number | null; last_seen_at: string | null; last_status: string | null }) => {
      const p = participantMap.get(rm.participant_id) as Record<string, unknown> | undefined;
      return {
        id: rm.participant_id,
        name: p?.name || "Unknown",
        type: p?.type || "human",
        avatar: p?.avatar || null,
        capabilities: p?.capabilities || null,
        role: rm.role || "member",
        muted_until: rm.muted_until,
        joined_at: rm.joined_at,
        last_seen_at: rm.last_seen_at,
        last_status: rm.last_status,
      };
    });

    return NextResponse.json({ members });
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
