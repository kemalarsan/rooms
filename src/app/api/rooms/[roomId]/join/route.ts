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

    // Check if already a member
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("room_members")
      .select("*")
      .eq("room_id", roomId)
      .eq("participant_id", participant.id)
      .single();

    if (!existing && !existingError) {
      const { error: insertError } = await supabaseAdmin
        .from("room_members")
        .insert({
          room_id: roomId,
          participant_id: participant.id,
        });

      if (insertError) {
        throw new Error(insertError.message);
      }

      // Note: Supabase Realtime will automatically notify clients of this insert
      // No need to manually emit events anymore
    }

    return NextResponse.json({ ok: true, roomId, participantId: participant.id });
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
