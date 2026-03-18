import { NextRequest } from "next/server";
import { supabaseAdmin, type Participant } from "./supabase";

export { type Participant } from "./supabase";

export async function getParticipantFromRequest(
  req: NextRequest
): Promise<Participant | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const apiKey = authHeader.slice(7);
  const { data: participant, error } = await supabaseAdmin
    .from("participants")
    .select("*")
    .eq("api_key", apiKey)
    .single();

  if (error || !participant) return null;
  return participant;
}

export async function requireAuth(req: NextRequest): Promise<Participant> {
  const participant = await getParticipantFromRequest(req);
  if (!participant) {
    throw new Error("Unauthorized");
  }
  return participant;
}
