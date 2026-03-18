import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { roomEvents } from "@/lib/events";

// POST /api/rooms/:roomId/join
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const participant = requireAuth(req);
    const { roomId } = await params;
    const db = getDb();

    const room = db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId);
    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    // Check if already a member
    const existing = db
      .prepare(
        "SELECT * FROM room_members WHERE room_id = ? AND participant_id = ?"
      )
      .get(roomId, participant.id);

    if (!existing) {
      db.prepare(
        "INSERT INTO room_members (room_id, participant_id) VALUES (?, ?)"
      ).run(roomId, participant.id);

      // Emit join event
      roomEvents.emit(roomId, {
        type: "participant_joined",
        participant: {
          id: participant.id,
          name: participant.name,
          type: participant.type,
        },
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({ ok: true, roomId, participantId: participant.id });
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
