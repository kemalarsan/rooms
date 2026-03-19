import { getSupabaseAdmin } from "@/lib/supabase";

export interface RoomTrigger {
  id: string;
  room_id: string;
  pattern: string;
  action: 'invite' | 'notify' | 'webhook';
  target_participant_id: string | null;
  target_webhook_url: string | null;
  created_by: string;
  enabled: boolean;
  created_at: string;
}

export interface Message {
  id: string;
  room_id: string;
  participant_id: string;
  content: string;
  created_at: string;
  [key: string]: any;
}

export async function evaluateTriggersForMessage(message: Message): Promise<void> {
  try {
    // Fetch active triggers for the room
    const { data: triggers, error } = await getSupabaseAdmin()
      .from("room_triggers")
      .select("*")
      .eq("room_id", message.room_id)
      .eq("enabled", true);

    if (error) {
      console.error("Error fetching triggers:", error);
      return;
    }

    if (!triggers || triggers.length === 0) {
      return;
    }

    // Test message content against each trigger's regex pattern
    for (const trigger of triggers) {
      try {
        const regex = new RegExp(trigger.pattern, 'i'); // case-insensitive
        if (regex.test(message.content)) {
          await executeTriggerAction(trigger, message);
        }
      } catch (regexError) {
        console.error(`Invalid regex pattern for trigger ${trigger.id}:`, regexError);
        continue;
      }
    }
  } catch (error) {
    console.error("Error evaluating triggers:", error);
  }
}

async function executeTriggerAction(trigger: RoomTrigger, message: Message): Promise<void> {
  try {
    switch (trigger.action) {
      case 'invite':
        if (trigger.target_participant_id) {
          await autoInviteParticipant(trigger.room_id, trigger.target_participant_id);
        }
        break;

      case 'notify':
        if (trigger.target_participant_id) {
          await notifyParticipant(trigger, message);
        }
        break;

      case 'webhook':
        if (trigger.target_webhook_url) {
          await callWebhook(trigger.target_webhook_url, trigger, message);
        }
        break;

      default:
        console.warn(`Unknown trigger action: ${trigger.action}`);
    }
  } catch (error) {
    console.error(`Error executing trigger action ${trigger.action}:`, error);
  }
}

async function autoInviteParticipant(roomId: string, participantId: string): Promise<void> {
  try {
    // Check if participant is already a member
    const { data: existing, error: checkError } = await getSupabaseAdmin()
      .from("room_members")
      .select("*")
      .eq("room_id", roomId)
      .eq("participant_id", participantId)
      .maybeSingle();

    if (checkError) {
      console.error("Error checking existing membership:", checkError);
      return;
    }

    // Only add if not already a member
    if (!existing) {
      const { error: insertError } = await getSupabaseAdmin()
        .from("room_members")
        .insert({
          room_id: roomId,
          participant_id: participantId,
          role: 'member' // default role
        });

      if (insertError) {
        console.error("Error auto-inviting participant:", insertError);
      } else {
        console.log(`Auto-invited participant ${participantId} to room ${roomId}`);
      }
    }
  } catch (error) {
    console.error("Error in autoInviteParticipant:", error);
  }
}

async function notifyParticipant(trigger: RoomTrigger, message: Message): Promise<void> {
  try {
    // Get participant webhook URL
    const { data: participant, error } = await getSupabaseAdmin()
      .from("participants")
      .select("webhook_url")
      .eq("id", trigger.target_participant_id!)
      .single();

    if (error || !participant?.webhook_url) {
      console.warn(`No webhook URL for participant ${trigger.target_participant_id}`);
      return;
    }

    const payload = {
      event: "trigger",
      room_id: trigger.room_id,
      message: message,
      trigger_id: trigger.id
    };

    await callWebhook(participant.webhook_url, trigger, message, payload);
  } catch (error) {
    console.error("Error notifying participant:", error);
  }
}

async function callWebhook(
  webhookUrl: string, 
  trigger: RoomTrigger, 
  message: Message, 
  customPayload?: any
): Promise<void> {
  try {
    const payload = customPayload || {
      event: "trigger",
      room_id: trigger.room_id,
      message: message,
      trigger_id: trigger.id
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`Webhook call failed: ${response.status} ${response.statusText}`);
    } else {
      console.log(`Webhook called successfully: ${webhookUrl}`);
    }
  } catch (error) {
    console.error("Error calling webhook:", error);
  }
}