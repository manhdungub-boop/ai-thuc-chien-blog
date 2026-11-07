CREATE TABLE IF NOT EXISTS community_password_resets (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES community_members(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_community_password_resets_member ON community_password_resets(member_id, used_at);
CREATE INDEX IF NOT EXISTS idx_community_password_resets_expiry ON community_password_resets(expires_at);
