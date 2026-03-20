import type {
  NotificationProvider,
  NotificationItem,
  NotificationContext,
} from "../types";

/**
 * Telegram Notification Provider
 *
 * Sends notifications via Telegram Bot API.
 *
 * Target: Telegram chat ID (numeric, e.g., 8490074005)
 * Requires: HIVIUM_TELEGRAM_BOT_TOKEN env var
 */
export class TelegramProvider implements NotificationProvider {
  channel = "telegram" as const;
  displayName = "Telegram";

  private get token(): string | undefined {
    return process.env.HIVIUM_TELEGRAM_BOT_TOKEN;
  }

  isConfigured(): boolean {
    return !!this.token;
  }

  validateTarget(target: string): string | null {
    if (!/^-?\d+$/.test(target)) {
      return "Telegram target must be a numeric chat ID. Message the bot to get your ID.";
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

    const text = this.formatMessage(items, context);

    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: parseInt(target),
          text,
          parse_mode: "HTML",
          disable_web_page_preview: false,
        }),
      },
    );

    const data = await res.json();
    if (!data.ok) {
      console.error(`[telegram-notify] sendMessage failed: ${data.description}`);
      return false;
    }

    console.log(`[telegram-notify] Sent to ${target} for ${context.room_name}`);
    return true;
  }

  private formatMessage(
    items: NotificationItem[],
    context: NotificationContext,
  ): string {
    let text: string;

    if (items.length === 1) {
      const m = items[0];
      const preview = this.escapeHtml(m.content_preview);
      text = `🐝 <b>${this.escapeHtml(context.room_name)}</b>\n${this.escapeHtml(m.sender_name)}: ${preview}`;
    } else {
      const senders = [...new Set(items.map((m) => m.sender_name))];
      const senderList =
        senders.length <= 3
          ? senders.join(", ")
          : `${senders.slice(0, 2).join(", ")} and ${senders.length - 2} others`;

      text = `🐝 <b>${this.escapeHtml(context.room_name)}</b> — ${items.length} new messages\nFrom: ${this.escapeHtml(senderList)}`;

      for (const m of items.slice(-3)) {
        const short =
          m.content_preview.length > 100
            ? m.content_preview.slice(0, 100) + "…"
            : m.content_preview;
        text += `\n<blockquote>${this.escapeHtml(m.sender_name)}: ${this.escapeHtml(short)}</blockquote>`;
      }
    }

    text += `\n\n<a href="${context.room_url}">Open in Hivium →</a>`;
    return text;
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
