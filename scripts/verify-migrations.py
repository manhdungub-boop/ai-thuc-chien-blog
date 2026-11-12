import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
migration_1 = (root / "migrations/0001_community_reconstructed.sql").read_text(encoding="utf-8")
migration_2 = (root / "migrations/0002_email_verification_reconstructed.sql").read_text(encoding="utf-8")
migration_3 = (root / "migrations/0003_password_reset_tokens.sql").read_text(encoding="utf-8")

db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.executescript(migration_1)
db.execute(
    "INSERT INTO community_members(id,username,email,display_name,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?)",
    ("existing", "existing_user", "existing@example.invalid", "Existing", "salt", "hash", "2026-10-20T00:00:00Z"),
)
db.executescript(migration_2)
db.executescript(migration_3)

columns = {row[1] for row in db.execute("PRAGMA table_info(community_members)")}
required_columns_present = {"email_verified_at", "email_verification_required"}.issubset(columns)

existing_row = db.execute(
    "SELECT email_verified_at, email_verification_required FROM community_members WHERE id='existing'"
).fetchone()
existing_verified = existing_row is not None and existing_row[0] is not None and existing_row[1] == 0

db.execute(
    "INSERT INTO community_members(id,username,email,display_name,password_salt,password_hash,created_at,email_verified_at) VALUES(?,?,?,?,?,?,?,NULL)",
    ("pending", "pending_user", "pending@example.invalid", "Pending", "salt", "hash", "2026-10-24T00:00:00Z"),
)
pending_row = db.execute(
    "SELECT email_verified_at, email_verification_required FROM community_members WHERE id='pending'"
).fetchone()
new_member_unverified = pending_row is not None and pending_row[0] is None

db.execute(
    "INSERT INTO community_email_verification_tokens(token_hash,member_id,created_at,expires_at) VALUES(?,?,?,?)",
    ("test-hash", "pending", "2026-10-24T00:00:00Z", "2026-10-24T00:30:00Z"),
)
db.execute(
    "INSERT INTO community_password_reset_tokens(token_hash,member_id,created_at,expires_at) VALUES(?,?,?,?)",
    ("reset-test-hash", "pending", "2026-10-24T00:00:00Z", "2026-10-24T00:30:00Z"),
)
db.execute("DELETE FROM community_members WHERE id='pending'")
token_cascade = (
    db.execute("SELECT COUNT(*) FROM community_email_verification_tokens").fetchone()[0] == 0
    and db.execute("SELECT COUNT(*) FROM community_password_reset_tokens").fetchone()[0] == 0
)

indexes = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='index'")}
required_indexes = {
    "idx_community_messages_member",
    "idx_community_messages_topic_created",
    "idx_community_sessions_expiry",
    "idx_community_email_verification_expiry",
    "idx_community_email_verification_member",
    "idx_community_password_reset_expiry",
    "idx_community_password_reset_member",
}
indexes_present = required_indexes.issubset(indexes)

# Rehearse migration 0003 against a schema shape observed in the current
# production D1. This remains an in-memory compatibility test, not approval to
# execute any migration on a real database.
prod_like = sqlite3.connect(":memory:")
prod_like.execute("PRAGMA foreign_keys=ON")
prod_like.executescript("""
CREATE TABLE community_members (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  email_verified_at TEXT
);
CREATE TABLE community_email_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES community_members(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
""")
prod_like.execute(
    "INSERT INTO community_members(id,username,email,display_name,password_salt,password_hash,created_at,email_verified_at) VALUES(?,?,?,?,?,?,?,?)",
    ("existing", "existing_user", "existing@example.invalid", "Existing", "salt", "hash", "2026-10-20T00:00:00Z", "2026-10-20T00:01:00Z"),
)
prod_like.execute(
    "INSERT INTO community_members(id,username,email,display_name,password_salt,password_hash,created_at,email_verified_at) VALUES(?,?,?,?,?,?,?,NULL)",
    ("pending", "pending_user", "pending@example.invalid", "Pending", "salt", "hash", "2026-10-24T00:00:00Z"),
)
prod_like.execute(
    "INSERT INTO community_email_verification_tokens(token_hash,member_id,created_at,expires_at) VALUES(?,?,?,?)",
    ("verify-test-hash", "pending", "2026-10-24T00:00:00Z", "2026-10-24T00:30:00Z"),
)
prod_like.executescript(migration_3)
prod_like_columns = {row[1] for row in prod_like.execute("PRAGMA table_info(community_members)")}
prod_like_existing_preserved = prod_like.execute(
    "SELECT email_verified_at FROM community_members WHERE id='existing'"
).fetchone() == ("2026-10-20T00:01:00Z",)
prod_like_reset_table_exists = prod_like.execute(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='community_password_reset_tokens'"
).fetchone() is not None
prod_like_indexes = {row[0] for row in prod_like.execute("SELECT name FROM sqlite_master WHERE type='index'")}
prod_like_indexes_present = {
    "idx_community_password_reset_expiry",
    "idx_community_password_reset_member",
}.issubset(prod_like_indexes)
prod_like.execute(
    "INSERT INTO community_password_reset_tokens(token_hash,member_id,created_at,expires_at) VALUES(?,?,?,?)",
    ("reset-test-hash", "pending", "2026-10-24T00:00:00Z", "2026-10-24T00:30:00Z"),
)
prod_like.execute("DELETE FROM community_members WHERE id='pending'")
prod_like_cascade = (
    prod_like.execute("SELECT COUNT(*) FROM community_password_reset_tokens").fetchone()[0] == 0
    and prod_like.execute("SELECT COUNT(*) FROM community_email_verification_tokens").fetchone()[0] == 0
)
prod_like_schema_compatible = (
    prod_like_existing_preserved
    and prod_like_reset_table_exists
    and prod_like_indexes_present
    and "email_verification_required" not in prod_like_columns
    and prod_like_cascade
)

results = {
    "required_verification_columns_present_on_fresh_schema": required_columns_present,
    "existing_members_grandfathered_as_verified": existing_verified,
    "new_members_remain_unverified": new_member_unverified,
    "verification_and_reset_tokens_cascade_on_member_delete": token_cascade,
    "required_indexes_present": indexes_present,
    "password_reset_migration_is_compatible_with_existing_prod_schema_shape": prod_like_schema_compatible,
}
for name, passed in results.items():
    print(("PASS " if passed else "FAIL ") + name)
if not all(results.values()):
    raise SystemExit(1)
print("All migration rehearsals passed on in-memory SQLite only. No real D1 database was accessed; this does not authorize production migration.")
