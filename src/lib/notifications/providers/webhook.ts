import type {
  NotificationProvider,
  NotificationItem,
  NotificationContext,
} from "../types";

/**
 * Webhook Notification Provider
 *
 * Generic HTTP POST — lets anyone integrate with any system.
 * This is the escape hatch: if we don't have a native provider,
 * you can always point a webhook at your own endpoint.
 *
 * Target: HTTPS URL
 */
export class WebhookProvider implements NotificationProvider {
  channel = "webhook" as const;
  displayName = "Webhook";

  isConfigured(): boolean {
    return true; // Always available — no server-side config needed
  }

  validateTarget(target: string): string | null {
    try {
      const url = new URL(target);
      if (!["http:", "https:"].includes(url.protocol)) {
        return "Webhook URL must use http or https";
      }
      return null;
    } catch {
      return "Invalid URL";
    }
  }

  async send(
    target: string,
    items: NotificationItem[],
    context: NotificationContext,
  ): Promise<boolean> {
    const payload = {
      event: "room_activity",
      room: {
        id: context.room_id,
        name: context.room_name,
        url: context.room_url,
      },
      is_digest: context.is_digest,
      message_count: items.length,
      messages: items.map((m) => ({
        id: m.message_id,
        sender: m.sender_name,
        preview: m.content_preview,
        timestamp: m.timestamp,
      })),
      sent_at: new Date().toISOString(),
    };

    const res = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Hivium/1.0",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.error(`[webhook-notify] Failed: ${res.status} ${res.statusText}`);
      return false;
    }

    console.log(`[webhook-notify] Sent to ${target} for ${context.room_name}`);
    return true;
  }
}
