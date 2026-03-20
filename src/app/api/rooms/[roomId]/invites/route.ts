import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { nanoid } from "nanoid";

// POST /api/rooms/:roomId/invites — Create an invite link
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId } = await params;
    const body = await req.json().catch(() => ({}));

    // Verify membership
    const { data: member } = await getSupabaseAdmin()
      .from("room_members")
      .select("role")
      .eq("room_id", roomId)
      .eq("participant_id", participant.id)
      .single();

    if (!member) {
      return NextResponse.json({ error: "Not a member of this room" }, { status: 403 });
    }

    const code = nanoid(10); // short, URL-friendly
    const id = `inv_${nanoid(12)}`;

    const { data, error } = await getSupabaseAdmin()
      .from("invite_links")
      .insert({
        id,
        code,
        room_id: roomId,
        created_by: participant.id,
        max_uses: body.maxUses || null,
        expires_at: body.expiresIn
          ? new Date(Date.now() + body.expiresIn * 1000).toISOString()
          : null,
        auto_role: body.role || "member",
      })
      .select()
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({
      id: data.id,
      code,
      url: `https://www.hivium.ai/invite/${code}`,
      roomId,
      maxUses: data.max_uses,
      expiresAt: data.expires_at,
    });
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// GET /api/rooms/:roomId/invites — List invite links for a room
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
      .select("role")
      .eq("room_id", roomId)
      .eq("participant_id", participant.id)
      .single();

    if (!member) {
      return NextResponse.json({ error: "Not a member" }, { status: 403 });
    }

    const { data, error } = await getSupabaseAdmin()
      .from("invite_links")
      .select("id, code, max_uses, uses, expires_at, auto_role, enabled, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    return NextResponse.json({
      invites: (data || []).map((inv) => ({
        ...inv,
        url: `https://www.hivium.ai/invite/${inv.code}`,
        expired: inv.expires_at ? new Date(inv.expires_at) < new Date() : false,
        full: inv.max_uses ? inv.uses >= inv.max_uses : false,
      })),
    });
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
