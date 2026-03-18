import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// POST /api/rooms/:roomId/join
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId } = await params;

    const { data: room, error: roomError } = await supabaseAdmin
      .from("rooms")
      .select("*")
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    // Check if room is locked
    if (room.locked) {
      return NextResponse.json({ error: "Room is locked" }, { status: 403 });
    }

    // Check if already a member
    const { data: existing } = await supabaseAdmin
      .from("room_members")
      .select("*")
      .eq("room_id", roomId)
      .eq("participant_id", participant.id)
      .maybeSingle();

    if (!existing) {
      const { error: insertError } = await supabaseAdmin
        .from("room_members")
        .insert({
          room_id: roomId,
          participant_id: participant.id,
        });

      if (insertError) {
        throw new Error(insertError.message);
      }
    }

    return NextResponse.json({ 
      ok: true, 
      roomId, 
      participantId: participant.id,
      room: {
        id: room.id,
        name: room.name,
        description: room.description,
        topic: room.topic,
        context: room.context,
        room_type: room.room_type,
        ttl_hours: room.ttl_hours
      }
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
