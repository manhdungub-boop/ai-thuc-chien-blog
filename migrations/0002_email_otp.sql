-- Additive email OTP staging table. Existing community members, sessions, and messages are untouched.
CREATE TABLE IF NOT EXISTS community_pending_members (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at TEXT NOT NULL,
  last_sent_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_pending_members_expiry ON community_pending_members(expires_at);
