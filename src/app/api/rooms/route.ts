import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { nanoid } from "nanoid";

// GET /api/rooms — List rooms the participant is in
export async function GET(req: NextRequest) {
  try {
    const participant = requireAuth(req);
    const db = getDb();

    const rooms = db
      .prepare(
        `SELECT r.*, 
          (SELECT COUNT(*) FROM room_members rm WHERE rm.room_id = r.id) as member_count,
          (SELECT m.content FROM messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) as last_message
         FROM rooms r
         JOIN room_members rm ON r.id = rm.room_id
         WHERE rm.participant_id = ?
         ORDER BY r.created_at DESC`
      )
      .all(participant.id);

    return NextResponse.json({ rooms });
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
    const participant = requireAuth(req);
    const body = await req.json();
    const { name, description } = body;

    if (!name) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    const id = `room_${nanoid(12)}`;
    const db = getDb();

    db.prepare(
      `INSERT INTO rooms (id, name, description, created_by) VALUES (?, ?, ?, ?)`
    ).run(id, name, description || null, participant.id);

    // Auto-join the creator
    db.prepare(
      `INSERT INTO room_members (room_id, participant_id) VALUES (?, ?)`
    ).run(id, participant.id);

    return NextResponse.json({
      id,
      name,
      description,
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
