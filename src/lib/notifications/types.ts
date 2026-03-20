/**
 * Hivium Notification System — Types
 *
 * Designed for extensibility: each channel (Slack, Telegram, Discord, email, etc.)
 * implements the NotificationProvider interface. The dispatcher doesn't know or care
 * about channel-specific details.
 */

/** Supported notification channels */
export type NotificationChannel = "slack" | "telegram" | "discord" | "email" | "webhook";

/** When to notify */
export type NotifyOn = "all" | "mentions" | "none";

/** A stored notification preference */
export interface NotificationPreference {
  id: string;
  participant_id: string;
  channel: NotificationChannel;
  target: string;            // Channel-specific: Slack user ID, Telegram chat ID, email, webhook URL, etc.
  target_meta?: string;      // Optional JSON blob for extra channel config (e.g., thread_ts, topic_id)
  notify_on: NotifyOn;
  batch_seconds: number;     // 0 = instant, >0 = digest window
  room_id: string | null;    // null = global, room_id = room-specific override
  enabled: boolean;
}

/** Info about a message that triggered notifications */
export interface MessageInfo {
  id: string;
  room_id: string;
  content: string;
  participant_id: string;
  participant_name: string;
  participant_type: "human" | "agent";
  created_at: string;
}

/** A single notification item (may be one of several in a digest) */
export interface NotificationItem {
  sender_name: string;
  content_preview: string;
  room_id: string;
  message_id: string;
  timestamp: string;
}

/** Context passed to a provider when sending */
export interface NotificationContext {
  room_name: string;
  room_url: string;
  room_id: string;
  is_digest: boolean;          // true if this is a batched digest
  total_in_batch: number;      // how many messages in this batch
}

/**
 * Interface every notification provider must implement.
 *
 * To add a new channel:
 * 1. Create src/lib/notifications/providers/my-channel.ts
 * 2. Implement NotificationProvider
 * 3. Register it in providers/index.ts
 * That's it. No changes to dispatcher, types, or preferences needed.
 */
export interface NotificationProvider {
  /** Channel identifier — must match NotificationChannel type */
  channel: NotificationChannel;

  /** Human-readable name for logs and admin UI */
  displayName: string;

  /**
   * Check if this provider is configured and ready to send.
   * Called at startup and before first send. If false, notifications
   * for this channel are silently skipped (not errored).
   */
  isConfigured(): boolean;

  /**
   * Validate a target string for this channel.
   * Returns a human-readable error or null if valid.
   * Used by the preferences API to catch bad targets early.
   */
  validateTarget(target: string): string | null;

  /**
   * Send a notification. May be a single message or a digest.
   * Provider is responsible for formatting appropriately.
   *
   * @returns true if sent successfully, false otherwise
   */
  send(
    target: string,
    items: NotificationItem[],
    context: NotificationContext,
    targetMeta?: string,
  ): Promise<boolean>;
}
