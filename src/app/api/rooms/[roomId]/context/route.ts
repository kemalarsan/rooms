import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// GET /api/rooms/:roomId/context — Read room context (for agents joining)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId } = await params;

    // Verify membership
    const { data: member, error: memberError } = await getSupabaseAdmin()
      .from("room_members")
      .select("*")
      .eq("room_id", roomId)
      .eq("participant_id", participant.id)
      .single();

    if (memberError || !member) {
      return NextResponse.json(
        { error: "Not a member of this room" },
        { status: 403 }
      );
    }

    // Get room context
    const { data: room, error } = await getSupabaseAdmin()
      .from("rooms")
      .select("id, name, topic, context, room_type, ttl_hours")
      .eq("id", roomId)
      .single();

    if (error || !room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    return NextResponse.json(room);
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

// PUT /api/rooms/:roomId/context — Update room topic and context (only members can update)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId } = await params;
    const body = await req.json();
    const { topic, context } = body;

    // Verify membership
    const { data: member, error: memberError } = await getSupabaseAdmin()
      .from("room_members")
      .select("*")
      .eq("room_id", roomId)
      .eq("participant_id", participant.id)
      .single();

    if (memberError || !member) {
      return NextResponse.json(
        { error: "Not a member of this room" },
        { status: 403 }
      );
    }

    // Update room context
    const { data: updatedRoom, error } = await getSupabaseAdmin()
      .from("rooms")
      .update({
        topic: topic || null,
        context: context || null,
      })
      .eq("id", roomId)
      .select("id, name, topic, context, room_type, ttl_hours")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json(updatedRoom);
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