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