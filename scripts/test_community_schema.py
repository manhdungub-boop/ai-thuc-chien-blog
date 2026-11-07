#!/usr/bin/env python3
import sqlite3
from pathlib import Path

conn = sqlite3.connect(":memory:")
conn.execute("PRAGMA foreign_keys=ON")
migration_files = sorted(Path("migrations").glob("*.sql"))
assert migration_files, "No community migrations found"
for migration in migration_files:
    conn.executescript(migration.read_text(encoding="utf-8"))

tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
assert {"community_members", "community_sessions", "community_messages", "community_rate_limits", "community_password_resets"}.issubset(tables)

conn.execute("INSERT INTO community_members VALUES (?,?,?,?,?,?,?)", ("m1", "member_1", "member@example.com", "Member One", "salt", "hash", "2026-01-01T00:00:00.000Z"))
conn.execute("INSERT INTO community_messages VALUES (?,?,?,?,?)", ("msg1", "tools", "m1", "Hello community", "2026-01-01T00:01:00.000Z"))
conn.execute("INSERT INTO community_password_resets VALUES (?,?,?,?,?,?)", ("reset1", "m1", "sha256-token-hash", "2026-01-01T00:00:00.000Z", "2026-01-01T00:30:00.000Z", None))

try:
    conn.execute("INSERT INTO community_messages VALUES (?,?,?,?,?)", ("msg2", "unknown", "m1", "Invalid topic", "2026-01-01T00:02:00.000Z"))
    raise AssertionError("topic CHECK constraint was not enforced")
except sqlite3.IntegrityError:
    pass

try:
    conn.execute("INSERT INTO community_password_resets VALUES (?,?,?,?,?,?)", ("reset2", "missing-member", "another-token-hash", "2026-01-01T00:00:00.000Z", "2026-01-01T00:30:00.000Z", None))
    raise AssertionError("password-reset member foreign key was not enforced")
except sqlite3.IntegrityError:
    pass

try:
    conn.execute("INSERT INTO community_password_resets VALUES (?,?,?,?,?,?)", ("reset3", "m1", "sha256-token-hash", "2026-01-01T00:00:00.000Z", "2026-01-01T00:30:00.000Z", None))
    raise AssertionError("password-reset token hash uniqueness was not enforced")
except sqlite3.IntegrityError:
    pass

conn.execute("DELETE FROM community_members WHERE id = ?", ("m1",))
assert conn.execute("SELECT COUNT(*) FROM community_password_resets").fetchone()[0] == 0, "Deleting a member must cascade-delete reset tokens"
print("PASS: all D1 migrations create expected auth tables and enforce reset-token uniqueness, member foreign keys, and cascade cleanup")
