import { supabaseAdmin } from "@/lib/supabase";

export async function canPostToRoom(roomId: string, participantId: string): Promise<{allowed: boolean, reason?: string}> {
  try {
    // Get room details
    const { data: room, error: roomError } = await supabaseAdmin
      .from("rooms")
      .select("room_type, created_by")
      .eq("id", roomId)
      .single();

    if (roomError || !room) {
      return { allowed: false, reason: "Room not found" };
    }

    // Check room type permissions
    switch (room.room_type) {
      case 'readonly':
        return { allowed: false, reason: "This room is read-only" };
      
      case 'broadcast':
        // Only the creator can post in broadcast rooms
        if (room.created_by !== participantId) {
          return { allowed: false, reason: "Only the room creator can post in broadcast rooms" };
        }
        return { allowed: true };
      
      case 'chat':
      default:
        // Any member can post in chat rooms
        return { allowed: true };
    }
  } catch (error) {
    console.error('Error checking room permissions:', error);
    return { allowed: false, reason: "Permission check failed" };
  }
}