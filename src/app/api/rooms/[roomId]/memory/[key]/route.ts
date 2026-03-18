import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// DELETE /api/rooms/:roomId/memory/:key — Delete a key
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string; key: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId, key } = await params;

    // Verify membership
    const { data: member, error: memberError } = await supabaseAdmin
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

    // Delete the memory entry
    const { error } = await supabaseAdmin
      .from("room_memory")
      .delete()
      .eq("room_id", roomId)
      .eq("key", key);

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true, deleted_key: key });
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