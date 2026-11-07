CREATE TABLE IF NOT EXISTS community_password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES community_members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_password_reset_member
  ON community_password_reset_tokens(member_id);
CREATE INDEX IF NOT EXISTS idx_community_password_reset_expiry
  ON community_password_reset_tokens(expires_at);
