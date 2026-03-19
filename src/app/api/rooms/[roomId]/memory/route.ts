import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// GET /api/rooms/:roomId/memory — List all key-value pairs
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

    // Get all memory entries for the room
    const { data: memories, error } = await getSupabaseAdmin()
      .from("room_memory")
      .select(`
        id,
        key,
        value,
        updated_at,
        updated_by,
        participants!room_memory_updated_by_fkey(name, type)
      `)
      .eq("room_id", roomId)
      .order("updated_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    // Transform the response
    const transformedMemories = memories.map((memory: any) => ({
      id: memory.id,
      key: memory.key,
      value: memory.value,
      updated_at: memory.updated_at,
      updated_by: memory.updated_by,
      updated_by_name: (memory.participants as any)?.name,
    }));

    return NextResponse.json({ memories: transformedMemories });
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

// PUT /api/rooms/:roomId/memory — Upsert a key-value pair
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId } = await params;
    const body = await req.json();
    const { key, value } = body;

    if (!key || value === undefined) {
      return NextResponse.json(
        { error: "key and value are required" },
        { status: 400 }
      );
    }

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

    // Upsert the memory entry
    const { data: memory, error } = await getSupabaseAdmin()
      .from("room_memory")
      .upsert({
        room_id: roomId,
        key,
        value: String(value),
        updated_by: participant.id,
      })
      .select(`
        id,
        key,
        value,
        updated_at,
        updated_by,
        participants!room_memory_updated_by_fkey(name, type)
      `)
      .single();

    if (error) {
      throw new Error(error.message);
    }

    // Transform the response
    const transformedMemory = {
      id: memory.id,
      key: memory.key,
      value: memory.value,
      updated_at: memory.updated_at,
      updated_by: memory.updated_by,
      updated_by_name: (memory.participants as any)?.name,
    };

    return NextResponse.json(transformedMemory);
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