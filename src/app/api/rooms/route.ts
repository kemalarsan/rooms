import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { nanoid } from "nanoid";

// GET /api/rooms — List rooms the participant is in
export async function GET(req: NextRequest) {
  try {
    const participant = await requireAuth(req);

    // Get rooms with member count and last message using Supabase
    const { data: rooms, error } = await supabaseAdmin
      .from("rooms")
      .select(`
        *,
        room_members!inner(participant_id),
        messages(content, created_at)
      `)
      .eq("room_members.participant_id", participant.id)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    // Transform the data to match the original format
    const transformedRooms = rooms.map((room: any) => ({
      ...room,
      member_count: room.room_members?.length || 0,
      last_message: room.messages?.length > 0 
        ? room.messages.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0].content
        : null,
      room_members: undefined, // Remove from response
      messages: undefined, // Remove from response
    }));

    return NextResponse.json({ rooms: transformedRooms });
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

// POST /api/rooms — Create a new room
export async function POST(req: NextRequest) {
  try {
    const participant = await requireAuth(req);
    const body = await req.json();
    const { name, description, topic, context, room_type = 'chat', ttl_hours } = body;

    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    // Validate room_type
    if (!['chat', 'broadcast', 'readonly'].includes(room_type)) {
      return NextResponse.json(
        { error: "room_type must be one of: chat, broadcast, readonly" },
        { status: 400 }
      );
    }

    const id = `room_${nanoid(12)}`;

    // Create room with new fields
    const { error: roomError } = await supabaseAdmin
      .from("rooms")
      .insert({
        id,
        name,
        description: description || null,
        topic: topic || null,
        context: context || null,
        room_type,
        ttl_hours: ttl_hours || null,
        created_by: participant.id,
      });

    if (roomError) {
      throw new Error(roomError.message);
    }

    // Auto-join the creator
    const { error: memberError } = await supabaseAdmin
      .from("room_members")
      .insert({
        room_id: id,
        participant_id: participant.id,
      });

    if (memberError) {
      throw new Error(memberError.message);
    }

    return NextResponse.json({
      id,
      name,
      description,
      topic,
      context,
      room_type,
      ttl_hours,
      created_by: participant.id,
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
