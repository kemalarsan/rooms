import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * POST /api/admin/cleanup — Bulk delete participants and their data
 * 
 * Body: { participantIds: string[], deleteMessages?: boolean, deleteRooms?: boolean }
 * 
 * Cascading delete order:
 * 1. notification_preferences
 * 2. notification_queue  
 * 3. message_deliveries
 * 4. messages (if deleteMessages)
 * 5. room_members
 * 6. invite_links (created_by)
 * 7. invite_emails (sent_by)
 * 8. rooms (created_by, if deleteRooms)
 * 9. participants
 */
export async function POST(req: NextRequest) {
  try {
    requireAdmin(req);
    const db = getSupabaseAdmin();
    const body = await req.json();
    
    const { participantIds, deleteMessages = true, deleteRooms = true } = body;
    
    if (!Array.isArray(participantIds) || participantIds.length === 0) {
      return NextResponse.json({ error: "participantIds array is required" }, { status: 400 });
    }

    if (participantIds.length > 200) {
      return NextResponse.json({ error: "Max 200 participants per request" }, { status: 400 });
    }

    const results: Record<string, number> = {};

    // 1. Delete notification preferences
    const { count: notifPrefs } = await db
      .from("notification_preferences")
      .delete({ count: "exact" })
      .in("participant_id", participantIds);
    results.notificationPreferences = notifPrefs || 0;

    // 2. Delete from notification queue (sender)
    const { count: notifQueue } = await db
      .from("notification_queue")
      .delete({ count: "exact" })
      .in("participant_id", participantIds);
    results.notificationQueue = notifQueue || 0;

    // 3. Delete message deliveries for these participants' messages
    if (deleteMessages) {
      const { data: msgIds } = await db
        .from("messages")
        .select("id")
        .in("participant_id", participantIds);
      
      if (msgIds && msgIds.length > 0) {
        // Batch delete deliveries in chunks
        const ids = msgIds.map(m => m.id);
        for (let i = 0; i < ids.length; i += 100) {
          const chunk = ids.slice(i, i + 100);
          await db.from("message_deliveries").delete().in("message_id", chunk);
        }
      }
      results.messageDeliveryLookups = msgIds?.length || 0;
    }

    // 4. Delete messages
    if (deleteMessages) {
      const { count: msgs } = await db
        .from("messages")
        .delete({ count: "exact" })
        .in("participant_id", participantIds);
      results.messages = msgs || 0;
    }

    // 5. Delete room memberships
    const { count: members } = await db
      .from("room_members")
      .delete({ count: "exact" })
      .in("participant_id", participantIds);
    results.roomMembers = members || 0;

    // 6. Delete invite links they created
    const { count: invites } = await db
      .from("invite_links")
      .delete({ count: "exact" })
      .in("created_by", participantIds);
    results.inviteLinks = invites || 0;

    // 7. Delete invite emails they sent
    try {
      const { count: emails } = await db
        .from("invite_emails")
        .delete({ count: "exact" })
        .in("sent_by", participantIds);
      results.inviteEmails = emails || 0;
    } catch {
      results.inviteEmails = 0; // table may not exist
    }

    // 8. Delete rooms they created (if empty after member cleanup)
    if (deleteRooms) {
      const { data: ownedRooms } = await db
        .from("rooms")
        .select("id")
        .in("created_by", participantIds);
      
      let roomsDeleted = 0;
      for (const room of ownedRooms || []) {
        // Check if room is empty
        const { count } = await db
          .from("room_members")
          .select("*", { count: "exact", head: true })
          .eq("room_id", room.id);
        
        if ((count || 0) === 0) {
          // Delete room's messages + deliveries first
          const { data: roomMsgs } = await db
            .from("messages")
            .select("id")
            .eq("room_id", room.id);
          
          if (roomMsgs && roomMsgs.length > 0) {
            const ids = roomMsgs.map(m => m.id);
            for (let i = 0; i < ids.length; i += 100) {
              await db.from("message_deliveries").delete().in("message_id", ids.slice(i, i + 100));
            }
            await db.from("messages").delete().eq("room_id", room.id);
          }
          
          // Delete room's invite links
          await db.from("invite_links").delete().eq("room_id", room.id);
          
          // Delete the room
          await db.from("rooms").delete().eq("id", room.id);
          roomsDeleted++;
        }
      }
      results.rooms = roomsDeleted;
    }

    // 9. Finally, delete participants
    const { count: deleted } = await db
      .from("participants")
      .delete({ count: "exact" })
      .in("id", participantIds);
    results.participants = deleted || 0;

    return NextResponse.json({
      ok: true,
      deleted: results,
      summary: `Cleaned up ${results.participants} participants, ${results.messages || 0} messages, ${results.rooms || 0} empty rooms`,
    });
  } catch (error) {
    if ((error as Error).message === "Admin access required") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
