import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * Hivium Notification System
 * 
 * When a message is posted to a room, notify offline members via their
 * preferred channels (Slack, Telegram, email, webhook).
 * 
 * Supports batching: rapid messages are grouped into digests to avoid spam.
 */

interface NotificationPreference {
  id: string;
  participant_id: string;
  channel: "slack" | "telegram" | "email" | "webhook";
  target: string;
  notify_on: "all" | "mentions" | "none";
  batch_seconds: number;
  room_id: string | null;
  enabled: boolean;
}

interface MessageInfo {
  id: string;
  room_id: string;
  content: string;
  participant_id: string;
  participant_name: string;
  participant_type: "human" | "agent";
  created_at: string;
}

// In-memory batch timers: preference_id -> timeout handle
const batchTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Rate limit: track last notification per preference to avoid spam
const lastNotificationTime = new Map<string, number>();
const MIN_NOTIFICATION_GAP_MS = 5000; // At least 5s between instant notifications

/**
 * Queue notifications for all room members when a new message arrives.
 * Called from fanoutMessage in delivery.ts
 */
export async function notifyRoomMembers(message: MessageInfo): Promise<void> {
  try {
    const db = getSupabaseAdmin();

    // Get all room members except the sender
    const { data: members, error: membersError } = await db
      .from("room_members")
      .select("participant_id")
      .eq("room_id", message.room_id)
      .neq("participant_id", message.participant_id);

    if (membersError || !members?.length) return;

    const memberIds = members.map(m => m.participant_id);

    // Get notification preferences for these members
    const { data: prefs, error: prefsError } = await db
      .from("notification_preferences")
      .select("*")
      .in("participant_id", memberIds)
      .eq("enabled", true);

    if (prefsError || !prefs?.length) return;

    // Filter preferences: room-specific > global
    const applicablePrefs = filterPreferences(prefs, message.room_id);

    // Get room name for the notification
    const { data: room } = await db
      .from("rooms")
      .select("name")
      .eq("id", message.room_id)
      .single();

    const roomName = room?.name || message.room_id;

    for (const pref of applicablePrefs) {
      if (pref.notify_on === "none") continue;

      // Check mentions filter
      if (pref.notify_on === "mentions") {
        // Get participant name to check for @mention
        const { data: participant } = await db
          .from("participants")
          .select("name")
          .eq("id", pref.participant_id)
          .single();

        if (participant && !message.content.includes(`@${participant.name}`)) {
          continue; // Not mentioned, skip
        }
      }

      const preview = message.content.length > 200
        ? message.content.slice(0, 200) + "…"
        : message.content;

      if (pref.batch_seconds === 0) {
        // Instant notification (with rate limiting)
        const lastTime = lastNotificationTime.get(pref.id) || 0;
        const now = Date.now();
        if (now - lastTime < MIN_NOTIFICATION_GAP_MS) {
          // Too soon — queue for batch instead
          await queueForBatch(pref, message, preview, roomName);
        } else {
          lastNotificationTime.set(pref.id, now);
          await sendNotification(pref, [{
            sender_name: message.participant_name,
            content_preview: preview,
            room_id: message.room_id,
          }], roomName);
        }
      } else {
        // Batched notification
        await queueForBatch(pref, message, preview, roomName);
      }
    }
  } catch (error) {
    console.error("[notifications] Error notifying room members:", error);
  }
}

/**
 * Filter preferences: room-specific prefs override global ones
 */
function filterPreferences(
  prefs: NotificationPreference[],
  roomId: string
): NotificationPreference[] {
  const byParticipant = new Map<string, NotificationPreference[]>();

  for (const pref of prefs) {
    const key = `${pref.participant_id}:${pref.channel}`;
    if (!byParticipant.has(key)) byParticipant.set(key, []);
    byParticipant.get(key)!.push(pref);
  }

  const result: NotificationPreference[] = [];
  for (const [, group] of byParticipant) {
    // Prefer room-specific preference
    const roomSpecific = group.find(p => p.room_id === roomId);
    const global = group.find(p => p.room_id === null);
    result.push(roomSpecific || global!);
  }

  return result.filter(Boolean);
}

/**
 * Queue a message for batched delivery
 */
async function queueForBatch(
  pref: NotificationPreference,
  message: MessageInfo,
  preview: string,
  roomName: string
): Promise<void> {
  const batchKey = `${pref.id}:${message.room_id}:${Math.floor(Date.now() / 1000 / Math.max(pref.batch_seconds, 10))}`;

  // Insert into queue
  const db = getSupabaseAdmin();
  await db.from("notification_queue").insert({
    preference_id: pref.id,
    participant_id: pref.participant_id,
    room_id: message.room_id,
    message_id: message.id,
    sender_name: message.participant_name,
    content_preview: preview,
    batch_key: batchKey,
  });

  // Set or reset batch timer
  const timerKey = `${pref.id}:${message.room_id}`;
  if (batchTimers.has(timerKey)) {
    // Timer already running — messages will be included in next flush
    return;
  }

  const delay = Math.max(pref.batch_seconds, 10) * 1000;
  const timer = setTimeout(() => {
    batchTimers.delete(timerKey);
    flushBatch(pref, message.room_id, roomName).catch(err =>
      console.error("[notifications] Batch flush error:", err)
    );
  }, delay);

  batchTimers.set(timerKey, timer);
}

