import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// DELETE /api/rooms/:roomId/triggers/:triggerId — Delete trigger (owner only)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string; triggerId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId, triggerId } = await params;

    // Check if the requester is an owner of the room
    const { data: requesterMember, error: requesterError } = await supabaseAdmin
      .from("room_members")
      .select("role")
      .eq("room_id", roomId)
      .eq("participant_id", participant.id)
      .single();

    if (requesterError || !requesterMember || requesterMember.role !== 'owner') {
      return NextResponse.json(
        { error: "Only room owners can delete triggers" },
        { status: 403 }
      );
    }

    // Check if the trigger exists and belongs to this room
    const { data: trigger, error: triggerError } = await supabaseAdmin
      .from("room_triggers")
      .select("*")
      .eq("id", triggerId)
      .eq("room_id", roomId)
      .single();

    if (triggerError || !trigger) {
      return NextResponse.json(
        { error: "Trigger not found" },
        { status: 404 }
      );
    }

    // Delete the trigger
    const { error: deleteError } = await supabaseAdmin
      .from("room_triggers")
      .delete()
      .eq("id", triggerId)
      .eq("room_id", roomId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    return NextResponse.json({ 
      ok: true, 
      roomId,
      triggerId,
      action: 'deleted'
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