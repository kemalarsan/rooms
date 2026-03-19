import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// PATCH /api/rooms/:roomId/members/:participantId — Change member role (owner only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string; participantId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId, participantId } = await params;
    const body = await req.json();
    const { role } = body;

    if (!role || !['owner', 'member', 'observer'].includes(role)) {
      return NextResponse.json(
        { error: "role must be one of: owner, member, observer" },
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
        { error: "Only room owners can change member roles" },
        { status: 403 }
      );
    }

    // Check if target participant is a member of the room
    const { data: targetMember, error: targetError } = await getSupabaseAdmin()
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

    // If demoting the last owner, check that there will still be at least one owner
    if (targetMember.role === 'owner' && role !== 'owner') {
      const { count, error: countError } = await getSupabaseAdmin()
        .from("room_members")
        .select("*", { count: 'exact', head: true })
        .eq("room_id", roomId)
        .eq("role", "owner");

      if (countError) {
        throw new Error(countError.message);
      }

      if ((count || 0) <= 1) {
        return NextResponse.json(
          { error: "Cannot demote the last owner of the room" },
          { status: 400 }
        );
      }
    }

    // Update the member's role
    const { error: updateError } = await getSupabaseAdmin()
      .from("room_members")
      .update({ role })
      .eq("room_id", roomId)
      .eq("participant_id", participantId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json({ 
      ok: true, 
      roomId, 
      participantId, 
      role 
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