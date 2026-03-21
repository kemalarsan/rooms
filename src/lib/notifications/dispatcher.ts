import { getSupabaseAdmin } from "@/lib/supabase";
import { getProvider } from "./providers";
import { generateMagicToken } from "@/lib/magic-token";
import type {
  NotificationPreference,
  MessageInfo,
  NotificationItem,
  NotificationContext,
} from "./types";

/**
 * Hivium Notification Dispatcher
 *
 * Orchestrates notification delivery: figures out who needs to be notified,
 * applies preferences and batching, then delegates to the appropriate provider.
 *
 * This module knows NOTHING about Slack, Telegram, etc. — it only talks
 * to the NotificationProvider interface.
 */

// In-memory batch timers: key -> timeout handle
const batchTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Rate limit: track last notification per preference
const lastNotificationTime = new Map<string, number>();
const MIN_NOTIFICATION_GAP_MS = 5000;

/**
 * Notify room members about a new message.
 * Called from fanoutMessage in delivery.ts — fire and forget.
 */
export async function notifyRoomMembers(message: MessageInfo): Promise<void> {
  try {
    const db = getSupabaseAdmin();

    // Get room members except sender
    const { data: members, error: membersError } = await db
      .from("room_members")
      .select("participant_id")
      .eq("room_id", message.room_id)
      .neq("participant_id", message.participant_id);

    if (membersError || !members?.length) return;

    const memberIds = members.map((m) => m.participant_id);

    // Get enabled notification preferences for these members
    const { data: prefs, error: prefsError } = await db
      .from("notification_preferences")
      .select("*")
      .in("participant_id", memberIds)
      .eq("enabled", true);

    if (prefsError || !prefs?.length) return;

    // Filter: room-specific prefs override global ones
    const applicablePrefs = resolvePreferences(
      prefs as NotificationPreference[],
      message.room_id,
    );

    // Get room name
    const { data: room } = await db
      .from("rooms")
      .select("name")
      .eq("id", message.room_id)
      .single();

    const roomName = room?.name || message.room_id;

    // Process each preference
    for (const pref of applicablePrefs) {
      // Skip if channel provider doesn't exist or isn't configured
      const provider = getProvider(pref.channel);
      if (!provider || !provider.isConfigured()) continue;

      // Skip muted
      if (pref.notify_on === "none") continue;

      // Check mentions filter
      if (pref.notify_on === "mentions") {
        const { data: participant } = await db
          .from("participants")
          .select("name")
          .eq("id", pref.participant_id)
          .single();

        if (participant && !message.content.includes(`@${participant.name}`)) {
          continue;
        }
      }

      const preview =
        message.content.length > 200
          ? message.content.slice(0, 200) + "…"
          : message.content;

      const item: NotificationItem = {
        sender_name: message.participant_name,
        content_preview: preview,
        room_id: message.room_id,
        message_id: message.id,
        timestamp: message.created_at,
      };

      if (pref.batch_seconds === 0) {
        // Instant (with rate limiting)
        const lastTime = lastNotificationTime.get(pref.id) || 0;
        const now = Date.now();
        if (now - lastTime < MIN_NOTIFICATION_GAP_MS) {
          await queueForBatch(pref, item, roomName);
        } else {
          lastNotificationTime.set(pref.id, now);
          const context = buildContext(message.room_id, roomName, false, 1, pref.participant_id);
          provider.send(pref.target, [item], context, pref.target_meta).catch((err) =>
            console.error(`[notifications] ${pref.channel} send error:`, err),
          );
        }
      } else {
        await queueForBatch(pref, item, roomName);
      }
    }
  } catch (error) {
    console.error("[notifications] Error in notifyRoomMembers:", error);
  }
}

/**
 * Resolve preferences: room-specific overrides global for same participant+channel
 */
function resolvePreferences(
  prefs: NotificationPreference[],
  roomId: string,
): NotificationPreference[] {
  const groups = new Map<string, NotificationPreference[]>();

  for (const pref of prefs) {
    const key = `${pref.participant_id}:${pref.channel}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(pref);
  }

  const result: NotificationPreference[] = [];
  for (const [, group] of groups) {
    const roomSpecific = group.find((p) => p.room_id === roomId);
    const global = group.find((p) => p.room_id === null);
    const chosen = roomSpecific || global;
    if (chosen) result.push(chosen);
  }

  return result;
}

/**
 * Queue a notification for batched delivery
 */
async function queueForBatch(
  pref: NotificationPreference,
  item: NotificationItem,
  roomName: string,
): Promise<void> {
  const batchKey = `${pref.id}:${item.room_id}:${Math.floor(
    Date.now() / 1000 / Math.max(pref.batch_seconds || 30, 10),
  )}`;

  const db = getSupabaseAdmin();
  await db.from("notification_queue").insert({
    preference_id: pref.id,
    participant_id: pref.participant_id,
    room_id: item.room_id,
    message_id: item.message_id,
    sender_name: item.sender_name,
    content_preview: item.content_preview,
    batch_key: batchKey,
  });

  // Set timer if not already running
  const timerKey = `${pref.id}:${item.room_id}`;
  if (batchTimers.has(timerKey)) return;

  const delay = Math.max(pref.batch_seconds || 30, 10) * 1000;
  const timer = setTimeout(() => {
    batchTimers.delete(timerKey);
    flushBatch(pref, item.room_id, roomName).catch((err) =>
      console.error("[notifications] Batch flush error:", err),
    );
  }, delay);

  batchTimers.set(timerKey, timer);
}

/**
 * Flush queued messages into a single digest notification
 */
async function flushBatch(
  pref: NotificationPreference,
  roomId: string,
  roomName: string,
): Promise<void> {
  const db = getSupabaseAdmin();

  const { data: queued, error } = await db
    .from("notification_queue")
    .select("*")
    .eq("preference_id", pref.id)
    .eq("room_id", roomId)
    .is("sent_at", null)
    .order("created_at", { ascending: true })
    .limit(20);

  if (error || !queued?.length) return;

  const items: NotificationItem[] = queued.map((q) => ({
    sender_name: q.sender_name,
    content_preview: q.content_preview,
    room_id: q.room_id,
    message_id: q.message_id,
    timestamp: q.created_at,
  }));

  const provider = getProvider(pref.channel);
  if (provider?.isConfigured()) {
    const context = buildContext(roomId, roomName, true, items.length, pref.participant_id);
    await provider.send(pref.target, items, context, pref.target_meta);
  }

  // Mark sent
  const ids = queued.map((q) => q.id);
  await db
    .from("notification_queue")
    .update({ sent_at: new Date().toISOString() })
    .in("id", ids);
}

function buildContext(
  roomId: string,
  roomName: string,
  isDigest: boolean,
  total: number,
  participantId: string,
): NotificationContext {
  // Generate personalized magic link for this participant
  const magicToken = generateMagicToken(participantId, roomId);
  const room_url = `https://hivium.ai/room/${roomId}?t=${magicToken}`;
  
  return {
    room_name: roomName,
    room_url,
    room_id: roomId,
    is_digest: isDigest,
    total_in_batch: total,
  };
}
