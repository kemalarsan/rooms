import { getSupabaseAdmin } from "@/lib/supabase";

export interface MessageDelivery {
  id: string;
  message_id: string;
  participant_id: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  last_attempt_at: string | null;
  delivered_at: string | null;
  error: string | null;
  created_at: string;
}

export interface WebhookPayload {
  event: "message";
  room_id: string;
  message: {
    id: string;
    content: string;
    participant_name: string;
    participant_type: "human" | "agent";
    created_at: string;
    content_type: string;
    reply_to: string | null;
    metadata: string | null;
  };
}

/**
 * Create delivery records for a new message and attempt immediate delivery
 */
export async function fanoutMessage(messageData: any, roomId: string) {
  try {
    // Get all room members except the sender (without webhook_url for now)
    const { data: members, error: membersError } = await getSupabaseAdmin()
      .from("room_members")
      .select("participant_id, participants!inner(id)")
      .eq("room_id", roomId)
      .neq("participant_id", messageData.participant_id);

    if (membersError) {
      console.error("Error fetching room members:", membersError);
      return;
    }

    // Check if message_deliveries table exists
    let hasDeliveriesTable = true;
    try {
      await getSupabaseAdmin().from("message_deliveries").select("id").limit(1);
    } catch (error: any) {
      if (error.message?.includes("message_deliveries") || error.message?.includes("relation") || error.code === "PGRST106") {
        hasDeliveriesTable = false;
        console.log("message_deliveries table not available, skipping delivery tracking");
        return;
      }
    }

    // Get webhook URLs for all members
    const { data: allParticipants } = await getSupabaseAdmin()
      .from("participants")
      .select("id, webhook_url")
      .in("id", members.map(m => m.participant_id));

    const webhookMap = new Map((allParticipants || []).map((p: { id: string; webhook_url: string | null }) => [p.id, p.webhook_url]));

    // Create delivery records — "pending" for those with webhooks, "delivered" for UI-only users
    const deliveryRecords = members.map((member) => {
      const hasWebhook = !!webhookMap.get(member.participant_id);
      return {
        id: `del_${crypto.randomUUID()}`,
        message_id: messageData.id,
        participant_id: member.participant_id,
        status: hasWebhook ? ("pending" as const) : ("delivered" as const),
        attempts: 0,
        last_attempt_at: null,
        delivered_at: hasWebhook ? null : new Date().toISOString(),
        error: null,
      };
    });

    const { error: insertError } = await getSupabaseAdmin()
      .from("message_deliveries")
      .insert(deliveryRecords);

    if (insertError) {
      console.error("Error creating delivery records:", insertError);
      return;
    }

    console.log(`Created ${deliveryRecords.length} delivery records for message ${messageData.id}`);

    // Attempt immediate webhook delivery for participants with webhook URLs
    const { data: webhookParticipants } = await getSupabaseAdmin()
      .from("participants")
      .select("id, webhook_url")
      .in("id", members.map(m => m.participant_id))
      .not("webhook_url", "is", null);

    if (webhookParticipants && webhookParticipants.length > 0) {
      const deliveryMap = new Map(deliveryRecords.map(d => [d.participant_id, d.id]));
      
      // Fire webhooks in parallel (don't await — fire and forget)
      for (const wp of webhookParticipants) {
        const deliveryId = deliveryMap.get(wp.id);
        if (deliveryId && wp.webhook_url) {
          attemptWebhookDelivery(deliveryId, wp.webhook_url, messageData, roomId)
            .then(ok => console.log(`Webhook to ${wp.id}: ${ok ? 'delivered' : 'failed'}`))
            .catch(err => console.error(`Webhook to ${wp.id} error:`, err));
        }
      }
    }

  } catch (error) {
    console.error("Error in fanoutMessage:", error);
  }
}

/**
 * Attempt webhook delivery for a specific delivery record
 */
