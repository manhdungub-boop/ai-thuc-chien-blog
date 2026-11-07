ALTER TABLE community_members ADD COLUMN email_verified_at TEXT;

-- Existing accounts predate the mandatory verification flow; preserve their access.
UPDATE community_members SET email_verified_at = created_at WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS community_email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES community_members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_email_verification_member ON community_email_verification_tokens(member_id);
CREATE INDEX IF NOT EXISTS idx_community_email_verification_expiry ON community_email_verification_tokens(expires_at);
