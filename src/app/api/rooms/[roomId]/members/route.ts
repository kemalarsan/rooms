import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { requireAuth } from "@/lib/auth";

// GET /api/rooms/:roomId/members — List room members
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const participant = requireAuth(req);
    const { roomId } = await params;
    const db = getDb();

    // Verify membership
    const member = db
      .prepare(
        "SELECT * FROM room_members WHERE room_id = ? AND participant_id = ?"
      )
      .get(roomId, participant.id);

    if (!member) {
      return NextResponse.json(
        { error: "Not a member of this room" },
        { status: 403 }
      );
    }

    const members = db
      .prepare(
        `SELECT p.id, p.name, p.type, p.avatar, p.capabilities, rm.joined_at
         FROM participants p
         JOIN room_members rm ON p.id = rm.participant_id
         WHERE rm.room_id = ?
         ORDER BY rm.joined_at ASC`
      )
      .all(roomId);

    return NextResponse.json({ members });
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
