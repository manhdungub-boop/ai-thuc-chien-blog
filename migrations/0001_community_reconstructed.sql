-- Reconstructed from the existing production D1 schema metadata on 2026-10-24.
-- This is a recovery migration, not a copy of the original migration file.
-- Validate on a fresh scratch database before use; never apply directly to production.

CREATE TABLE community_members (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE community_messages (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL CHECK (topic IN ('tools', 'automation', 'content', 'earning')),
  member_id TEXT NOT NULL REFERENCES community_members(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 800),
  created_at TEXT NOT NULL
);

CREATE TABLE community_rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

CREATE TABLE community_sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES community_members(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX idx_community_messages_member
  ON community_messages(member_id, created_at);

CREATE INDEX idx_community_messages_topic_created
  ON community_messages(topic, created_at);

CREATE INDEX idx_community_sessions_expiry
  ON community_sessions(expires_at);
