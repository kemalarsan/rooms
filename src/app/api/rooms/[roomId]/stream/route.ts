import { NextRequest } from "next/server";
import { getParticipantFromRequest, Participant } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { supabase } from "@/lib/supabase-browser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function getParticipantFromQuery(req: NextRequest): Promise<Participant | null> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return null;
  
  const { data: participant, error } = await getSupabaseAdmin()
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
  const { data: member, error: memberError } = await getSupabaseAdmin()
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

      // Set up Supabase Realtime subscription for this specific room
      const subscription = supabase
        .channel(`room-${roomId}-messages`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `room_id=eq.${roomId}`
          },
          (payload: any) => {
            // Don't send messages from this participant back to them
            if (payload.new.participant_id !== participant.id) {
              try {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: 'message',
                      data: payload.new
                    })}\n\n`
                  )
                );
              } catch {
                // Stream closed, will clean up below
              }
            }
          }
        )
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            try {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'subscription_ready',
                    roomId
                  })}\n\n`
                )
              );
            } catch {
              // Stream closed
            }
          }
        });

      // Clean up on disconnect
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        subscription.unsubscribe();
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
