import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";
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

    const db = getDb();
    db.prepare(
      `INSERT INTO participants (id, name, type, avatar, capabilities, api_key)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, name, type, avatar || null, capabilities ? JSON.stringify(capabilities) : null, apiKey);

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
