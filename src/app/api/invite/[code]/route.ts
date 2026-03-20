import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getParticipantFromRequest } from "@/lib/auth";
import { nanoid } from "nanoid";

// GET /api/invite/:code — Preview invite (public, no auth needed)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;

    const { data: invite } = await getSupabaseAdmin()
      .from("invite_links")
      .select("id, code, room_id, max_uses, uses, expires_at, enabled, created_at")
      .eq("code", code)
      .single();

    if (!invite) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }

    if (!invite.enabled) {
      return NextResponse.json({ error: "Invite is disabled" }, { status: 410 });
    }

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ error: "Invite has expired" }, { status: 410 });
    }

    if (invite.max_uses && invite.uses >= invite.max_uses) {
      return NextResponse.json({ error: "Invite has reached max uses" }, { status: 410 });
    }

    // Get room info
    const { data: room } = await getSupabaseAdmin()
      .from("rooms")
      .select("id, name, description, topic, room_type")
      .eq("id", invite.room_id)
      .single();

    // Get member count
    const { count } = await getSupabaseAdmin()
      .from("room_members")
      .select("*", { count: "exact", head: true })
      .eq("room_id", invite.room_id);

    return NextResponse.json({
      valid: true,
      room: {
        id: room?.id,
        name: room?.name,
        description: room?.description,
        topic: room?.topic,
        type: room?.room_type,
        memberCount: count || 0,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// POST /api/invite/:code — Accept invite (register + join in one step)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = await req.json().catch(() => ({}));
    const db = getSupabaseAdmin();

    // Look up invite
    const { data: invite } = await db
      .from("invite_links")
      .select("*")
      .eq("code", code)
      .single();

    if (!invite || !invite.enabled) {
      return NextResponse.json({ error: "Invalid or disabled invite" }, { status: 404 });
    }

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ error: "Invite has expired" }, { status: 410 });
    }

    if (invite.max_uses && invite.uses >= invite.max_uses) {
      return NextResponse.json({ error: "Invite has reached max uses" }, { status: 410 });
    }

    // Check if already authenticated (existing user joining a room)
    const existingParticipant = await getParticipantFromRequest(req);

    let participant: { id: string; name: string; type: string; apiKey?: string };

    if (existingParticipant) {
      // Existing user — just join the room
      participant = { id: existingParticipant.id, name: existingParticipant.name, type: existingParticipant.type };
    } else {
      // New user — register first
      if (!body.name) {
        return NextResponse.json({ error: "name is required for new participants" }, { status: 400 });
      }

      const id = `p_${nanoid(12)}`;
      const apiKey = `rk_${nanoid(32)}`;
      const type = body.type || "agent"; // default to agent for API consumers

      const { error: regError } = await db
        .from("participants")
        .insert({
          id,
          name: body.name,
          type,
          avatar: body.avatar || null,
          capabilities: body.capabilities ? JSON.stringify(body.capabilities) : null,
          api_key: apiKey,
        });

      if (regError) throw new Error(regError.message);
      participant = { id, name: body.name, type, apiKey };
    }

    // Check if already a member
    const { data: existingMembership } = await db
      .from("room_members")
      .select("participant_id")
      .eq("room_id", invite.room_id)
      .eq("participant_id", participant.id)
      .single();

    if (!existingMembership) {
      // Join the room
      const { error: joinError } = await db
        .from("room_members")
        .insert({
          room_id: invite.room_id,
          participant_id: participant.id,
          role: invite.auto_role || "member",
        });

      if (joinError) throw new Error(joinError.message);
    }

    // Increment uses
    await db
      .from("invite_links")
      .update({ uses: invite.uses + 1 })
      .eq("id", invite.id);

    // Get room info
    const { data: room } = await db
      .from("rooms")
      .select("id, name, description, topic")
      .eq("id", invite.room_id)
      .single();

    const response: any = {
      ok: true,
      participant: {
        id: participant.id,
        name: participant.name,
        type: participant.type,
      },
      room: {
        id: room?.id,
        name: room?.name,
      },
      alreadyMember: !!existingMembership,
      endpoints: {
        poll: "GET /api/participants/me/messages/undelivered",
        ack: "POST /api/participants/me/messages/ack",
        send: `POST /api/rooms/${invite.room_id}/messages`,
        base: "https://www.hivium.ai",
      },
    };

    // Only include API key for newly registered participants
    if (participant.apiKey) {
      response.apiKey = participant.apiKey;
      response.message = "Save your API key — it won't be shown again.";
    }

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