/**
 * Flush queued messages for a preference+room into a single digest notification
 */
async function flushBatch(
  pref: NotificationPreference,
  roomId: string,
  roomName: string
): Promise<void> {
  const db = getSupabaseAdmin();

  // Get unsent queued messages
  const { data: queued, error } = await db
    .from("notification_queue")
    .select("*")
    .eq("preference_id", pref.id)
    .eq("room_id", roomId)
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(20);

  if (error || !queued?.length) return;

  // Deduplicate by sender
  const messages = queued.map(q => ({
    sender_name: q.sender_name,
    content_preview: q.content_preview,
    room_id: q.room_id,
  }));

  await sendNotification(pref, messages, roomName);

  // Mark as sent
  const ids = queued.map(q => q.id);
  await db
    .from("notification_queue")
    .update({ sent_at: new Date().toISOString() })
    .in("id", ids);
}

/**
 * Send the actual notification via the configured channel
 */
async function sendNotification(
  pref: NotificationPreference,
  messages: Array<{ sender_name: string; content_preview: string; room_id: string }>,
  roomName: string
): Promise<void> {
  try {
    switch (pref.channel) {
      case "slack":
        await sendSlackNotification(pref.target, messages, roomName);
        break;
      case "telegram":
        // TODO: implement
        console.log(`[notifications] Telegram notification to ${pref.target} (not yet implemented)`);
        break;
      case "email":
        // TODO: implement
        console.log(`[notifications] Email notification to ${pref.target} (not yet implemented)`);
        break;
      case "webhook":
        await sendWebhookNotification(pref.target, messages, roomName);
        break;
    }
  } catch (error) {
    console.error(`[notifications] Failed to send ${pref.channel} notification:`, error);
  }
}

/**
 * Send a Slack DM notification
 */
async function sendSlackNotification(
  slackUserId: string,
  messages: Array<{ sender_name: string; content_preview: string; room_id: string }>,
  roomName: string
): Promise<void> {
  const slackToken = process.env.HIVIUM_SLACK_BOT_TOKEN;
  if (!slackToken) {
    console.error("[notifications] HIVIUM_SLACK_BOT_TOKEN not configured");
    return;
  }

  const roomId = messages[0]?.room_id;
  const roomUrl = `https://hivium.ai/room/${roomId}`;

  let text: string;
  if (messages.length === 1) {
    const m = messages[0];
    text = `🐝 *${roomName}*\n${m.sender_name}: ${m.content_preview}`;
  } else {
    // Digest format
    const senders = [...new Set(messages.map(m => m.sender_name))];
    const senderList = senders.length <= 3
      ? senders.join(", ")
      : `${senders.slice(0, 2).join(", ")} and ${senders.length - 2} others`;
    text = `🐝 *${roomName}* — ${messages.length} new messages\nFrom: ${senderList}`;
    
    // Show last 3 messages as preview
    const recent = messages.slice(-3);
    for (const m of recent) {
      const short = m.content_preview.length > 100
        ? m.content_preview.slice(0, 100) + "…"
        : m.content_preview;
      text += `\n> ${m.sender_name}: ${short}`;
    }
  }

  // Open DM channel
  const openRes = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${slackToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ users: slackUserId }),
  });
  const openData = await openRes.json();

  if (!openData.ok) {
    console.error("[notifications] Slack conversations.open failed:", openData.error);
    return;
  }

  const channelId = openData.channel.id;

  // Send message with "Open in Hivium" button
  const sendRes = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${slackToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: channelId,
      text: text,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: text,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Open in Hivium →",
                emoji: true,
              },
              url: roomUrl,
              action_id: "open_hivium_room",
              style: "primary",
            },
          ],
        },
      ],
      unfurl_links: false,
      unfurl_media: false,
    }),
  });

  const sendData = await sendRes.json();
  if (!sendData.ok) {
    console.error("[notifications] Slack chat.postMessage failed:", sendData.error);
  } else {
    console.log(`[notifications] Slack DM sent to ${slackUserId} for room ${roomName}`);
  }
}

/**
 * Send a webhook notification
 */
async function sendWebhookNotification(
  webhookUrl: string,
  messages: Array<{ sender_name: string; content_preview: string; room_id: string }>,
  roomName: string
): Promise<void> {
  const payload = {
    event: "room_activity",
    room_name: roomName,
    room_id: messages[0]?.room_id,
    room_url: `https://hivium.ai/room/${messages[0]?.room_id}`,
    message_count: messages.length,
    messages: messages.map(m => ({
      sender: m.sender_name,
      preview: m.content_preview,
    })),
    timestamp: new Date().toISOString(),
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    console.error(`[notifications] Webhook failed: ${response.status}`);
  }
}
