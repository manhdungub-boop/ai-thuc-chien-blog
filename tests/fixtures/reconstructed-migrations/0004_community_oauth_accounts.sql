-- Add provider identities for Google and Facebook sign-in on staging.
-- This migration is additive; it does not modify or delete existing member data.
CREATE TABLE IF NOT EXISTS community_oauth_accounts (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'facebook')),
  provider_user_id TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES community_members(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_oauth_accounts_member
  ON community_oauth_accounts(member_id);
