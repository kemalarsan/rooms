import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// POST /api/rooms/:roomId/humans-only — Toggle humans-only mode (owner only)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId } = await params;
    const body = await req.json();
    const { enabled } = body;

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: "enabled must be a boolean" },
        { status: 400 }
      );
    }

    // Check if the requester is an owner of the room
    const { data: requesterMember, error: requesterError } = await getSupabaseAdmin()
      .from("room_members")
      .select("role")
      .eq("room_id", roomId)
      .eq("participant_id", participant.id)
      .single();

    if (requesterError || !requesterMember || requesterMember.role !== 'owner') {
      return NextResponse.json(
        { error: "Only room owners can toggle humans-only mode" },
        { status: 403 }
      );
    }

    // Update the room's humans_only status
    const { error: updateError } = await getSupabaseAdmin()
      .from("rooms")
      .update({ humans_only: enabled })
      .eq("id", roomId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json({ 
      ok: true, 
      roomId,
      humans_only: enabled,
      action: enabled ? 'humans-only enabled' : 'humans-only disabled'
    });
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