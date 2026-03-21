import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { unauthorized, forbidden, internalError } from "@/lib/errors";

// GET /api/rooms/:roomId/transcript — Full room transcript
// Query params:
//   since=<ISO timestamp>  — only messages after this time
//   until=<ISO timestamp>  — only messages before this time
//   format=markdown|jsonl|json  — output format (default: markdown)
//   limit=<number>         — max messages (default: all, max 10000)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId } = await params;

    // Verify membership
    const { data: member } = await getSupabaseAdmin()
      .from("room_members")
      .select("participant_id")
      .eq("room_id", roomId)
      .eq("participant_id", participant.id)
      .single();

    if (!member) {
      return forbidden("Not a member of this room");
    }

    // Get room info for header
    const { data: room } = await getSupabaseAdmin()
      .from("rooms")
      .select("name, topic, description, context")
      .eq("id", roomId)
      .single();

    const url = new URL(req.url);
    const since = url.searchParams.get("since");
    const until = url.searchParams.get("until");
    const format = url.searchParams.get("format") || "markdown";
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "10000"),
      10000
    );

    // Build query — chronological order
    let query = getSupabaseAdmin()
      .from("messages")
      .select(
        `
        id,
        content,
        content_type,
        reply_to,
        created_at,
        seq,
        participant_id,
        participants!messages_participant_id_fkey (
          name,
          type
        )
      `
      )
      .eq("room_id", roomId)
      .order("seq", { ascending: true })
      .limit(limit);

    if (since) {
      query = query.gt("created_at", since);
    }
    if (until) {
      query = query.lt("created_at", until);
    }

    const { data: messages, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    if (!messages || messages.length === 0) {
      if (format === "markdown") {
        return new Response("# No messages found\n", {
          headers: { "Content-Type": "text/markdown; charset=utf-8" },
        });
      }
      return NextResponse.json({ messages: [], room, meta: { count: 0 } });
    }

    // Flatten participant info
    const flat = messages.map((m: any) => ({
      id: m.id,
      seq: m.seq,
      sender: m.participants?.name || "Unknown",
      senderType: m.participants?.type || "unknown",
      content: m.content,
      contentType: m.content_type,
      replyTo: m.reply_to,
      timestamp: m.created_at,
      participantId: m.participant_id,
    }));

    const meta = {
      roomId,
      roomName: room?.name || roomId,
      topic: room?.topic || null,
      count: flat.length,
      firstMessage: flat[0]?.timestamp,
      lastMessage: flat[flat.length - 1]?.timestamp,
      since: since || null,
      until: until || null,
      generatedAt: new Date().toISOString(),
    };

    // ── Markdown format ─────────────────────────────────────────
    if (format === "markdown") {
      const lines: string[] = [];

      // Header
      lines.push(`# ${meta.roomName} — Transcript`);
      if (room?.topic) lines.push(`> ${room.topic}`);
      lines.push("");
      lines.push(
        `**${meta.count} messages** | ${formatDate(meta.firstMessage)} → ${formatDate(meta.lastMessage)}`
      );
      if (room?.context) {
        lines.push("");
        lines.push(`## Room Context`);
        lines.push(room.context);
      }
      lines.push("");
      lines.push("---");
      lines.push("");

      // Messages grouped by time blocks (5 min gaps = new block)
      let lastTime = 0;
      let lastSender = "";

      for (const msg of flat) {
        const msgTime = new Date(msg.timestamp).getTime();
        const gap = msgTime - lastTime;

        // Time separator for gaps > 5 minutes
        if (gap > 5 * 60 * 1000 || lastTime === 0) {
          if (lastTime > 0) lines.push("");
          lines.push(`### ${formatTime(msg.timestamp)}`);
          lines.push("");
          lastSender = ""; // Reset sender grouping after time break
        }

        // Sender label — skip if same sender in consecutive messages
        const senderTag =
          msg.senderType === "agent" ? `🤖 **${msg.sender}**` : `**${msg.sender}**`;

        if (msg.sender !== lastSender) {
          lines.push(`${senderTag}:`);
        }

        // Content — indent continuation messages
        const content = msg.content.trim();
        if (msg.replyTo) {
          lines.push(`> ↩️ (reply)`);
        }
        lines.push(content);
        lines.push("");

        lastTime = msgTime;
        lastSender = msg.sender;
      }

      // Footer
      lines.push("---");
      lines.push(
        `*Generated ${new Date().toISOString()} | ${meta.count} messages*`
      );

      return new Response(lines.join("\n"), {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "X-Transcript-Count": String(meta.count),
          "X-Transcript-Room": roomId,
        },
      });
    }

    // ── JSONL format ────────────────────────────────────────────
    if (format === "jsonl") {
      const header = JSON.stringify({ type: "meta", ...meta });
      const msgLines = flat.map((m) =>
        JSON.stringify({ type: "message", ...m })
      );
      const body = [header, ...msgLines].join("\n") + "\n";

      return new Response(body, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "X-Transcript-Count": String(meta.count),
        },
      });
    }

    // ── JSON format (default fallback) ──────────────────────────
    return NextResponse.json({
      meta,
      room: {
        name: room?.name,
        topic: room?.topic,
        description: room?.description,
        context: room?.context,
      },
      messages: flat,
    });
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return unauthorized();
    }
    return internalError((error as Error).message);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "?";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
