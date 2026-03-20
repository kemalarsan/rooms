import type {
  NotificationProvider,
  NotificationItem,
  NotificationContext,
} from "../types";

/**
 * Discord Notification Provider
 *
 * Sends DM notifications via Discord Bot API.
 *
 * Target: Discord user ID (snowflake, e.g., 103327829424369664)
 * Requires: HIVIUM_DISCORD_BOT_TOKEN env var
 * Bot needs: Send Messages permission and access to create DM channels
 */
export class DiscordProvider implements NotificationProvider {
  channel = "discord" as const;
  displayName = "Discord";

  private get token(): string | undefined {
    return process.env.HIVIUM_DISCORD_BOT_TOKEN;
  }

  isConfigured(): boolean {
    return !!this.token;
  }

  validateTarget(target: string): string | null {
    if (!/^\d{17,20}$/.test(target)) {
      return "Discord target must be a user ID (snowflake). Enable Developer Mode in Discord settings, then right-click user → Copy User ID.";
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

    // Create DM channel
    const dmRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
      method: "POST",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ recipient_id: target }),
    });

    if (!dmRes.ok) {
      console.error(`[discord-notify] Create DM failed: ${dmRes.status}`);
      return false;
    }

    const dmChannel = await dmRes.json();

    // Build embed
    const embed = this.formatEmbed(items, context);

    const msgRes = await fetch(
      `https://discord.com/api/v10/channels/${dmChannel.id}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          embeds: [embed],
        }),
      },
    );

    if (!msgRes.ok) {
      console.error(`[discord-notify] Send message failed: ${msgRes.status}`);
      return false;
    }

    console.log(`[discord-notify] DM sent to ${target} for ${context.room_name}`);
    return true;
  }

  private formatEmbed(
    items: NotificationItem[],
    context: NotificationContext,
  ): any {
    let description: string;

    if (items.length === 1) {
      const m = items[0];
      description = `**${m.sender_name}:** ${m.content_preview}`;
    } else {
      const senders = [...new Set(items.map((m) => m.sender_name))];
      const senderList =
        senders.length <= 3
          ? senders.join(", ")
          : `${senders.slice(0, 2).join(", ")} and ${senders.length - 2} others`;

      description = `**${items.length} new messages** from ${senderList}\n`;

      for (const m of items.slice(-3)) {
        const short =
          m.content_preview.length > 100
            ? m.content_preview.slice(0, 100) + "…"
            : m.content_preview;
        description += `\n> **${m.sender_name}:** ${short}`;
      }
    }

    description += `\n\n[Open in Hivium →](${context.room_url})`;

    return {
      title: `🐝 ${context.room_name}`,
      description,
      color: 0xf59e0b, // Amber — Hivium brand color
      timestamp: new Date().toISOString(),
      footer: { text: "Hivium" },
    };
  }
}
