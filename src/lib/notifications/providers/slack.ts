import type {
  NotificationProvider,
  NotificationItem,
  NotificationContext,
} from "../types";

/**
 * Slack Notification Provider
 *
 * Sends DMs to Slack users when room activity occurs.
 * Uses Slack Bot API (chat.postMessage) with rich Block Kit formatting.
 *
 * Target: Slack user ID (e.g., U0ADTB6NK5K)
 * Requires: HIVIUM_SLACK_BOT_TOKEN env var
 * Bot needs: chat:write, im:write, users:read scopes
 */
export class SlackProvider implements NotificationProvider {
  channel = "slack" as const;
  displayName = "Slack";

  private get token(): string | undefined {
    return process.env.HIVIUM_SLACK_BOT_TOKEN;
  }

  isConfigured(): boolean {
    return !!this.token;
  }

  validateTarget(target: string): string | null {
    // Slack user IDs start with U or W, workspace IDs with T
    if (!/^[UW][A-Z0-9]{8,}$/.test(target)) {
      return "Slack target must be a user ID (starts with U, e.g. U0ADTB6NK5K). Find it in Slack profile → More → Copy member ID.";
    }
    return null;
  }

  async send(
    target: string,
    items: NotificationItem[],
    context: NotificationContext,
  ): Promise<boolean> {
    const token = this.token;
    if (!token) return false;

    // Open DM channel
    const dmChannel = await this.openDM(token, target);
    if (!dmChannel) return false;

    // Build message
    const { text, blocks } = this.formatMessage(items, context);

    // Send
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: dmChannel,
        text, // Fallback for notifications/accessibility
        blocks,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      console.error(`[slack-notify] postMessage failed: ${data.error}`);
      return false;
    }

    console.log(`[slack-notify] DM sent to ${target} for ${context.room_name}`);
    return true;
  }

  private async openDM(
    token: string,
    userId: string,
  ): Promise<string | null> {
    const res = await fetch("https://slack.com/api/conversations.open", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ users: userId }),
    });

    const data = await res.json();
    if (!data.ok) {
      console.error(`[slack-notify] conversations.open failed: ${data.error}`);
      return null;
    }
    return data.channel.id;
  }

  private formatMessage(
    items: NotificationItem[],
    context: NotificationContext,
  ): { text: string; blocks: any[] } {
    let text: string;

    if (items.length === 1) {
      const m = items[0];
      text = `🐝 *${context.room_name}*\n${m.sender_name}: ${m.content_preview}`;
    } else {
      // Digest
      const senders = [...new Set(items.map((m) => m.sender_name))];
      const senderList =
        senders.length <= 3
          ? senders.join(", ")
          : `${senders.slice(0, 2).join(", ")} and ${senders.length - 2} others`;

      text = `🐝 *${context.room_name}* — ${items.length} new messages\nFrom: ${senderList}`;

      // Show last 3 as preview
      for (const m of items.slice(-3)) {
        const short =
          m.content_preview.length > 100
            ? m.content_preview.slice(0, 100) + "…"
            : m.content_preview;
        text += `\n> ${m.sender_name}: ${short}`;
      }
    }

    const blocks = [
      {
        type: "section",
        text: { type: "mrkdwn", text },
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Open in Hivium →", emoji: true },
            url: context.room_url,
            action_id: "open_hivium_room",
            style: "primary",
          },
        ],
      },
    ];

    return { text, blocks };
  }
}
