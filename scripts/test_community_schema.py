#!/usr/bin/env python3
import sqlite3
from pathlib import Path
conn = sqlite3.connect(":memory:")
conn.execute("PRAGMA foreign_keys=ON")
conn.executescript(Path("migrations/0001_community.sql").read_text(encoding="utf-8"))
tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
assert {"community_members", "community_sessions", "community_messages", "community_rate_limits"}.issubset(tables)
conn.execute("INSERT INTO community_members VALUES (?,?,?,?,?,?,?)", ("m1", "member_1", "member@example.com", "Member One", "salt", "hash", "2026-01-01T00:00:00.000Z"))
conn.execute("INSERT INTO community_messages VALUES (?,?,?,?,?)", ("msg1", "tools", "m1", "Hello community", "2026-01-01T00:01:00.000Z"))
try:
    conn.execute("INSERT INTO community_messages VALUES (?,?,?,?,?)", ("msg2", "unknown", "m1", "Invalid topic", "2026-01-01T00:02:00.000Z"))
    raise AssertionError("topic CHECK constraint was not enforced")
except sqlite3.IntegrityError:
    pass
try:
    conn.execute("INSERT INTO community_messages VALUES (?,?,?,?,?)", ("msg3", "tools", "missing-member", "Invalid member", "2026-01-01T00:03:00.000Z"))
    raise AssertionError("foreign key was not enforced")
except sqlite3.IntegrityError:
    pass
conn.executescript(Path("migrations/0002_email_otp.sql").read_text(encoding="utf-8"))
tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
assert "community_pending_members" in tables
assert conn.execute("SELECT COUNT(*) FROM community_members WHERE id='m1'").fetchone()[0] == 1
assert conn.execute("SELECT COUNT(*) FROM community_messages WHERE id='msg1'").fetchone()[0] == 1
print("PASS: additive OTP migration creates pending-registration table and preserves existing members/messages; topic and foreign-key constraints remain enforced")
