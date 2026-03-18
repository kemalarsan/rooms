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

// GET /api/rooms/:roomId/stream — SSE stream of room events
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const participant = (await getParticipantFromRequest(req)) || (await getParticipantFromQuery(req));
  if (!participant) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { roomId } = await params;

  // Verify membership
  const { data: member, error: memberError } = await supabaseAdmin
    .from("room_members")
    .select("*")
    .eq("room_id", roomId)
    .eq("participant_id", participant.id)
    .single();

  if (memberError || !member) {
    return new Response("Not a member of this room", { status: 403 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection event
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "connected", roomId, participantId: participant.id })}\n\n`
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

      // Note: This endpoint is deprecated in favor of Supabase Realtime
      // Keeping it for backward compatibility but it won't receive events

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
    },
  });
}
