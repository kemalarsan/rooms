import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// GET /api/rooms/:roomId/triggers — List triggers (members only)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId } = await params;

    // Check if the requester is a member of the room
    const { data: requesterMember, error: requesterError } = await getSupabaseAdmin()
      .from("room_members")
      .select("*")
      .eq("room_id", roomId)
      .eq("participant_id", participant.id)
      .single();

    if (requesterError || !requesterMember) {
      return NextResponse.json(
        { error: "Not a member of this room" },
        { status: 403 }
      );
    }

    // Get triggers for the room
    const { data: triggers, error } = await getSupabaseAdmin()
      .from("room_triggers")
      .select(`
        *,
        target_participant:participants!room_triggers_target_participant_id_fkey(id, name),
        creator:participants!room_triggers_created_by_fkey(id, name)
      `)
      .eq("room_id", roomId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ triggers: triggers || [] });
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}

// POST /api/rooms/:roomId/triggers — Create trigger (owner only)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const participant = await requireAuth(req);
    const { roomId } = await params;
    const body = await req.json();
    const { pattern, action, target_participant_id, target_webhook_url } = body;

    if (!pattern || typeof pattern !== 'string') {
      return NextResponse.json(
        { error: "pattern is required and must be a string" },
        { status: 400 }
      );
    }

    if (!action || !['invite', 'notify', 'webhook'].includes(action)) {
      return NextResponse.json(
        { error: "action must be one of: invite, notify, webhook" },
        { status: 400 }
      );
    }

    // Validate action-specific requirements
    if (action === 'invite' || action === 'notify') {
      if (!target_participant_id) {
        return NextResponse.json(
          { error: `${action} action requires target_participant_id` },
          { status: 400 }
        );
      }
    }

    if (action === 'webhook') {
      if (!target_webhook_url) {
        return NextResponse.json(
          { error: "webhook action requires target_webhook_url" },
          { status: 400 }
        );
      }
    }

    // Test if the pattern is valid regex
    try {
      new RegExp(pattern);
    } catch (regexError) {
      return NextResponse.json(
        { error: "Invalid regex pattern" },
        { status: 400 }
      );
    }

    // Check if the requester is an owner of the room
    const { data: requesterMember, error: requesterError } = await getSupabaseAdmin()
      .from("room_members")
      .select("role")
      .eq("room_id", roomId)
      .eq("participant_id", participant.id)
      .single();

    if (requesterError || !requesterMember || requesterMember.role !== 'owner') {
      return NextResponse.json(
        { error: "Only room owners can create triggers" },
        { status: 403 }
      );
    }

    // Create the trigger
    const { data: trigger, error: insertError } = await getSupabaseAdmin()
      .from("room_triggers")
      .insert({
        room_id: roomId,
        pattern,
        action,
        target_participant_id: target_participant_id || null,
        target_webhook_url: target_webhook_url || null,
        created_by: participant.id,
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    return NextResponse.json(trigger, { status: 201 });
  } catch (error) {
    if ((error as Error).message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}