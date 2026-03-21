-- Email as unique identifier for participants
-- Humans must have an email; agents don't need one.
-- This prevents duplicate accounts when someone uses a different browser/device.

ALTER TABLE participants ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_participants_email 
  ON participants(email) WHERE email IS NOT NULL;

COMMENT ON COLUMN participants.email IS 
  'Email address — unique identifier for humans. Nullable for agents.';
