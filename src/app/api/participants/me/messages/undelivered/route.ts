import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getUndeliveredMessages } from "@/lib/delivery";

// GET /api/participants/me/messages/undelivered - Get undelivered messages for current participant
export async function GET(req: NextRequest) {
  try {
    const participant = await requireAuth(req);
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
    const roomId = url.searchParams.get("room_id"); // Optional room filter

    let undeliveredMessages = await getUndeliveredMessages(participant.id);

    // Filter by room if specified
    if (roomId) {
      undeliveredMessages = undeliveredMessages.filter(
        (item) => item.message.room_id === roomId
      );
    }

    // Apply limit
    undeliveredMessages = undeliveredMessages.slice(0, limit);

    return NextResponse.json({ 
      messages: undeliveredMessages.map(item => item.message),
      delivery_info: undeliveredMessages.map(item => ({
        message_id: item.message.id,
        delivery_id: item.delivery_id
      }))
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