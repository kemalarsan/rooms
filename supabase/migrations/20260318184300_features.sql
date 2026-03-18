-- Task 1: Add sequence numbers to messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS seq bigint;

-- Create function to auto-increment seq per room
CREATE OR REPLACE FUNCTION set_message_seq() RETURNS trigger AS $$
BEGIN
  SELECT COALESCE(MAX(seq), 0) + 1 INTO NEW.seq FROM messages WHERE room_id = NEW.room_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS messages_seq_trigger ON messages;
CREATE TRIGGER messages_seq_trigger BEFORE INSERT ON messages FOR EACH ROW EXECUTE FUNCTION set_message_seq();

-- Backfill existing messages
WITH numbered AS (
  SELECT id, room_id, ROW_NUMBER() OVER (PARTITION BY room_id ORDER BY created_at) as rn
  FROM messages
  WHERE seq IS NULL
)
UPDATE messages SET seq = numbered.rn FROM numbered WHERE messages.id = numbered.id;

-- Task 2: Add room topic and context
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS topic text;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS context text;

-- Task 3: Enhanced room creation
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS room_type text DEFAULT 'chat';
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS ttl_hours integer;

-- Task 4: Room memory table
CREATE TABLE IF NOT EXISTS room_memory (
  id text PRIMARY KEY DEFAULT 'rmem_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  room_id text REFERENCES rooms(id) NOT NULL,
  key text NOT NULL,
  value text NOT NULL,
  updated_by text REFERENCES participants(id),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(room_id, key)
);

-- Enable RLS for room_memory
ALTER TABLE room_memory ENABLE ROW LEVEL SECURITY;

-- RLS Policy for room_memory
DROP POLICY IF EXISTS "Room members can access memory" ON room_memory;
CREATE POLICY "Room members can access memory" ON room_memory
  FOR ALL USING (
    room_id IN (
      SELECT room_id FROM room_members 
      WHERE participant_id = (
        SELECT id FROM participants 
        WHERE api_key = current_setting('request.headers', true)::json->>'authorization'
      )
    )
  );