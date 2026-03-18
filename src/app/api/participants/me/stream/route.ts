import { NextRequest } from "next/server";
import { getParticipantFromRequest, Participant } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getParticipantFromQuery(req: NextRequest): Promise<Participant | null> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return null;
  
  const { data: participant, error } = await supabaseAdmin
    .from("participants")
    .select("*")
    .eq("api_key", token)
    .single();
  
  if (error || !participant) return null;
  return participant;
}

// GET /api/participants/me/stream — Global SSE stream for all participant's rooms
export async function GET(req: NextRequest) {
  const participant = (await getParticipantFromRequest(req)) || (await getParticipantFromQuery(req));
  if (!participant) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Get all rooms this participant is a member of
  const { data: memberships, error: memberError } = await supabaseAdmin
    .from("room_members")
    .select("room_id")
    .eq("participant_id", participant.id);

  if (memberError) {
    return new Response("Error fetching memberships", { status: 500 });
  }

  const roomIds = memberships.map(m => m.room_id);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ 
            type: "connected", 
            participantId: participant.id,
            rooms: roomIds,
            timestamp: new Date().toISOString()
          })}\n\n`
        )
      );

      // Send heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      // Note: For a full implementation, you would set up Supabase Realtime
      // subscriptions here to listen for new messages across all rooms.
      // This is a placeholder implementation that maintains the connection
      // but doesn't actively push new messages. 
      //
      // To implement real-time functionality:
      // 1. Set up Supabase Realtime subscription for messages table
      // 2. Filter for messages where room_id is in roomIds
      // 3. Filter out messages from this participant
      // 4. Send SSE events for new messages

      // For now, we'll just maintain the connection for polling scenarios

      // Clean up on disconnect
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    },
  });
}