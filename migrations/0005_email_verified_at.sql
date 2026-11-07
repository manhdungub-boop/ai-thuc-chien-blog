-- Existing accounts remain active; new password registrations start unverified.
ALTER TABLE community_members ADD COLUMN email_verified_at TEXT;
UPDATE community_members SET email_verified_at = created_at WHERE email_verified_at IS NULL;
