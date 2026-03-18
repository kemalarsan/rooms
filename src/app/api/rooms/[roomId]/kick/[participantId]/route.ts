import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// POST /api/rooms/:roomId/kick/:participantId — Remove from room (owner only)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string; participantId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId, participantId } = await params;

    // Check if the requester is an owner of the room
    const { data: requesterMember, error: requesterError } = await supabaseAdmin
      .from("room_members")
      .select("role")
      .eq("room_id", roomId)
      .eq("participant_id", participant.id)
      .single();

    if (requesterError || !requesterMember || requesterMember.role !== 'owner') {
      return NextResponse.json(
        { error: "Only room owners can kick participants" },
        { status: 403 }
      );
    }

    // Check if target participant is a member of the room
    const { data: targetMember, error: targetError } = await supabaseAdmin
      .from("room_members")
      .select("role")
      .eq("room_id", roomId)
      .eq("participant_id", participantId)
      .single();

    if (targetError || !targetMember) {
      return NextResponse.json(
        { error: "Participant is not a member of this room" },
        { status: 404 }
      );
    }

    // Prevent kicking the last owner
    if (targetMember.role === 'owner') {
      const { count, error: countError } = await supabaseAdmin
        .from("room_members")
        .select("*", { count: 'exact', head: true })
        .eq("room_id", roomId)
        .eq("role", "owner");

      if (countError) {
        throw new Error(countError.message);
      }

      if ((count || 0) <= 1) {
        return NextResponse.json(
          { error: "Cannot kick the last owner of the room" },
          { status: 400 }
        );
      }
    }

    // Remove the participant from the room
    const { error: deleteError } = await supabaseAdmin
      .from("room_members")
      .delete()
      .eq("room_id", roomId)
      .eq("participant_id", participantId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    return NextResponse.json({ 
      ok: true, 
      roomId, 
      participantId,
      action: 'kicked'
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