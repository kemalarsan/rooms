import { NextRequest } from "next/server";
import getDb from "./db";

export interface Participant {
  id: string;
  name: string;
  type: "human" | "agent";
  avatar: string | null;
  capabilities: string | null;
  api_key: string;
  created_at: string;
}

export function getParticipantFromRequest(
  req: NextRequest
): Participant | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const apiKey = authHeader.slice(7);
  const db = getDb();
  const participant = db
    .prepare("SELECT * FROM participants WHERE api_key = ?")
    .get(apiKey) as Participant | undefined;

  return participant || null;
}

export function requireAuth(req: NextRequest): Participant {
  const participant = getParticipantFromRequest(req);
  if (!participant) {
    throw new Error("Unauthorized");
  }
  return participant;
}
