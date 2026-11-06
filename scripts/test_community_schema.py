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
for migration_name in ("0002_email_verification.sql", "0003_community_oauth_accounts.sql", "0004_community_password_reset.sql"):
    migration_sql = Path("migrations", migration_name).read_text(encoding="utf-8")
    conn.executescript(migration_sql)
assert conn.execute("SELECT email_verified_at FROM community_members WHERE id='m1'").fetchone()[0] == "2026-01-01T00:00:00.000Z"
reset_tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
assert {"community_email_verification_tokens", "community_oauth_accounts", "community_password_reset_tokens"}.issubset(reset_tables)
conn.execute("INSERT INTO community_password_reset_tokens VALUES (?,?,?,?)", ("token-hash", "m1", "2026-01-01T00:00:00.000Z", "2026-01-01T00:30:00.000Z"))
assert conn.execute("SELECT member_id FROM community_password_reset_tokens WHERE token_hash='token-hash'").fetchone()[0] == "m1"
consumed = conn.execute("DELETE FROM community_password_reset_tokens WHERE token_hash=? AND expires_at>? RETURNING member_id", ("token-hash", "2026-01-01T00:15:00.000Z")).fetchone()
assert consumed[0] == "m1"
assert conn.execute("DELETE FROM community_password_reset_tokens WHERE token_hash=? AND expires_at>? RETURNING member_id", ("token-hash", "2026-01-01T00:15:00.000Z")).fetchone() is None
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
print("PASS: D1 community migrations 0001-0004 create expected tables, preserve existing accounts and enforce member foreign keys")
