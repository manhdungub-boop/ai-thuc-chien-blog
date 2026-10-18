CREATE TABLE IF NOT EXISTS community_members (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS community_sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES community_members(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_sessions_expiry ON community_sessions(expires_at);

CREATE TABLE IF NOT EXISTS community_messages (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL CHECK (topic IN ('tools', 'automation', 'content', 'earning')),
  member_id TEXT NOT NULL REFERENCES community_members(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 800),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_community_messages_topic_created ON community_messages(topic, created_at);
CREATE INDEX IF NOT EXISTS idx_community_messages_member ON community_messages(member_id, created_at);

CREATE TABLE IF NOT EXISTS community_rate_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
