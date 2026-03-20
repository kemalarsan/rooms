-- Track email invitations for analytics and deduplication
CREATE TABLE IF NOT EXISTS invite_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id TEXT REFERENCES invite_links(id) NOT NULL,
  email TEXT NOT NULL,
  sent_by TEXT REFERENCES participants(id) NOT NULL,
  personal_message TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  opened_at TIMESTAMPTZ,          -- future: track opens
  accepted_at TIMESTAMPTZ         -- future: track acceptance
);

CREATE INDEX idx_invite_emails_invite ON invite_emails(invite_id);
CREATE INDEX idx_invite_emails_email ON invite_emails(email);

-- RLS
ALTER TABLE invite_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON invite_emails
  FOR ALL USING (true);
