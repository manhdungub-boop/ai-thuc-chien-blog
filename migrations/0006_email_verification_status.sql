-- Store verification state separately and backfill all existing accounts as verified.
CREATE TABLE IF NOT EXISTS community_email_verification_status (
  member_id TEXT PRIMARY KEY REFERENCES community_members(id) ON DELETE CASCADE,
  verified_at TEXT,
  created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO community_email_verification_status (member_id, verified_at, created_at)
SELECT id, created_at, created_at FROM community_members;
