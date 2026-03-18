import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
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
    const { data: member } = await supabaseAdmin
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
    const { data: roomMembers, error } = await supabaseAdmin
      .from("room_members")
      .select("participant_id, joined_at")
      .eq("room_id", roomId)
      .order("joined_at", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    // Fetch participant details
    const participantIds = roomMembers.map((rm: { participant_id: string }) => rm.participant_id);
    const { data: participants, error: pError } = await supabaseAdmin
      .from("participants")
      .select("id, name, type, avatar, capabilities")
      .in("id", participantIds);

    if (pError) {
      throw new Error(pError.message);
    }

    // Merge
    const participantMap = new Map(participants.map((p: { id: string }) => [p.id, p]));
    const members = roomMembers.map((rm: { participant_id: string; joined_at: string }) => {
      const p = participantMap.get(rm.participant_id) as Record<string, unknown> | undefined;
      return {
        id: rm.participant_id,
        name: p?.name || "Unknown",
        type: p?.type || "human",
        avatar: p?.avatar || null,
        capabilities: p?.capabilities || null,
        joined_at: rm.joined_at,
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