export async function attemptWebhookDelivery(
  deliveryId: string, 
  webhookUrl: string, 
  messageData: any, 
  roomId: string
): Promise<boolean> {
  try {
    // Get current attempts count and increment
    const { data: delivery } = await getSupabaseAdmin()
      .from("message_deliveries")
      .select("attempts")
      .eq("id", deliveryId)
      .single();

    const currentAttempts = delivery?.attempts || 0;

    // Increment attempt count
    const { error: updateError } = await getSupabaseAdmin()
      .from("message_deliveries")
      .update({
        attempts: currentAttempts + 1,
        last_attempt_at: new Date().toISOString(),
      })
      .eq("id", deliveryId);

    if (updateError) {
      console.error("Error updating delivery attempt:", updateError);
    }

    // Prepare webhook payload
    const payload: WebhookPayload = {
      event: "message",
      room_id: roomId,
      message: {
        id: messageData.id,
        content: messageData.content,
        participant_name: messageData.participant_name || messageData.participants?.name,
        participant_type: messageData.participant_type || messageData.participants?.type,
        created_at: messageData.created_at,
        content_type: messageData.content_type,
        reply_to: messageData.reply_to,
        metadata: messageData.metadata,
      },
    };

    // Make webhook request
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Rooms/1.0",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000), // 30s timeout — Tailscale Funnel can be slow
    });

    const success = response.status === 200;

    // Update delivery status
    await getSupabaseAdmin()
      .from("message_deliveries")
      .update({
        status: success ? "delivered" : "failed",
        delivered_at: success ? new Date().toISOString() : null,
        error: success ? null : `HTTP ${response.status}: ${response.statusText}`,
      })
      .eq("id", deliveryId);

    return success;
  } catch (error) {
    // Update with error status
    await getSupabaseAdmin()
      .from("message_deliveries")
      .update({
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      })
      .eq("id", deliveryId);

    return false;
  }
}

/**
 * Retry pending deliveries with exponential backoff
 */
export async function retryPendingDeliveries() {
  try {
    const now = new Date();
    const delays = [1000, 5000, 30000, 120000, 600000]; // 1s, 5s, 30s, 2min, 10min

    // Get failed/pending deliveries that are eligible for retry
    const { data: pendingDeliveries, error } = await getSupabaseAdmin()
      .from("message_deliveries")
      .select(`
        id,
        message_id,
        participant_id,
        attempts,
        last_attempt_at,
        messages!inner(
          id,
          room_id,
          content,
          content_type,
          reply_to,
          metadata,
          created_at,
          participants!messages_participant_id_fkey(
            name,
            type
          )
        ),
        participants!message_deliveries_participant_id_fkey(
          webhook_url
        )
      `)
      .in("status", ["pending", "failed"])
      .lt("attempts", 5)
      .not("participants.webhook_url", "is", null);

    if (error) {
      console.error("Error fetching pending deliveries:", error);
      return;
    }

    for (const delivery of pendingDeliveries as any[]) {
      const { attempts, last_attempt_at } = delivery;
      
      // Calculate when next attempt is allowed
      if (attempts > 0 && last_attempt_at) {
        const lastAttempt = new Date(last_attempt_at);
        const delay = delays[Math.min(attempts - 1, delays.length - 1)];
        const nextAttemptTime = new Date(lastAttempt.getTime() + delay);
        
        if (now < nextAttemptTime) {
          continue; // Too soon for retry
        }
      }

      // Attempt delivery
      const message = delivery.messages;
      const webhookUrl = delivery.participants?.webhook_url;
      
      if (webhookUrl && message) {
        const messageData = {
          ...message,
          participant_name: message.participants?.name,
          participant_type: message.participants?.type,
        };
        
        await attemptWebhookDelivery(
          delivery.id,
          webhookUrl,
          messageData,
          message.room_id
        );
      }
    }
  } catch (error) {
    console.error("Error in retryPendingDeliveries:", error);
  }
}

/**
 * Get undelivered messages for a participant
 */
export async function getUndeliveredMessages(participantId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("message_deliveries")
    .select(`
      id,
      message_id,
      created_at,
      messages!inner(
        id,
        room_id,
        content,
        content_type,
        reply_to,
        metadata,
        created_at,
        participants!messages_participant_id_fkey(
          name,
          type,
          avatar
        )
      )
    `)
    .eq("participant_id", participantId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  return data.map((delivery: any) => ({
    delivery_id: delivery.id,
    message: {
      ...delivery.messages,
      participant_name: delivery.messages.participants?.name,
      participant_type: delivery.messages.participants?.type,
      avatar: delivery.messages.participants?.avatar,
    },
  }));
}

/**
 * Acknowledge receipt of messages
 */
export async function acknowledgeMessages(participantId: string, messageIds: string[]) {
  const { error } = await getSupabaseAdmin()
    .from("message_deliveries")
    .update({
      status: "delivered",
      delivered_at: new Date().toISOString(),
    })
    .eq("participant_id", participantId)
    .in("message_id", messageIds);

  if (error) {
    throw error;
  }
}