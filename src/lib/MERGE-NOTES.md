# Merge Notes for Messages Route

## Changes needed in src/app/api/rooms/[roomId]/messages/route.ts

### GET handler modifications:
1. Add `seq` to the select query:
```typescript
.select(`
  *,
  participants!messages_participant_id_fkey (
    name,
    type,
    avatar
  )
`)
```

2. Change the order by to use seq instead of created_at:
```typescript
.order("seq", { ascending: false })  // Changed from created_at
```

### POST handler modifications:
1. Add room permission check after membership verification:
```typescript
// Check if participant can post to this room type
const canPost = await canPostToRoom(roomId, participant.id);
if (!canPost.allowed) {
  return NextResponse.json(
    { error: canPost.reason || "Cannot post to this room" },
    { status: 403 }
  );
}
```

2. Add reply_to support in messageData:
```typescript
const messageData = {
  id,
  room_id: roomId,
  participant_id: participant.id,
  content,
  content_type: contentType || "text/markdown",
  reply_to: replyTo || null,  // This might already be there
  metadata: metadata ? JSON.stringify(metadata) : null,
};
```

3. The response should include the new seq field - the trigger will auto-populate it.

### Import needed:
```typescript
import { canPostToRoom } from "@/lib/room-permissions";
```

Note: The seq field will be auto-populated by the database trigger, so no changes needed in the insert data structure.