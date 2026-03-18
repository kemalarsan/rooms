import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { acknowledgeMessages } from "@/lib/delivery";

// POST /api/participants/me/messages/ack - Acknowledge receipt of messages
export async function POST(req: NextRequest) {
  try {
    const participant = await requireAuth(req);
    const body = await req.json();
    const { message_ids } = body;

    if (!Array.isArray(message_ids) || message_ids.length === 0) {
      return NextResponse.json(
        { error: "message_ids must be a non-empty array" },
        { status: 400 }
      );
    }

    // Validate message IDs format (optional but good practice)
    const invalidIds = message_ids.filter(id => typeof id !== "string" || !id.trim());
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: "All message_ids must be non-empty strings" },
        { status: 400 }
      );
    }

    await acknowledgeMessages(participant.id, message_ids);

    return NextResponse.json({ 
      success: true, 
      acknowledged_count: message_ids.length 
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