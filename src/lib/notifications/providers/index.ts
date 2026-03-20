/**
 * Provider Registry
 *
 * Add a new notification channel in 3 steps:
 * 1. Create providers/my-channel.ts implementing NotificationProvider
 * 2. Import and instantiate it here
 * 3. Add the channel name to NotificationChannel type in types.ts
 *
 * That's it. The dispatcher, preferences API, batching, and queue
 * all work automatically.
 */

import type { NotificationProvider, NotificationChannel } from "../types";
import { SlackProvider } from "./slack";
import { TelegramProvider } from "./telegram";
import { DiscordProvider } from "./discord";
import { EmailProvider } from "./email";
import { WebhookProvider } from "./webhook";

// All registered providers
const providers: NotificationProvider[] = [
  new SlackProvider(),
  new TelegramProvider(),
  new DiscordProvider(),
  new EmailProvider(),
  new WebhookProvider(),
];

// Lookup by channel name
const providerMap = new Map<NotificationChannel, NotificationProvider>(
  providers.map((p) => [p.channel, p])
);

/** Get a specific provider by channel name */
export function getProvider(
  channel: NotificationChannel,
): NotificationProvider | undefined {
  return providerMap.get(channel);
}

/** Get all registered providers */
export function getAllProviders(): NotificationProvider[] {
  return providers;
}

/** Get only providers that are configured (have required env vars) */
export function getConfiguredProviders(): NotificationProvider[] {
  return providers.filter((p) => p.isConfigured());
}

/** Get all valid channel names */
export function getValidChannels(): NotificationChannel[] {
  return providers.map((p) => p.channel);
}

/** Get channels that are actually configured and ready */
export function getActiveChannels(): NotificationChannel[] {
  return getConfiguredProviders().map((p) => p.channel);
}
