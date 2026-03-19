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

// GET /api/participants/me/stream — Global SSE stream for all participant's rooms
export async function GET(req: NextRequest) {
  const participant = (await getParticipantFromRequest(req)) || (await getParticipantFromQuery(req));
  if (!participant) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Get all rooms this participant is a member of
  const { data: memberships, error: memberError } = await getSupabaseAdmin()
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

      // Set up Supabase Realtime subscription for messages
      let subscription: any = null;
      
      if (roomIds.length > 0) {
        subscription = supabase
          .channel(`participant-${participant.id}-messages`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'messages',
              filter: `room_id=in.(${roomIds.join(',')})`
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
                      rooms: roomIds
                    })}\n\n`
                  )
                );
              } catch {
                // Stream closed
              }
            }
          });
      }

      // Clean up on disconnect
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        if (subscription) {
          subscription.unsubscribe();
        }
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