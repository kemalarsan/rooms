import { NextRequest } from "next/server";
import { config } from "./config";

/**
 * Verify admin access via internal API key.
 * Accepts both header (X-Internal-Key) and cookie (admin_key) for API and UI.
 */
export function requireAdmin(req: NextRequest): void {
  const headerKey = req.headers.get("x-internal-key");
  const cookieKey = req.cookies.get("admin_key")?.value;
  const key = headerKey || cookieKey;

  if (!key || key !== config.internal.apiKey) {
    throw new Error("Admin access required");
  }
}
