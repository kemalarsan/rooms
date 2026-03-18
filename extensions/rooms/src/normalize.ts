/**
 * Normalize a Rooms messaging target (room ID)
 */
export function normalizeRoomsMessagingTarget(raw: string): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }

  // Accept rooms:room_id format
  if (trimmed.startsWith("rooms:")) {
    const roomId = trimmed.slice(6);
    if (roomId) {
      return roomId;
    }
  }

  // Accept room_id directly
  if (trimmed.match(/^room_[a-zA-Z0-9_-]+$/)) {
    return trimmed;
  }

  return null;
}

/**
 * Check if a string looks like a Rooms target ID
 */
export function looksLikeRoomsTargetId(raw: string): boolean {
  return normalizeRoomsMessagingTarget(raw) !== null;
}

/**
 * Normalize a Rooms allowlist entry
 */
export function normalizeRoomsAllowEntry(raw: string | number): string | null {
  if (typeof raw === "number") {
    return String(raw);
  }

  const trimmed = raw?.trim();
  if (!trimmed) {
    return null;
  }

  // Allow wildcard
  if (trimmed === "*") {
    return "*";
  }

  // Allow participant IDs (can be various formats)
  return trimmed;
}

/**
 * Normalize a list of allowlist entries
 */
export function normalizeRoomsAllowlist(entries: Array<string | number> | undefined): string[] {
  if (!entries) {
    return [];
  }

  return entries
    .map(normalizeRoomsAllowEntry)
    .filter((entry): entry is string => entry !== null);
}

/**
 * Check if an allowlist matches a message
 */
export function resolveRoomsAllowlistMatch(params: {
  allowFrom: string[];
  senderParticipantId: string;
}): { allowed: boolean; reason?: string } {
  const { allowFrom, senderParticipantId } = params;

  if (allowFrom.length === 0) {
    return { allowed: false, reason: "empty allowlist" };
  }

  if (allowFrom.includes("*")) {
    return { allowed: true, reason: "wildcard" };
  }

  if (allowFrom.includes(senderParticipantId)) {
    return { allowed: true, reason: "exact match" };
  }

  return { allowed: false, reason: "not in allowlist" };
}