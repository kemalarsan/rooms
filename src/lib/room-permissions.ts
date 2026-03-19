import { getSupabaseAdmin } from "@/lib/supabase";

export async function canPostToRoom(roomId: string, participantId: string, messageLength?: number): Promise<{allowed: boolean, reason?: string}> {
  try {
    // Get room details
    const { data: room, error: roomError } = await getSupabaseAdmin()
      .from("rooms")
      .select("room_type, created_by, locked, humans_only, max_message_length")
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return { allowed: false, reason: "Room not found" };
    }

    // Get member details
    const { data: member, error: memberError } = await getSupabaseAdmin()
      .from("room_members")
      .select("role, muted_until, rate_limit_per_min")
      .eq("room_id", roomId)
      .eq("participant_id", participantId)
      .single();

    if (memberError || !member) {
      return { allowed: false, reason: "Not a member of this room" };
    }

    // Get participant details
    const { data: participant, error: participantError } = await getSupabaseAdmin()
      .from("participants")
      .select("type")
      .eq("id", participantId)
      .single();

    if (participantError || !participant) {
      return { allowed: false, reason: "Participant not found" };
    }

    // Check 1: Room locked → nobody can post
    if (room.locked) {
      return { allowed: false, reason: "Room is locked" };
    }

    // Check 2: Participant muted (muted_until > now) → cannot post
    if (member.muted_until && new Date(member.muted_until) > new Date()) {
      return { allowed: false, reason: "You are muted" };
    }

    // Check 3: Humans-only mode + participant is agent → cannot post
    if (room.humans_only && participant.type === 'agent') {
      return { allowed: false, reason: "Humans-only mode is enabled" };
    }

    // Check 4: Observer role → cannot post
    if (member.role === 'observer') {
      return { allowed: false, reason: "Observers cannot post messages" };
    }

    // Check 5: Room type permissions
    switch (room.room_type) {
      case 'readonly':
        return { allowed: false, reason: "This room is read-only" };
      
      case 'broadcast':
        // Only the creator can post in broadcast rooms
        if (room.created_by !== participantId) {
          return { allowed: false, reason: "Only the room creator can post in broadcast rooms" };
        }
        break;
      
      case 'chat':
      default:
        // Any member can post in chat rooms (after passing other checks)
        break;
    }

    // Check 6: Rate limit (count messages in last minute)
    if (member.rate_limit_per_min && member.rate_limit_per_min > 0) {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
      const { count, error: countError } = await getSupabaseAdmin()
        .from("messages")
        .select("*", { count: 'exact', head: true })
        .eq("room_id", roomId)
        .eq("participant_id", participantId)
        .gte("created_at", oneMinuteAgo);

      if (countError) {
        console.error('Error checking rate limit:', countError);
        return { allowed: false, reason: "Rate limit check failed" };
      }

      if ((count || 0) >= member.rate_limit_per_min) {
        return { allowed: false, reason: "Rate limit exceeded" };
      }
    }

    // Check 7: Message length > max_message_length → reject
    if (messageLength && room.max_message_length && messageLength > room.max_message_length) {
      return { allowed: false, reason: `Message too long (max ${room.max_message_length} characters)` };
    }

    return { allowed: true };
  } catch (error) {
    console.error('Error checking room permissions:', error);
    return { allowed: false, reason: "Permission check failed" };
  }
}