import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { unauthorized, badRequest, internalError } from "@/lib/errors";

// GET /api/participants/me/notifications — List my notification preferences
export async function GET(req: NextRequest) {
  try {
    const participant = await requireAuth(req);

    const { data: prefs, error } = await getSupabaseAdmin()
      .from("notification_preferences")
      .select("*")
      .eq("participant_id", participant.id)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);

    return NextResponse.json({ preferences: prefs });
  } catch (error) {
    if ((error as Error).message === "Unauthorized") return unauthorized();
    return internalError((error as Error).message);
  }
}

// POST /api/participants/me/notifications — Add a notification preference
export async function POST(req: NextRequest) {
  try {
    const participant = await requireAuth(req);
    const body = await req.json();

    const { channel, target, notify_on, batch_seconds, room_id } = body;

    // Validate channel
    const validChannels = ["slack", "telegram", "email", "webhook"];
    if (!channel || !validChannels.includes(channel)) {
      return badRequest(`channel must be one of: ${validChannels.join(", ")}`);
    }

    if (!target) {
      return badRequest("target is required (Slack user ID, Telegram chat ID, email, or webhook URL)");
    }

    // Validate notify_on
    const validNotifyOn = ["all", "mentions", "none"];
    if (notify_on && !validNotifyOn.includes(notify_on)) {
      return badRequest(`notify_on must be one of: ${validNotifyOn.join(", ")}`);
    }

    // Validate batch_seconds
    if (batch_seconds !== undefined && (typeof batch_seconds !== "number" || batch_seconds < 0 || batch_seconds > 3600)) {
      return badRequest("batch_seconds must be between 0 (instant) and 3600 (1 hour)");
    }

    // Validate room_id if provided
    if (room_id) {
      const { data: member } = await getSupabaseAdmin()
        .from("room_members")
        .select("participant_id")
        .eq("room_id", room_id)
        .eq("participant_id", participant.id)
        .single();

      if (!member) {
        return badRequest("You are not a member of this room");
      }
    }

    // Check if preference already exists (upsert via insert/update pattern
    // because the unique index uses COALESCE which Supabase upsert can't target)
    {
      let query = getSupabaseAdmin()
        .from("notification_preferences")
        .select("id")
        .eq("participant_id", participant.id)
        .eq("channel", channel);
      
      if (room_id) {
        query = query.eq("room_id", room_id);
      } else {
        query = query.is("room_id", null);
      }

      const { data: existing } = await query.single();

      if (existing) {
        // Update
        const { data: updated, error: updateError } = await getSupabaseAdmin()
          .from("notification_preferences")
          .update({
            target,
            notify_on: notify_on || "all",
            batch_seconds: batch_seconds ?? 30,
            enabled: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select()
          .single();

        if (updateError) throw new Error(updateError.message);
        return NextResponse.json(updated, { status: 200 });
      } else {
        // Insert
        const { data: inserted, error: insertError } = await getSupabaseAdmin()
          .from("notification_preferences")
          .insert({
            participant_id: participant.id,
            channel,
            target,
            notify_on: notify_on || "all",
            batch_seconds: batch_seconds ?? 30,
            room_id: room_id || null,
            enabled: true,
          })
          .select()
          .single();

        if (insertError) throw new Error(insertError.message);
        return NextResponse.json(inserted, { status: 201 });
      }
    }
  } catch (error) {
    if ((error as Error).message === "Unauthorized") return unauthorized();
    return internalError((error as Error).message);
  }
}

// DELETE /api/participants/me/notifications?id=npref_xxx — Remove a preference
export async function DELETE(req: NextRequest) {
  try {
    const participant = await requireAuth(req);
    const url = new URL(req.url);
    const prefId = url.searchParams.get("id");

    if (!prefId) {
      return badRequest("id parameter is required");
    }

    const { error } = await getSupabaseAdmin()
      .from("notification_preferences")
      .delete()
      .eq("id", prefId)
      .eq("participant_id", participant.id); // Ensure they own it

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    if ((error as Error).message === "Unauthorized") return unauthorized();
    return internalError((error as Error).message);
  }
}
