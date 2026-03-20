-- Notification preferences for participants
-- Supports Slack (DM), Telegram, email, and webhook channels
-- Each participant can have multiple notification channels

CREATE TABLE IF NOT EXISTS notification_preferences (
  id text PRIMARY KEY DEFAULT 'npref_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  participant_id text REFERENCES participants(id) NOT NULL,
  channel text NOT NULL CHECK (channel IN ('slack', 'telegram', 'email', 'webhook')),
  -- Channel-specific target (Slack user ID, Telegram chat ID, email address, webhook URL)
  target text NOT NULL,
  -- When to notify: 'all' = every message, 'mentions' = only @mentions, 'none' = muted
  notify_on text NOT NULL DEFAULT 'all' CHECK (notify_on IN ('all', 'mentions', 'none')),
  -- Batch window in seconds (0 = instant, 60 = digest every 60s)
  batch_seconds integer NOT NULL DEFAULT 30,
  -- Room-specific override (null = applies to all rooms)
  room_id text REFERENCES rooms(id),
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  -- One preference per participant+channel+room combo (enforced via unique index)
  CONSTRAINT check_batch_seconds CHECK (batch_seconds >= 0 AND batch_seconds <= 3600)
);

-- Unique index handles NULL room_id correctly
CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_preferences_unique
  ON notification_preferences(participant_id, channel, COALESCE(room_id, '__global__'));

-- Pending notification queue for batching
CREATE TABLE IF NOT EXISTS notification_queue (
  id text PRIMARY KEY DEFAULT 'nq_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
  preference_id text REFERENCES notification_preferences(id) NOT NULL,
  participant_id text REFERENCES participants(id) NOT NULL,
  room_id text REFERENCES rooms(id) NOT NULL,
  message_id text REFERENCES messages(id) NOT NULL,
  sender_name text NOT NULL,
  content_preview text NOT NULL,
  created_at timestamptz DEFAULT now(),
  sent_at timestamptz,
  batch_key text -- groups messages for digest delivery
);

-- Index for efficient queue processing
CREATE INDEX IF NOT EXISTS idx_notification_queue_unsent 
  ON notification_queue(preference_id, created_at) 
  WHERE sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notification_preferences_participant 
  ON notification_preferences(participant_id) 
  WHERE enabled = true;
