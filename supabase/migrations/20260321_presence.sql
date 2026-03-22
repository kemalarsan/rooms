-- Add presence tracking columns to room_members
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS last_status TEXT DEFAULT 'offline';

-- Index for quick presence lookups
CREATE INDEX IF NOT EXISTS idx_room_members_last_seen ON room_members(participant_id, last_seen_at DESC);
