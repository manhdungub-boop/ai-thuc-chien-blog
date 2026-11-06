-- Reconstructed from the isolated preview D1 schema metadata on 2026-10-24.
-- Adds mandatory email-verification state for a fresh scratch database.
-- Existing members are grandfathered as verified so a reviewed migration does not
-- lock out accounts created before rollout.
-- This is NOT the original authoritative migration. Validate on disposable D1 only;
-- never apply directly to staging or production databases that may already have
-- some or all of these columns/tables.

ALTER TABLE community_members ADD COLUMN email_verified_at TEXT;
ALTER TABLE community_members ADD COLUMN email_verification_required INTEGER NOT NULL DEFAULT 0;

UPDATE community_members
SET email_verified_at = CURRENT_TIMESTAMP
WHERE email_verified_at IS NULL;

CREATE TABLE community_email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES community_members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_community_email_verification_expiry
  ON community_email_verification_tokens(expires_at);

CREATE INDEX idx_community_email_verification_member
  ON community_email_verification_tokens(member_id);
