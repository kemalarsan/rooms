import type {
  NotificationProvider,
  NotificationItem,
  NotificationContext,
} from "../types";

/**
 * Email Notification Provider
 *
 * Sends email notifications via configurable SMTP/API.
 * Supports: Resend, SendGrid, or any SMTP relay.
 *
 * Target: email address
 * Requires: HIVIUM_EMAIL_API_KEY + HIVIUM_EMAIL_FROM env vars
 * Currently implements Resend (resend.com) — swap for any transactional email provider.
 */
export class EmailProvider implements NotificationProvider {
  channel = "email" as const;
  displayName = "Email";

  private get apiKey(): string | undefined {
    return process.env.HIVIUM_EMAIL_API_KEY;
  }

  private get fromAddress(): string {
    return process.env.HIVIUM_EMAIL_FROM || "Hivium <notifications@hivium.ai>";
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  validateTarget(target: string): string | null {
    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      return "Must be a valid email address";
    }
    return null;
  }

  async send(
    target: string,
    items: NotificationItem[],
    context: NotificationContext,
  ): Promise<boolean> {
    const apiKey = this.apiKey;
    if (!apiKey) return false;

    const subject = items.length === 1
      ? `🐝 ${context.room_name}: ${items[0].sender_name} sent a message`
      : `🐝 ${context.room_name}: ${items.length} new messages`;

    const html = this.formatHtml(items, context);

    // Resend API (swap this block for SendGrid, Mailgun, etc.)
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to: target,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[email-notify] Send failed: ${res.status} ${err}`);
      return false;
    }

    console.log(`[email-notify] Sent to ${target} for ${context.room_name}`);
    return true;
  }

  private formatHtml(
    items: NotificationItem[],
    context: NotificationContext,
  ): string {
    const messagesHtml = items
      .slice(-5)
      .map(
        (m) => `
        <div style="padding:8px 0;border-bottom:1px solid #eee">
          <strong>${this.escape(m.sender_name)}</strong>
          <div style="color:#555;margin-top:4px">${this.escape(m.content_preview)}</div>
        </div>`,
      )
      .join("");

    const moreText =
      items.length > 5 ? `<p style="color:#999">...and ${items.length - 5} more</p>` : "";

    return `
      <div style="font-family:-apple-system,sans-serif;max-width:500px;margin:0 auto">
        <h2 style="color:#f59e0b">🐝 ${this.escape(context.room_name)}</h2>
        ${messagesHtml}
        ${moreText}
        <div style="margin-top:16px">
          <a href="${context.room_url}"
             style="display:inline-block;padding:10px 20px;background:#f59e0b;color:#fff;
                    text-decoration:none;border-radius:6px;font-weight:600">
            Open in Hivium →
          </a>
        </div>
        <p style="color:#999;font-size:12px;margin-top:24px">
          You're receiving this because you have Hivium notifications enabled.
        </p>
      </div>`;
  }

  private escape(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
}
