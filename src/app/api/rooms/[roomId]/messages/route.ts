import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { nanoid } from "nanoid";
import { fanoutMessage } from "@/lib/delivery";

// GET /api/rooms/:roomId/messages — Get message history
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

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
    const before = url.searchParams.get("before");

    let query = supabaseAdmin
      .from("messages")
      .select(`
        *,
        participants!messages_participant_id_fkey (
          name,
          type,
          avatar
        )
      `)
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (before) {
      // Get the timestamp of the 'before' message
      const { data: beforeMessage } = await supabaseAdmin
        .from("messages")
        .select("created_at")
        .eq("id", before)
        .single();
      
      if (beforeMessage) {
        query = query.lt("created_at", beforeMessage.created_at);
      }
    }

    const { data: messages, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    // Transform to match original format
    const transformedMessages = messages.map((msg: any) => ({
      ...msg,
      participant_name: msg.participants?.name,
      participant_type: msg.participants?.type,
      avatar: msg.participants?.avatar,
      participants: undefined, // Remove from response
    })).reverse();

    return NextResponse.json({ messages: transformedMessages });
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

// POST /api/rooms/:roomId/messages — Send a message
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId } = await params;
    const body = await req.json();
    const { content, contentType, replyTo, metadata } = body;

    if (!content) {
      return NextResponse.json(
        { error: "content is required" },
        { status: 400 }
      );
    }

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

    const id = `msg_${nanoid(16)}`;

    const messageData = {
      id,
      room_id: roomId,
      participant_id: participant.id,
      content,
      content_type: contentType || "text/markdown",
      reply_to: replyTo || null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    };

    const { data: insertedMessage, error } = await supabaseAdmin
      .from("messages")
      .insert(messageData)
      .select(`
        *,
        participants!messages_participant_id_fkey (
          name,
          type,
          avatar
        )
      `)
      .single();

    if (error) {
      throw new Error(error.message);
    }

    const message = {
      ...insertedMessage,
      participant_name: insertedMessage.participants.name,
      participant_type: insertedMessage.participants.type,
      avatar: insertedMessage.participants.avatar,
      participants: undefined,
    };

    // Trigger message delivery fanout (fire and forget)
    fanoutMessage(message, roomId).catch(error => 
      console.error("Error in message fanout:", error)
    );

    return NextResponse.json(message, { status: 201 });
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
