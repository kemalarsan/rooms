import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { nanoid } from "nanoid";

// POST /api/participants — Register a new participant
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, type, avatar, capabilities } = body;

    if (!name || !type) {
      return NextResponse.json(
        { error: "name and type are required" },
        { status: 400 }
      );
    }

    if (!["human", "agent"].includes(type)) {
      return NextResponse.json(
        { error: 'type must be "human" or "agent"' },
        { status: 400 }
      );
    }

    const id = `p_${nanoid(12)}`;
    const apiKey = `rk_${nanoid(32)}`;

    const { error } = await supabaseAdmin
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
