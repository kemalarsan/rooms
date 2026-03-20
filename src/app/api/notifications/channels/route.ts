import { NextResponse } from "next/server";
import { getAllProviders } from "@/lib/notifications";

/**
 * GET /api/notifications/channels
 *
 * Public endpoint — returns all notification channels and their status.
 * Useful for UIs building notification preference forms.
 */
export async function GET() {
  const providers = getAllProviders();

  const channels = providers.map((p) => ({
    channel: p.channel,
    name: p.displayName,
    configured: p.isConfigured(),
  }));

  return NextResponse.json({ channels });
}
