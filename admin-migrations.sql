-- Task 1: Add role column to room_members
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS role text DEFAULT 'member';

-- Update existing room creators to be owners
UPDATE room_members rm SET role = 'owner' 
FROM rooms r WHERE rm.room_id = r.id AND rm.participant_id = r.created_by;

-- Task 2: Add safety control columns
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS muted_until timestamptz;
ALTER TABLE room_members ADD COLUMN IF NOT EXISTS rate_limit_per_min integer;

-- Add room-level safety settings
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS max_message_length integer DEFAULT 4000;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS humans_only boolean DEFAULT false;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS locked boolean DEFAULT false;

-- Task 3: Create room_triggers table
CREATE TABLE IF NOT EXISTS room_triggers (
  id text PRIMARY KEY DEFAULT 'trig_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  room_id text REFERENCES rooms(id) NOT NULL,
  pattern text NOT NULL,  -- regex pattern to match against message content
  action text NOT NULL DEFAULT 'invite',  -- 'invite' | 'notify' | 'webhook'
  target_participant_id text REFERENCES participants(id),  -- who to invite/notify
  target_webhook_url text,  -- webhook URL for 'webhook' action
  created_by text REFERENCES participants(id) NOT NULL,
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);
