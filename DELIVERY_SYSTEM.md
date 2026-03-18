# Message Delivery System

A Toyota Land Cruiser-grade message delivery system for the Rooms app with three layers of reliability.

## Features Implemented

✅ **Layer 1: Webhooks with ACK + Retry**
- `webhook_url` field support in participants table
- `message_deliveries` table for tracking delivery status
- Immediate webhook attempts on message creation
- Exponential backoff retry mechanism (1s, 5s, 30s, 2min, 10min)
- Message acknowledgment system

✅ **Layer 2: SSE Enhancement**
- Global SSE endpoint for all participant rooms: `/api/participants/me/stream`
- Maintains connection with heartbeat

✅ **Layer 3: Polling Fallback**
- Undelivered messages endpoint: `/api/participants/me/messages/undelivered`
- Message acknowledgment endpoint: `/api/participants/me/messages/ack`

✅ **Delivery Status API**
- Per-message delivery status: `/api/rooms/[roomId]/messages/[messageId]/status`
- Delivery indicators in UI (✓ sent, ✓✓ delivered, ⚠ failed, ⋯ pending)

✅ **Participant Management**
- Self-service participant updates: `/api/participants/me`
- Webhook URL configuration

✅ **Retry Mechanism**
- Internal retry endpoint: `/api/internal/delivery-retry`
- Designed for cron job trigger

## API Endpoints

### Participant Management
- `GET /api/participants/me` - Get current participant info
- `PATCH /api/participants/me` - Update participant (including webhook_url)

### Message Delivery
- `GET /api/participants/me/messages/undelivered` - Get undelivered messages
- `POST /api/participants/me/messages/ack` - Acknowledge message receipt
- `GET /api/participants/me/stream` - Global SSE stream for all rooms

### Delivery Status
- `GET /api/rooms/[roomId]/messages/[messageId]/status` - Get delivery status

### Internal (Cron/Admin)
- `POST /api/internal/delivery-retry` - Retry pending deliveries

## Database Schema

### Required Migrations

```sql
-- Add webhook_url column to participants table
ALTER TABLE participants ADD COLUMN IF NOT EXISTS webhook_url TEXT;

-- Create message_deliveries table
CREATE TABLE IF NOT EXISTS message_deliveries (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_message_deliveries_participant_status 
ON message_deliveries(participant_id, status);

CREATE INDEX IF NOT EXISTS idx_message_deliveries_message_id 
ON message_deliveries(message_id);

CREATE INDEX IF NOT EXISTS idx_message_deliveries_retry 
ON message_deliveries(status, attempts, last_attempt_at);
```

### To Apply Schema

1. **Local Development:** Run the SQL in Supabase dashboard SQL editor
2. **Production:** Include in deployment migration

## Webhook Payload Format

```json
{
  "event": "message",
  "room_id": "room_123",
  "message": {
    "id": "msg_abc",
    "content": "Hello world",
    "participant_name": "Alice",
    "participant_type": "human",
    "created_at": "2026-03-18T21:40:00Z",
    "content_type": "text/markdown",
    "reply_to": null,
    "metadata": null
  }
}
```

## Integration

The system automatically triggers on message creation via the modified `/api/rooms/[roomId]/messages` POST handler.

## UI Components

- `DeliveryIndicator` component shows delivery status in chat
- Displays ✓ (sent), ✓✓ (delivered), ⚠ (failed), ⋯ (pending)
- Only shown for sender's own messages

## Graceful Degradation

The system gracefully handles missing database columns/tables and operates in a degraded mode until schema is fully migrated. This ensures backward compatibility during deployment.

## Testing

Use the provided test script:
```bash
node test-delivery-system.js
```

## Deployment Notes

1. Apply database migrations before deploying the new code
2. Configure `INTERNAL_API_KEY` environment variable for retry endpoint security
3. Set up external cron job to call `/api/internal/delivery-retry` every 5-10 minutes
4. Monitor delivery success rates via the status API