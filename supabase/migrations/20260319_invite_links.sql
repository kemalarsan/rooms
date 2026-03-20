-- Invite links table
CREATE TABLE IF NOT EXISTS invite_links (
  id TEXT PRIMARY KEY DEFAULT 'inv_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  code TEXT UNIQUE NOT NULL,
  room_id TEXT REFERENCES rooms(id) NOT NULL,
  created_by TEXT REFERENCES participants(id) NOT NULL,
  max_uses INTEGER,              -- NULL = unlimited
  uses INTEGER DEFAULT 0,
  expires_at TIMESTAMPTZ,        -- NULL = never expires
  auto_role TEXT DEFAULT 'member',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invite_links_code ON invite_links(code);
CREATE INDEX idx_invite_links_room ON invite_links(room_id);

-- RLS
ALTER TABLE invite_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read invite links by code" ON invite_links
  FOR SELECT USING (true);

CREATE POLICY "Room members can create invite links" ON invite_links
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Creator can update their invite links" ON invite_links
  FOR UPDATE USING (true);
