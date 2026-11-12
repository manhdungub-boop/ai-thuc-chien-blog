-- Privacy-preserving aggregate page/topic views and short-lived member presence.
-- No raw visitor IP, email, username, or message content is stored in these tables.
CREATE TABLE IF NOT EXISTS site_page_views (
  day TEXT NOT NULL,
  path TEXT NOT NULL CHECK (length(path) BETWEEN 1 AND 200),
  topic TEXT NOT NULL DEFAULT '' CHECK (topic IN ('', 'tools', 'automation', 'content', 'earning')),
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
  PRIMARY KEY (day, path, topic)
);
CREATE INDEX IF NOT EXISTS idx_site_page_views_topic_day ON site_page_views(topic, day);

CREATE TABLE IF NOT EXISTS community_topic_presence (
  member_id TEXT NOT NULL REFERENCES community_members(id) ON DELETE CASCADE,
  topic TEXT NOT NULL CHECK (topic IN ('tools', 'automation', 'content', 'earning')),
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (member_id, topic)
);
CREATE INDEX IF NOT EXISTS idx_community_topic_presence_topic_seen ON community_topic_presence(topic, last_seen_at);
