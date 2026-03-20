import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { nanoid } from "nanoid";

/**
 * POST /api/rooms/:roomId/invites/email
 *
 * Send an invite to a room via email.
 * Creates an invite link and emails it to the recipient.
 *
 * Body:
 *   email: string (required) — recipient email
 *   message?: string — optional personal message from inviter
 *   role?: string — auto-assigned role (default: "member")
 *
 * Requires: HIVIUM_EMAIL_API_KEY env var (Resend)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId } = await params;
    const body = await req.json();

    // Validate email
    const email = body.email?.trim()?.toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Valid email address is required" },
        { status: 400 }
      );
    }

    // Check email provider is configured
    const apiKey = process.env.HIVIUM_EMAIL_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Email sending is not configured" },
        { status: 503 }
      );
    }

    const db = getSupabaseAdmin();

    // Verify sender is a member of the room
    const { data: member } = await db
      .from("room_members")
      .select("role")
      .eq("room_id", roomId)
      .eq("participant_id", participant.id)
      .single();

    if (!member) {
      return NextResponse.json(
        { error: "Not a member of this room" },
        { status: 403 }
      );
    }

    // Get room info
    const { data: room } = await db
      .from("rooms")
      .select("id, name, description, topic")
      .eq("id", roomId)
      .single();

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    // Create a single-use invite link for this email
    const code = nanoid(10);
    const id = `inv_${nanoid(12)}`;

    const { error: inviteError } = await db.from("invite_links").insert({
      id,
      code,
      room_id: roomId,
      created_by: participant.id,
      max_uses: 1, // single use for email invites
      expires_at: new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      ).toISOString(), // 7 days
      auto_role: body.role || "member",
    });

    if (inviteError) throw new Error(inviteError.message);

    // Store the email association for tracking
    try {
      await db.from("invite_emails").insert({
        invite_id: id,
        email,
        sent_by: participant.id,
        personal_message: body.message || null,
      });
    } catch {
      // Table might not exist yet — non-critical, continue
      console.warn("[invite-email] invite_emails table not available, skipping tracking");
    }

    const inviteUrl = `https://www.hivium.ai/invite/${code}`;
    const fromAddress =
      process.env.HIVIUM_EMAIL_FROM || "Hivium <notifications@hivium.ai>";

    // Send the invite email
    const html = formatInviteEmail({
      roomName: room.name,
      roomDescription: room.description || room.topic,
      inviterName: participant.name,
      personalMessage: body.message,
      inviteUrl,
    });

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: email,
        subject: `${participant.name} invited you to "${room.name}" on Hivium`,
        html,
      }),
    });

    if (!emailRes.ok) {
      const err = await emailRes.text();
      console.error(`[invite-email] Resend failed: ${emailRes.status} ${err}`);
      return NextResponse.json(
        { error: "Failed to send invite email" },
        { status: 502 }
      );
    }

    const emailData = await emailRes.json();

    console.log(
      `[invite-email] Sent invite to ${email} for room ${room.name} (${roomId})`
    );

    return NextResponse.json({
      ok: true,
      invite: {
        id,
        code,
        url: inviteUrl,
        email,
        expiresAt: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ).toISOString(),
      },
      emailId: emailData.id,
    });
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[invite-email] Error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

// --- Email template ---

function formatInviteEmail(opts: {
  roomName: string;
  roomDescription: string | null;
  inviterName: string;
  personalMessage?: string;
  inviteUrl: string;
}): string {
  const { roomName, roomDescription, inviterName, personalMessage, inviteUrl } =
    opts;

  const personalBlock = personalMessage
    ? `
      <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;
                  border-radius:0 8px 8px 0;margin:16px 0;color:#92400e;font-style:italic">
        "${esc(personalMessage)}"
        <div style="color:#b45309;font-size:13px;margin-top:4px">— ${esc(inviterName)}</div>
      </div>`
    : "";

  const descriptionBlock = roomDescription
    ? `<p style="color:#71717a;font-size:14px;margin:8px 0 0">${esc(roomDescription)}</p>`
    : "";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px">

    <!-- Logo -->
    <div style="text-align:center;margin-bottom:32px">
      <span style="font-size:36px">🐝</span>
    </div>

    <!-- Card -->
    <div style="background:#18181b;border:1px solid #27272a;border-radius:12px;padding:32px;text-align:center">
      <p style="color:#a1a1aa;font-size:14px;margin:0">
        <strong style="color:#e4e4e7">${esc(inviterName)}</strong> invited you to join
      </p>

      <h1 style="color:#fbbf24;font-size:24px;margin:12px 0 4px;font-weight:700">
        ${esc(roomName)}
      </h1>

      ${descriptionBlock}
      ${personalBlock}

      <!-- CTA -->
      <div style="margin:28px 0 16px">
        <a href="${inviteUrl}"
           style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#d97706,#ea580c);
                  color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px">
          Join Room →
        </a>
      </div>

      <p style="color:#52525b;font-size:12px;margin:0">
        No account needed — just click and you're in.
      </p>
    </div>

    <!-- Footer -->
    <div style="text-align:center;margin-top:24px">
      <p style="color:#3f3f46;font-size:11px;margin:0">
        This invite expires in 7 days.
      </p>
      <p style="color:#3f3f46;font-size:11px;margin:8px 0 0">
        <a href="https://hivium.ai" style="color:#52525b;text-decoration:none">Hivium</a>
        — Where humans and agents collaborate
      </p>
    </div>

  </div>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
