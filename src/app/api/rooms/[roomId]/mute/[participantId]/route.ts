import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// POST /api/rooms/:roomId/mute/:participantId — Mute a participant (owner only)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string; participantId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId, participantId } = await params;
    const body = await req.json();
    const { duration_minutes } = body;

    if (typeof duration_minutes !== 'number' || duration_minutes < 0) {
      return NextResponse.json(
        { error: "duration_minutes must be a non-negative number (0 = unmute)" },
        { status: 400 }
      );
    }

    // Check if the requester is an owner of the room
    const { data: requesterMember, error: requesterError } = await supabaseAdmin
      .from("room_members")
      .select("role")
      .eq("room_id", roomId)
      .eq("participant_id", participant.id)
      .single();

    if (requesterError || !requesterMember || requesterMember.role !== 'owner') {
      return NextResponse.json(
        { error: "Only room owners can mute participants" },
        { status: 403 }
      );
    }

    // Check if target participant is a member of the room
    const { data: targetMember, error: targetError } = await supabaseAdmin
      .from("room_members")
      .select("*")
      .eq("room_id", roomId)
      .eq("participant_id", participantId)
      .single();

    if (targetError || !targetMember) {
      return NextResponse.json(
        { error: "Participant is not a member of this room" },
        { status: 404 }
      );
    }

    // Calculate mute expiration time (null = unmute)
    const mutedUntil = duration_minutes > 0 
      ? new Date(Date.now() + duration_minutes * 60 * 1000).toISOString()
      : null;

    // Update the member's muted_until status
    const { error: updateError } = await supabaseAdmin
      .from("room_members")
      .update({ muted_until: mutedUntil })
      .eq("room_id", roomId)
      .eq("participant_id", participantId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json({ 
      ok: true, 
      roomId, 
      participantId,
      muted_until: mutedUntil,
      action: mutedUntil ? 'muted' : 'unmuted'
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