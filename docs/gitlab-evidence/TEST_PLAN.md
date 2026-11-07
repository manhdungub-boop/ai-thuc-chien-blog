# Staging verification test plan

This is a test plan, not a claim that these tests have passed. Run only against an isolated staging Worker and the preview D1 database.

## Preconditions
- Restore static assets and build configuration from a trusted source.
- Use a test-only relay secret stored in Cloudflare secret settings; never put it in Git.
- Verify the relay endpoint's POST handler and request authentication without sending email to a real user. Then use a controlled test mailbox.
- Confirm the preview Worker points only to `ai-thuc-chien-community-preview`.

## Required tests

| ID | Test | Expected result |
|---|---|---|
| REG-01 | Register with valid username, email and password | Returns a pending-verification response; does not create a logged-in session. |
| REG-02 | Inspect schema after registration using counts only | Member is unverified; one hashed token exists with an expiry; no plaintext token is stored in D1. |
| REG-03 | Register with invalid username/email/password | 4xx response; no member or session created. |
| REG-04 | Register duplicate email or username | Conflict response; no duplicate member. |
| MAIL-01 | Relay URL/secret absent or malformed | Registration fails safely; no success/activation message. |
| MAIL-02 | Relay POST succeeds to a controlled test mailbox | Message arrives with a valid confirmation link. |
| VER-01 | Confirm with valid token before expiry | Sets verification timestamp and consumes token. |
| VER-02 | Confirm with invalid, expired or reused token | Rejects token; does not verify an account. |
| AUTH-01 | Login before confirmation | Rejected with an email-confirmation-required response; no session cookie. |
| AUTH-02 | Login after confirmation | Succeeds and creates a session cookie with secure attributes. |
| RESEND-01 | Request resend for unknown and known email | Same public response shape; rate limits are enforced. |
| SEC-01 | Try cross-origin, malformed JSON, oversized inputs and repeated requests | Requests are rejected safely; rate limits work; no sensitive values appear in logs. |
| REG-05 | Trigger a simulated relay failure | Registration is not reported as successful; no orphan pending account/token remains. |
| PROD-01 | Compare production bindings and D1 schema before/after staging tests | Production Worker, D1, DNS, data and deployment remain unchanged. |

## Exit criteria
- All tests have recorded actual results and evidence.
- Relay POST delivery is verified.
- No test uses production credentials or production user data.
- Security review confirms token hashing, expiry, single-use semantics, login gating, rate limiting, cookie settings and safe error handling.
- A separate production migration and deployment plan is reviewed before any release decision.
