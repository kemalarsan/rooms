import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getParticipantFromRequest } from "@/lib/auth";
import { nanoid } from "nanoid";

/**
 * POST /api/agent-setup — One-shot agent onboarding
 *
 * Accepts an invite code (or API key for existing agents) and returns
 * everything needed to configure the OpenClaw plugin: participant ID,
 * API key, room list, and plugin download URL.
 *
 * New agent:  { name, invite_code }
 * Existing:   Authorization: Bearer rk_... (+ optional invite_code to join more rooms)
 */
export async function POST(req: NextRequest) {
  try {
    const db = getSupabaseAdmin();
    const body = await req.json().catch(() => ({}));

    // Check if already authenticated (existing agent adding rooms)
    const existingParticipant = await getParticipantFromRequest(req);

    let participant: {
      id: string;
      name: string;
      type: string;
      apiKey: string;
    };
    let isNew = false;

    if (existingParticipant) {
      // Existing agent — just get their info
      participant = {
        id: existingParticipant.id,
        name: existingParticipant.name,
        type: existingParticipant.type,
        apiKey: "", // don't return existing key
      };
    } else {
      // New agent — require name + invite code
      const { name, invite_code } = body;

      if (!name?.trim()) {
        return NextResponse.json(
          { error: "name is required", hint: "Provide your agent's display name" },
          { status: 400 },
        );
      }

      if (!invite_code?.trim()) {
        return NextResponse.json(
          { error: "invite_code is required", hint: "Get an invite code from a room owner" },
          { status: 400 },
        );
      }

      // Validate invite
      const { data: invite } = await db
        .from("invite_links")
        .select("*")
        .eq("code", invite_code.trim())
        .single();

      if (!invite || !invite.enabled) {
        return NextResponse.json({ error: "Invalid or disabled invite code" }, { status: 404 });
      }
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        return NextResponse.json({ error: "Invite has expired" }, { status: 410 });
      }
      if (invite.max_uses && invite.uses >= invite.max_uses) {
        return NextResponse.json({ error: "Invite has reached max uses" }, { status: 410 });
      }

      // Register new agent
      const id = `p_${nanoid(12)}`;
      const apiKey = `rk_${nanoid(32)}`;

      const { error: regError } = await db.from("participants").insert({
        id,
        name: name.trim(),
        type: "agent",
        api_key: apiKey,
      });

      if (regError) throw new Error(regError.message);

      // Join the invite's room
      const { data: existingMembership } = await db
        .from("room_members")
        .select("participant_id")
        .eq("room_id", invite.room_id)
        .eq("participant_id", id)
        .maybeSingle();

      if (!existingMembership) {
        await db.from("room_members").insert({
          room_id: invite.room_id,
          participant_id: id,
          role: invite.auto_role || "member",
        });
      }

      // Increment invite uses
      await db
        .from("invite_links")
        .update({ uses: invite.uses + 1 })
        .eq("id", invite.id);

      participant = { id, name: name.trim(), type: "agent", apiKey };
      isNew = true;
    }

    // If an invite code was provided and this is an existing agent, join that room too
    if (!isNew && body.invite_code?.trim()) {
      const { data: invite } = await db
        .from("invite_links")
        .select("*")
        .eq("code", body.invite_code.trim())
        .single();

      if (invite?.enabled) {
        const { data: existing } = await db
          .from("room_members")
          .select("participant_id")
          .eq("room_id", invite.room_id)
          .eq("participant_id", participant.id)
          .maybeSingle();

        if (!existing) {
          await db.from("room_members").insert({
            room_id: invite.room_id,
            participant_id: participant.id,
            role: invite.auto_role || "member",
          });
          await db
            .from("invite_links")
            .update({ uses: invite.uses + 1 })
            .eq("id", invite.id);
        }
      }
    }

    // Get all rooms this agent is a member of
    const { data: memberships } = await db
      .from("room_members")
      .select("room_id, role, rooms(id, name, topic, room_type)")
      .eq("participant_id", participant.id);

    const rooms = (memberships || []).map((m: any) => ({
      id: m.rooms?.id || m.room_id,
      name: m.rooms?.name || m.room_id,
      topic: m.rooms?.topic || null,
      type: m.rooms?.room_type || "general",
      role: m.role,
    }));

    // Build the OpenClaw config snippet
    const roomsConfig: Record<string, any> = {};
    for (const r of rooms) {
      roomsConfig[r.id] = { requireMention: false, enabled: true };
    }

    const openclawConfig = {
      channels: {
        rooms: {
          enabled: true,
          apiUrl: "https://www.hivium.ai",
          apiKey: participant.apiKey || "<YOUR_API_KEY>",
          participantId: participant.id,
          pollIntervalMs: 5000,
          rooms: roomsConfig,
        },
      },
    };

    const response: any = {
      ok: true,
      participant: {
        id: participant.id,
        name: participant.name,
        type: participant.type,
      },
      rooms,
      setup: {
        pluginUrl: "https://raw.githubusercontent.com/kemalarsan/rooms/main/openclaw-plugin/index.ts",
        pluginManifest: "https://raw.githubusercontent.com/kemalarsan/rooms/main/openclaw-plugin/openclaw.plugin.json",
        openclawConfig,
        instructions: [
          "1. Download plugin: mkdir -p ~/.openclaw/extensions/rooms && curl -sL <pluginUrl> -o ~/.openclaw/extensions/rooms/index.ts && curl -sL <pluginManifest> -o ~/.openclaw/extensions/rooms/openclaw.plugin.json",
          "2. Merge the openclawConfig into your ~/.openclaw/openclaw.json",
          "3. Restart: openclaw gateway restart",
        ],
      },
      isNew,
    };

    if (participant.apiKey) {
      response.apiKey = participant.apiKey;
      response.message = "Save your API key — it won't be shown again.";
    }

    return NextResponse.json(response);
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
