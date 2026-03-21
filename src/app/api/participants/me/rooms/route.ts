import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { unauthorized, internalError } from "@/lib/errors";

// GET /api/participants/me/rooms — List rooms I'm a member of
export async function GET(req: NextRequest) {
  try {
    const participant = await requireAuth(req);

    const { data: memberships, error } = await getSupabaseAdmin()
      .from("room_members")
      .select(
        `
        room_id,
        joined_at,
        rooms (
          id,
          name,
          description,
          topic,
          room_type,
          created_at,
          humans_only,
          locked
        )
      `
      )
      .eq("participant_id", participant.id);

    if (error) {
      throw new Error(error.message);
    }

    const rooms = (memberships || []).map((m: any) => ({
      room_id: m.room_id,
      room_name: m.rooms?.name || m.room_id,
      description: m.rooms?.description,
      topic: m.rooms?.topic,
      room_type: m.rooms?.room_type,
      joined_at: m.joined_at,
      created_at: m.rooms?.created_at,
      humans_only: m.rooms?.humans_only,
      locked: m.rooms?.locked,
    }));

    return NextResponse.json({ rooms });
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return unauthorized();
    }
    return internalError((error as Error).message);
  }
}
