-- The preview database already contains email_verified_at; backfill legacy rows as verified.
UPDATE community_members SET email_verified_at = created_at WHERE email_verified_at IS NULL;
