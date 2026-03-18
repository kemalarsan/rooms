import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
import { requireAuth } from "@/lib/auth";
import { roomEvents } from "@/lib/events";
import { nanoid } from "nanoid";

// GET /api/rooms/:roomId/messages — Get message history
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

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
    const before = url.searchParams.get("before");

    let messages;
    if (before) {
      messages = db
        .prepare(
          `SELECT m.*, p.name as participant_name, p.type as participant_type, p.avatar
           FROM messages m
           JOIN participants p ON m.participant_id = p.id
           WHERE m.room_id = ? AND m.created_at < (SELECT created_at FROM messages WHERE id = ?)
           ORDER BY m.created_at DESC
           LIMIT ?`
        )
        .all(roomId, before, limit);
    } else {
      messages = db
        .prepare(
          `SELECT m.*, p.name as participant_name, p.type as participant_type, p.avatar
           FROM messages m
           JOIN participants p ON m.participant_id = p.id
           WHERE m.room_id = ?
           ORDER BY m.created_at DESC
           LIMIT ?`
        )
        .all(roomId, limit);
    }

    return NextResponse.json({ messages: messages.reverse() });
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
    const participant = requireAuth(req);
    const { roomId } = await params;
    const body = await req.json();
    const { content, contentType, replyTo, metadata } = body;

    if (!content) {
      return NextResponse.json(
        { error: "content is required" },
        { status: 400 }
      );
    }

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

    const id = `msg_${nanoid(16)}`;
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO messages (id, room_id, participant_id, content, content_type, reply_to, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      roomId,
      participant.id,
      content,
      contentType || "text/markdown",
      replyTo || null,
      metadata ? JSON.stringify(metadata) : null,
      now
    );

    const message = {
      id,
      room_id: roomId,
      participant_id: participant.id,
      participant_name: participant.name,
      participant_type: participant.type,
      avatar: participant.avatar,
      content,
      content_type: contentType || "text/markdown",
      reply_to: replyTo || null,
      metadata: metadata || null,
      created_at: now,
    };

    // Emit to all SSE listeners
    roomEvents.emit(roomId, {
      type: "message",
      message,
    });

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
