import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// POST /api/rooms/:roomId/transfer — Transfer ownership (owner only)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId } = await params;
    const body = await req.json();
    const { new_owner_id } = body;

    if (!new_owner_id || typeof new_owner_id !== 'string') {
      return NextResponse.json(
        { error: "new_owner_id is required" },
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
        { error: "Only room owners can transfer ownership" },
        { status: 403 }
      );
    }

    // Check if new owner is a member of the room
    const { data: newOwnerMember, error: newOwnerError } = await supabaseAdmin
      .from("room_members")
      .select("role")
      .eq("room_id", roomId)
      .eq("participant_id", new_owner_id)
      .single();

    if (newOwnerError || !newOwnerMember) {
      return NextResponse.json(
        { error: "New owner must already be a member of the room" },
        { status: 404 }
      );
    }

    // Perform the ownership transfer in a transaction-like manner
    // First, set the old owner to member
    const { error: demoteError } = await supabaseAdmin
      .from("room_members")
      .update({ role: 'member' })
      .eq("room_id", roomId)
      .eq("participant_id", participant.id);

    if (demoteError) {
      throw new Error(demoteError.message);
    }

    // Then, set the new owner to owner
    const { error: promoteError } = await supabaseAdmin
      .from("room_members")
      .update({ role: 'owner' })
      .eq("room_id", roomId)
      .eq("participant_id", new_owner_id);

    if (promoteError) {
      // Try to roll back the first change
      await supabaseAdmin
        .from("room_members")
        .update({ role: 'owner' })
        .eq("room_id", roomId)
        .eq("participant_id", participant.id);
      
      throw new Error(promoteError.message);
    }

    return NextResponse.json({ 
      ok: true, 
      roomId,
      previous_owner_id: participant.id,
      new_owner_id,
      action: 'ownership transferred'
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