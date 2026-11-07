# Verification-token single-use concurrency hardening — 2026-10-26

## Finding

The prior confirmation flow performed a SELECT of the token row before it later deleted the token. Two requests arriving close together could both read the valid token before either deletion committed, creating a race where both requests returned success despite the one-time-token contract.

## Branch-only remediation

The candidate now uses a conditional atomic claim:

`DELETE FROM community_email_verification_tokens WHERE token_hash = ? AND expires_at > ? RETURNING member_id`

Only the request that deletes and receives the valid token row proceeds to set `email_verified_at`. A concurrent request, replay, malformed token, or expired token returns the generic invalid/expired-link response. An expired row is conditionally cleaned up. The change is confined to `feature/required-email-verification-staging`; no Worker deployment was changed.

## Regression test

`scripts/test-worker-email-verification.mjs` now sends two concurrent verification requests for the same token using an isolated in-memory D1 mock and fake relay, then asserts exactly one 200 response, one 400 response, a verified member, and no remaining token. Existing expiry, replay, resend-rate-limit, and relay-failure tests remain in the suite.

## Schema compatibility

The atomic claim and expired-token cleanup SQL were each submitted as `EXPLAIN` to production D1 and staging D1:
- Production D1: both SQL statements prepared with HTTP 200 and no D1 errors.
- Staging D1: both SQL statements prepared with HTTP 200 and no D1 errors.

These were prepare-only queries; neither DELETE statement executed. No database rows or schemas were changed. The complete candidate SQL preflight is updated in `PRODUCTION_SQL_COMPATIBILITY_PREFLIGHT_2026-10-26.md`.

## Safety boundary

No real email was sent, no live test account was created, and no active Worker, traffic allocation, relay configuration, secret, DNS, Pages deployment, or D1 row/schema was modified. CI is validation-only. Production remains NO-GO until the other relay, logging, mobile/browser, backup, and rollback gates pass.
