import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { nanoid } from "nanoid";
import { config } from "@/lib/config";
import { forbidden, badRequest, internalError } from "@/lib/errors";

// POST /api/participants — Register a new participant
export async function POST(req: NextRequest) {
  try {
    // Check registration mode
    if (config.registration.mode === 'closed') {
      return forbidden("Registration is currently closed");
    }
    
    const body = await req.json();
    const { name, type, avatar, capabilities, invite_code } = body;
    
    // Check invite code if in invite mode
    if (config.registration.mode === 'invite') {
      if (!invite_code) {
        return badRequest("Invite code is required");
      }
      
      // For now, just check if it's a non-empty string
      // In production, this would validate against a database of valid codes
      if (typeof invite_code !== 'string' || invite_code.trim().length === 0) {
        return badRequest("Invalid invite code");
      }
    }

    if (!name || !type) {
      return badRequest("name and type are required");
    }

    if (!["human", "agent"].includes(type)) {
      return badRequest('type must be "human" or "agent"');
    }

    const id = `p_${nanoid(12)}`;
    const apiKey = `rk_${nanoid(32)}`;

    const { error } = await getSupabaseAdmin()
      .from("participants")
      .insert({
        id,
        name,
        type,
        avatar: avatar || null,
        capabilities: capabilities ? JSON.stringify(capabilities) : null,
        api_key: apiKey,
      });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      id,
      name,
      type,
      apiKey,
      message: "Save your API key — it won't be shown again.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
