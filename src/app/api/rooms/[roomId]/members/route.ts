import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// GET /api/rooms/:roomId/members — List room members
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId } = await params;

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

    const { data: members, error } = await supabaseAdmin
      .from("participants")
      .select(`
        id,
        name,
        type,
        avatar,
        capabilities,
        room_members!inner(joined_at)
      `)
      .eq("room_members.room_id", roomId)
      .order("room_members.joined_at", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    // Transform to match original format
    const transformedMembers = members.map((member: any) => ({
      id: member.id,
      name: member.name,
      type: member.type,
      avatar: member.avatar,
      capabilities: member.capabilities,
      joined_at: member.room_members[0].joined_at,
    }));

    return NextResponse.json({ members: transformedMembers });
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
