import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

// POST /api/admin/participants/merge
// Body: { keepId: "p_xxx", mergeId: "p_yyy" }
// Merges mergeId INTO keepId:
//   - Re-attributes all messages from mergeId to keepId
//   - Transfers room memberships (skips if already member)
//   - Transfers message deliveries
//   - Deletes the mergeId participant
export async function POST(req: NextRequest) {
  try {
    requireAdmin(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { keepId, mergeId } = await req.json();

    if (!keepId || !mergeId) {
      return NextResponse.json(
        { error: "keepId and mergeId are required" },
        { status: 400 }
      );
    }

    if (keepId === mergeId) {
      return NextResponse.json(
        { error: "Cannot merge a participant with itself" },
        { status: 400 }
      );
    }

    const db = getSupabaseAdmin();

    // Verify both participants exist
    const [keepRes, mergeRes] = await Promise.all([
      db.from("participants").select("id, name, type").eq("id", keepId).single(),
      db.from("participants").select("id, name, type").eq("id", mergeId).single(),
    ]);

    if (!keepRes.data) {
      return NextResponse.json(
        { error: `Keep participant not found: ${keepId}` },
        { status: 404 }
      );
    }
    if (!mergeRes.data) {
      return NextResponse.json(
        { error: `Merge participant not found: ${mergeId}` },
        { status: 404 }
      );
    }

    const results: Record<string, number> = {
      messagesReattributed: 0,
      membershipsTransferred: 0,
      membershipsSkipped: 0,
      deliveriesReattributed: 0,
    };

    // 1. Re-attribute all messages
    const { data: msgUpdate, error: msgErr } = await db
      .from("messages")
      .update({ participant_id: keepId })
      .eq("participant_id", mergeId)
      .select("id");

    if (msgErr) throw new Error(`Message reattribution failed: ${msgErr.message}`);
    results.messagesReattributed = msgUpdate?.length || 0;

    // 2. Transfer room memberships
    // Get rooms the merge participant is in
    const { data: mergeMembers } = await db
      .from("room_members")
      .select("room_id, joined_at")
      .eq("participant_id", mergeId);

    // Get rooms the keep participant is already in
    const { data: keepMembers } = await db
      .from("room_members")
      .select("room_id")
      .eq("participant_id", keepId);

    const keepRooms = new Set((keepMembers || []).map((m) => m.room_id));

    for (const membership of mergeMembers || []) {
      if (keepRooms.has(membership.room_id)) {
        // Already a member — just delete the duplicate membership
        results.membershipsSkipped++;
      } else {
        // Transfer: update participant_id on the membership
        await db
          .from("room_members")
          .update({ participant_id: keepId })
          .eq("room_id", membership.room_id)
          .eq("participant_id", mergeId);
        results.membershipsTransferred++;
      }
    }

    // Delete any remaining memberships for merge participant (the skipped/duplicate ones)
    await db
      .from("room_members")
      .delete()
      .eq("participant_id", mergeId);

    // 3. Re-attribute message deliveries
    const { data: delUpdate, error: delErr } = await db
      .from("message_deliveries")
      .update({ participant_id: keepId })
      .eq("participant_id", mergeId)
      .select("id");

    if (!delErr) {
      results.deliveriesReattributed = delUpdate?.length || 0;
    }

    // 4. Transfer invite_emails if they exist (best-effort)
    try {
      await db
        .from("invite_emails")
        .update({ invited_by: keepId })
        .eq("invited_by", mergeId);
    } catch {
      // Table may not exist — non-critical
    }

    // 5. Delete the merge participant's API key (best-effort)
    try {
      await db
        .from("api_keys")
        .delete()
        .eq("participant_id", mergeId);
    } catch {
      // api_key may be on participants table directly — handled by participant delete
    }

    // 5b. Transfer room ownership (created_by foreign key)
    try {
      await db
        .from("rooms")
        .update({ created_by: keepId })
        .eq("created_by", mergeId);
    } catch {
      // Non-critical if column doesn't exist
    }

    // 5c. Transfer invite_links created_by
    try {
      await db
        .from("invite_links")
        .update({ created_by: keepId })
        .eq("created_by", mergeId);
    } catch {}

    // 5d. Transfer notification_preferences
    try {
      await db
        .from("notification_preferences")
        .update({ participant_id: keepId })
        .eq("participant_id", mergeId);
    } catch {}

    // 6. Delete the merge participant
    const { error: deleteErr } = await db
      .from("participants")
      .delete()
      .eq("id", mergeId);

    if (deleteErr) throw new Error(`Failed to delete merged participant: ${deleteErr.message}`);

    return NextResponse.json({
      ok: true,
      kept: { id: keepRes.data.id, name: keepRes.data.name, type: keepRes.data.type },
      merged: { id: mergeRes.data.id, name: mergeRes.data.name, type: mergeRes.data.type },
      results,
    });
  } catch (error) {
    console.error("Merge error:", error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
