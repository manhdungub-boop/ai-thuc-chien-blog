import sqlite3
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sql = (root / "migrations/0003_community_oauth_accounts.sql").read_text(encoding="utf-8")
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys=ON")
db.executescript("""
CREATE TABLE community_members (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE
);
INSERT INTO community_members(id,email) VALUES ('member-1','member@example.com');
""")
db.executescript(sql)
db.execute(
    "INSERT INTO community_oauth_accounts(provider,provider_user_id,member_id,email,created_at) VALUES(?,?,?,?,?)",
    ("google", "subject-1", "member-1", "member@example.com", "2026-11-06T00:00:00Z"),
)
assert db.execute("SELECT COUNT(*) FROM community_oauth_accounts").fetchone()[0] == 1
try:
    db.execute(
        "INSERT INTO community_oauth_accounts(provider,provider_user_id,member_id,email,created_at) VALUES(?,?,?,?,?)",
        ("google", "subject-1", "member-1", "member@example.com", "2026-11-06T00:01:00Z"),
    )
    raise AssertionError("duplicate provider subject was accepted")
except sqlite3.IntegrityError:
    pass
try:
    db.execute(
        "INSERT INTO community_oauth_accounts(provider,provider_user_id,member_id,email,created_at) VALUES(?,?,?,?,?)",
        ("facebook", "subject-2", "member-1", "member@example.com", "2026-11-06T00:02:00Z"),
    )
    raise AssertionError("non-Google provider was accepted")
except sqlite3.IntegrityError:
    pass
db.execute("DELETE FROM community_members WHERE id='member-1'")
assert db.execute("SELECT COUNT(*) FROM community_oauth_accounts").fetchone()[0] == 0
print("PASS additive Google OAuth migration on in-memory SQLite only")
