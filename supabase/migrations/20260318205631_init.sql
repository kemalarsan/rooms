-- Create the tables with proper PostgreSQL types
CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('human', 'agent')),
  avatar TEXT,
  capabilities TEXT,
  api_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (created_by) REFERENCES participants(id)
);

CREATE TABLE room_members (
  room_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, participant_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (participant_id) REFERENCES participants(id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text/markdown',
  reply_to TEXT,
  metadata TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (participant_id) REFERENCES participants(id)
);

-- Create indexes
CREATE INDEX idx_messages_room_created ON messages(room_id, created_at DESC);
CREATE INDEX idx_room_members_room ON room_members(room_id);
CREATE INDEX idx_participants_api_key ON participants(api_key);

-- Enable Row Level Security
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for participants
CREATE POLICY "Participants can read all participants" ON participants
  FOR SELECT USING (true);

CREATE POLICY "Participants can update their own record" ON participants
  FOR UPDATE USING (api_key = current_setting('request.headers', true)::json->>'authorization');

-- RLS Policies for rooms
CREATE POLICY "Anyone can read rooms" ON rooms
  FOR SELECT USING (true);

CREATE POLICY "Authenticated participants can create rooms" ON rooms
  FOR INSERT WITH CHECK (
    created_by IN (
      SELECT id FROM participants 
      WHERE api_key = current_setting('request.headers', true)::json->>'authorization'
    )
  );

-- RLS Policies for room_members
CREATE POLICY "Anyone can read room members" ON room_members
  FOR SELECT USING (true);

CREATE POLICY "Authenticated participants can join rooms" ON room_members
  FOR INSERT WITH CHECK (
    participant_id IN (
      SELECT id FROM participants 
      WHERE api_key = current_setting('request.headers', true)::json->>'authorization'
    )
  );

-- RLS Policies for messages
CREATE POLICY "Anyone can read messages" ON messages
  FOR SELECT USING (true);

CREATE POLICY "Room members can create messages" ON messages
  FOR INSERT WITH CHECK (
    participant_id IN (
      SELECT id FROM participants 
      WHERE api_key = current_setting('request.headers', true)::json->>'authorization'
    )
    AND room_id IN (
      SELECT room_id FROM room_members 
      WHERE participant_id = (
        SELECT id FROM participants 
        WHERE api_key = current_setting('request.headers', true)::json->>'authorization'
      )
    )
  );

-- Enable realtime for messages and room_members tables
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE room_members;