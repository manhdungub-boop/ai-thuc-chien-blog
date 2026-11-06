-- Add password-reset token storage for isolated staging. Inspect target schema first and apply only if the table is absent.
-- Never replay reconstructed migrations 0001/0002 on an existing database or run this migration against production.

CREATE TABLE community_password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES community_members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_community_password_reset_expiry ON community_password_reset_tokens(expires_at);
CREATE INDEX idx_community_password_reset_member ON community_password_reset_tokens(member_id);
