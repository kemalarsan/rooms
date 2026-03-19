import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// GET /api/rooms/:roomId/messages/:messageId/status - Get delivery status for a message
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string; messageId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId, messageId } = await params;

    // Verify the participant is a member of the room
    const { data: member, error: memberError } = await getSupabaseAdmin()
      .from("room_members")
      .select("*")
      .eq("room_id", roomId)
      .eq("participant_id", participant.id)
      .single();

    if (memberError || !member) {
      return NextResponse.json(
        { error: "Not a member of this room" },
        { status: 403 }
      );
    }

    // Verify the message exists and belongs to this room
    const { data: message, error: messageError } = await getSupabaseAdmin()
      .from("messages")
      .select("id, participant_id")
      .eq("id", messageId)
      .eq("room_id", roomId)
      .single();

    if (messageError || !message) {
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404 }
      );
    }

    // Get all room members
    const { data: allMembers, error: membersError } = await getSupabaseAdmin()
      .from("room_members")
      .select(`
        participant_id,
        participants!inner(
          id,
          name,
          type,
          avatar
        )
      `)
      .eq("room_id", roomId);

    if (membersError) {
      throw new Error(membersError.message);
    }

    // Get delivery statuses for this message
    const { data: deliveries, error: deliveriesError } = await getSupabaseAdmin()
      .from("message_deliveries")
      .select("participant_id, status, delivered_at, attempts, error")
      .eq("message_id", messageId);

    if (deliveriesError) {
      throw new Error(deliveriesError.message);
    }

    // Build delivery status for each recipient (excluding the sender)
    const recipients = allMembers.filter((m: any) => m.participant_id !== message.participant_id);
    const deliveryMap = new Map(deliveries.map(d => [d.participant_id, d]));

    const deliveryStatus = recipients.map((member: any) => {
      const delivery = deliveryMap.get(member.participant_id);
      return {
        participant_id: member.participant_id,
        participant_name: member.participants.name,
        participant_type: member.participants.type,
        avatar: member.participants.avatar,
        status: delivery?.status || "pending",
        delivered_at: delivery?.delivered_at || null,
        attempts: delivery?.attempts || 0,
        error: delivery?.error || null,
      };
    });

    // Summary stats
    const totalRecipients = recipients.length;
    const deliveredCount = deliveryStatus.filter(d => d.status === "delivered").length;
    const pendingCount = deliveryStatus.filter(d => d.status === "pending").length;
    const failedCount = deliveryStatus.filter(d => d.status === "failed").length;

    return NextResponse.json({
      message_id: messageId,
      room_id: roomId,
      total_recipients: totalRecipients,
      delivered_count: deliveredCount,
      pending_count: pendingCount,
      failed_count: failedCount,
      deliveries: deliveryStatus,
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