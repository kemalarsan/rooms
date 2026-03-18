import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// GET /api/participants/me - Get current participant info
export async function GET(req: NextRequest) {
  try {
    const participant = await requireAuth(req);
    
    // Remove sensitive API key from response
    const { api_key, ...safeParticipant } = participant;
    
    return NextResponse.json(safeParticipant);
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

// PATCH /api/participants/me - Update current participant
export async function PATCH(req: NextRequest) {
  try {
    const participant = await requireAuth(req);
    const body = await req.json();
    
    // Only allow updating specific fields
    const allowedUpdates = ["name", "avatar", "capabilities", "webhook_url"];
    const updates: Record<string, any> = {};
    
    for (const field of allowedUpdates) {
      if (field in body) {
        updates[field] = body[field];
      }
    }

    // Remove webhook_url if the column doesn't exist yet
    if (updates.webhook_url !== undefined) {
      try {
        // Test if the column exists by trying to select it
        await supabaseAdmin
          .from("participants")
          .select("webhook_url")
          .limit(1);
      } catch (error: any) {
        if (error.message?.includes("webhook_url") || error.message?.includes("column")) {
          delete updates.webhook_url;
          console.log("webhook_url column not available, skipping update");
        }
      }
    }
    
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    // Validate webhook_url if provided
    if (updates.webhook_url) {
      try {
        new URL(updates.webhook_url);
      } catch {
        return NextResponse.json(
          { error: "Invalid webhook_url format" },
          { status: 400 }
        );
      }
    }

    const { data: updatedParticipant, error } = await supabaseAdmin
      .from("participants")
      .update(updates)
      .eq("id", participant.id)
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    // Remove sensitive API key from response
    const { api_key, ...safeParticipant } = updatedParticipant;
    
    return NextResponse.json(safeParticipant);
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