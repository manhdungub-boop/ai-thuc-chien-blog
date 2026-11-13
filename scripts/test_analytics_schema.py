#!/usr/bin/env python3
import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
conn = sqlite3.connect(":memory:")
conn.execute("PRAGMA foreign_keys = ON")
for migration in sorted((root / "migrations").glob("*.sql")):
    conn.executescript(migration.read_text(encoding="utf-8"))
tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
assert {"site_page_views", "community_topic_presence"}.issubset(tables)
columns = {row[1] for row in conn.execute("PRAGMA table_info(site_page_views)")}
assert columns == {"day", "path", "topic", "views"}
assert not ({"ip", "ip_address"} & columns)
conn.execute("INSERT INTO community_members (id, username, email, display_name, password_salt, password_hash, created_at) VALUES (?,?,?,?,?,?,?)",
             ("analytics-member", "analytics_member", "analytics@example.invalid", "Analytics", "salt", "hash", "2026-01-01T00:00:00Z"))
conn.execute("INSERT INTO site_page_views(day,path,topic,views) VALUES (?,?,?,?)", ("2026-11-12", "/", "", 3))
conn.execute("INSERT INTO site_page_views(day,path,topic,views) VALUES (?,?,?,?)", ("2026-11-12", "/", "tools", 2))
conn.execute("INSERT INTO community_topic_presence(member_id,topic,last_seen_at) VALUES (?,?,?)", ("analytics-member", "tools", "2026-11-12T16:00:00Z"))
assert conn.execute("SELECT SUM(views) FROM site_page_views WHERE topic=''").fetchone()[0] == 3
assert conn.execute("SELECT SUM(views) FROM site_page_views WHERE topic='tools'").fetchone()[0] == 2
assert conn.execute("SELECT COUNT(DISTINCT member_id) FROM community_topic_presence WHERE topic='tools'").fetchone()[0] == 1
conn.execute("DELETE FROM community_members WHERE id='analytics-member'")
assert conn.execute("SELECT COUNT(*) FROM community_topic_presence").fetchone()[0] == 0
try:
    conn.execute("INSERT INTO community_topic_presence(member_id,topic,last_seen_at) VALUES (?,?,?)", ("missing", "tools", "2026-11-12T16:00:00Z"))
    raise AssertionError("Presence must require an existing member")
except sqlite3.IntegrityError:
    pass
try:
    conn.execute("INSERT INTO site_page_views(day,path,topic,views) VALUES (?,?,?,?)", ("2026-11-12", "/", "invalid", 1))
    raise AssertionError("Invalid topic must be rejected")
except sqlite3.IntegrityError:
    pass
print("PASS: analytics schema, topic constraints, and member-presence cascade; no raw IP column.")
