#!/usr/bin/env python3
import sqlite3
from pathlib import Path
sql = Path("migrations/0001_community.sql").read_text(encoding="utf-8")
conn = sqlite3.connect(":memory:")
conn.executescript("PRAGMA foreign_keys=ON;\n" + sql)
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
print("PASS: D1 community migration creates expected tables, enforces valid topics and member foreign keys")
