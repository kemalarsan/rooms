/**
 * Hivium Notification System
 *
 * Public API — re-exports everything consumers need.
 *
 * Architecture:
 *   types.ts          — Shared interfaces
 *   dispatcher.ts     — Orchestration, batching, preference resolution
 *   providers/        — Channel implementations (Slack, Telegram, Discord, Email, Webhook)
 *   providers/index.ts — Provider registry
 *
 * Adding a new channel:
 *   1. Create providers/my-channel.ts implementing NotificationProvider
 *   2. Register it in providers/index.ts
 *   3. Add channel name to NotificationChannel in types.ts
 *   4. Set the required env var(s) on Vercel
 *   Done. No dispatcher changes needed.
 */

export { notifyRoomMembers } from "./dispatcher";
export { getProvider, getAllProviders, getConfiguredProviders, getValidChannels, getActiveChannels } from "./providers";
export type {
  NotificationChannel,
  NotificationPreference,
  NotificationProvider,
  NotificationItem,
  NotificationContext,
  NotifyOn,
  MessageInfo,
} from "./types";
