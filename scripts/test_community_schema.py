#!/usr/bin/env python3
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"
EXPECTED_MIGRATIONS = [
    "0001_community.sql",
    "0002_email_verification.sql",
    "0003_community_oauth_accounts.sql",
    "0004_community_password_reset.sql",
    "0005_email_verified_at.sql",
    "0006_email_verification_status.sql",
]
actual_migrations = sorted(path.name for path in MIGRATIONS.glob("*.sql"))
assert actual_migrations == EXPECTED_MIGRATIONS, (
    f"Expected the complete ordered migration chain {EXPECTED_MIGRATIONS}, "
    f"found {actual_migrations}"
)

conn = sqlite3.connect(":memory:")
conn.execute("PRAGMA foreign_keys=ON")

# Start from an empty database, then seed an account at the historical point
# before email verification was introduced. Migrations 0002 and 0006 must
# grandfather that account as verified without losing its original timestamp.
conn.executescript((MIGRATIONS / EXPECTED_MIGRATIONS[0]).read_text(encoding="utf-8"))
created_at = "2026-01-01T00:00:00.000Z"
conn.execute(
    "INSERT INTO community_members VALUES (?,?,?,?,?,?,?)",
    ("m1", "member_1", "member@example.com", "Member One", "salt", "hash", created_at),
)
for migration_name in EXPECTED_MIGRATIONS[1:]:
    conn.executescript((MIGRATIONS / migration_name).read_text(encoding="utf-8"))

tables = {
    row[0]
    for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
}
required_tables = {
    "community_members",
    "community_sessions",
    "community_messages",
    "community_rate_limits",
    "community_email_verification_tokens",
    "community_oauth_accounts",
    "community_password_reset_tokens",
    "community_email_verification_status",
}
assert required_tables.issubset(tables), f"Missing tables: {required_tables - tables}"

member_verified_at = conn.execute(
    "SELECT email_verified_at FROM community_members WHERE id='m1'"
).fetchone()[0]
assert member_verified_at == created_at, "Migration 0002 must preserve existing verified accounts"

status_row = conn.execute(
    "SELECT verified_at, created_at FROM community_email_verification_status WHERE member_id='m1'"
).fetchone()
assert status_row == (created_at, created_at), (
    "Migration 0006 must backfill existing members as verified using their original creation time"
)

# Migration 0006 is safe to re-run: table creation is guarded and backfill is
# INSERT OR IGNORE, so an existing verification state must not be overwritten.
conn.executescript((MIGRATIONS / "0006_email_verification_status.sql").read_text(encoding="utf-8"))
assert conn.execute(
    "SELECT COUNT(*) FROM community_email_verification_status WHERE member_id='m1'"
).fetchone()[0] == 1
assert conn.execute(
    "SELECT verified_at FROM community_email_verification_status WHERE member_id='m1'"
).fetchone()[0] == created_at

conn.execute(
    "INSERT INTO community_messages VALUES (?,?,?,?,?)",
    ("msg1", "tools", "m1", "Hello community", "2026-01-01T00:01:00.000Z"),
)
conn.execute(
    "INSERT INTO community_email_verification_tokens VALUES (?,?,?,?)",
    ("verify-hash", "m1", created_at, "2026-01-01T01:00:00.000Z"),
)
conn.execute(
    "INSERT INTO community_oauth_accounts VALUES (?,?,?,?,?)",
    ("google", "google-subject-1", "m1", "member@example.com", created_at),
)
conn.execute(
    "INSERT INTO community_password_reset_tokens VALUES (?,?,?,?)",
    ("reset-hash", "m1", created_at, "2026-01-01T00:30:00.000Z"),
)

consumed = conn.execute(
    "DELETE FROM community_password_reset_tokens WHERE token_hash=? AND expires_at>? RETURNING member_id",
    ("reset-hash", "2026-01-01T00:15:00.000Z"),
).fetchone()
assert consumed == ("m1",)
assert conn.execute(
    "DELETE FROM community_password_reset_tokens WHERE token_hash=? AND expires_at>? RETURNING member_id",
    ("reset-hash", "2026-01-01T00:15:00.000Z"),
).fetchone() is None

try:
    conn.execute(
        "INSERT INTO community_messages VALUES (?,?,?,?,?)",
        ("msg2", "unknown", "m1", "Invalid topic", "2026-01-01T00:02:00.000Z"),
    )
    raise AssertionError("topic CHECK constraint was not enforced")
except sqlite3.IntegrityError:
    pass

try:
    conn.execute(
        "INSERT INTO community_password_reset_tokens VALUES (?,?,?,?)",
        ("another-reset-hash", "missing-member", created_at, "2026-01-01T00:30:00.000Z"),
    )
    raise AssertionError("password-reset member foreign key was not enforced")
except sqlite3.IntegrityError:
    pass

conn.execute("DELETE FROM community_members WHERE id='m1'")
for table in (
    "community_email_verification_tokens",
    "community_email_verification_status",
    "community_oauth_accounts",
    "community_password_reset_tokens",
    "community_messages",
):
    assert conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0, (
        f"Deleting a member must cascade-delete rows from {table}"
    )

print(
    "PASS: migrations 0001-0006 are complete and ordered; existing accounts are "
    "grandfathered; verification status is backfilled idempotently; constraints "
    "and foreign-key cascades are enforced (in-memory SQLite only)"
)
