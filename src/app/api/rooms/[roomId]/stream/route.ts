import { NextRequest } from "next/server";
import { getParticipantFromRequest, Participant } from "@/lib/auth";
import getDb from "@/lib/db";
import { roomEvents } from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getParticipantFromQuery(req: NextRequest): Participant | null {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return null;
  const db = getDb();
  return (db.prepare("SELECT * FROM participants WHERE api_key = ?").get(token) as Participant) || null;
}

// GET /api/rooms/:roomId/stream — SSE stream of room events
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const participant = getParticipantFromRequest(req) || getParticipantFromQuery(req);
  if (!participant) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { roomId } = await params;
  const db = getDb();

  // Verify membership
  const member = db
    .prepare(
      "SELECT * FROM room_members WHERE room_id = ? AND participant_id = ?"
    )
    .get(roomId, participant.id);

  if (!member) {
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

      // Subscribe to room events
      const unsubscribe = roomEvents.subscribe(roomId, (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          unsubscribe();
          clearInterval(heartbeat);
        }
      });

      // Clean up on disconnect
      req.signal.addEventListener("abort", () => {
        unsubscribe();
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
