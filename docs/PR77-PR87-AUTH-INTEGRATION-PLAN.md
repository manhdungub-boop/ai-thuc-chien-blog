# PR #77 + PR #87 Authentication Hardening Integration Plan

Date: 2026-11-09
Target branch: `integration/pr77-auth-hardening-20261109`
Starting commit: `54888d22b0e70d1ca9f06bac831051eede841eb0` (PR #77 head)

## Scope and safety boundary

This branch is an isolated integration workspace. It is not a deployment target and must not be merged or deployed to Production as part of this work. No Production D1, Worker, DNS, secrets, or real user records may be changed.

## Architecture decision

Use PR #77 as the application baseline. It contains the broader community feature set: member sessions, topic messages, email verification and resend, password reset, and Google OAuth (plus the Facebook identity isolation safeguards in its Worker).

Keep PR #77's canonical verification state in `community_members.email_verified_at`. Do not import PR #85's parallel `community_email_verification_status` table or its migration 0006. Do not replace the PR #77 Worker wholesale with the smaller PR #85 Worker.

Keep the existing PR #77 migrations 0001-0004 as the schema baseline:
- 0001: community members, sessions, messages, rate limits.
- 0002: `email_verified_at` plus one-time verification-token table; existing accounts are backfilled as verified.
- 0003: OAuth accounts.
- 0004: password-reset tokens.

Before any migration test, validate the complete ordered migration set against a fresh SQLite database and a database populated with representative pre-verification members. Tests must prove existing accounts remain verified and foreign-key cascades remain intact.

## Security changes to port from PR #87

1. Email relay redirect handling:
   - POST to the configured Apps Script relay with `redirect: "manual"`.
   - If a 3xx response is returned, require a Location header.
   - Resolve the destination and allow only the exact HTTPS origin `https://script.googleusercontent.com`; reject credentials and any alternate origin/port.
   - Follow with a GET that contains no POST body, relay secret, or application headers.
   - Keep errors sanitized; never log relay URLs, secrets, tokens, or recipient addresses.
   - Apply the shared helper to both verification and password-reset email delivery.

2. Email verification completion:
   - Preserve PR #77's `email_verified_at` column.
   - Replace separate token consumption and member update statements with one D1 batch transaction.
   - Update only the member whose unexpired token hash matches and whose `email_verified_at` is NULL.
   - Delete the matching token only when the guarded update succeeds.
   - Confirm a failed update or failed batch leaves the token available and does not mark the member verified.
   - Keep the frontend's explicit user confirmation button; merely opening an email link must not consume the token.

3. Password-reset completion:
   - Replace separate token consumption, password update, session revocation, and token cleanup with one D1 batch transaction.
   - Update the password only for the member referenced by a valid, unexpired token.
   - Guard session revocation and token deletion on the new password salt/hash having been written.
   - A zero-row password update or batch failure must not consume the token or revoke sessions.
   - Preserve the generic password-reset request response to prevent account enumeration.

4. Preserve PR #77 features:
   - Keep resend-verification and its rate limits.
   - Keep OAuth callback/state/nonce protections and provider identity isolation.
   - Keep existing route and response contracts unless a focused regression test proves a required change.

## Known differences to resolve deliberately

- PR #77 verification token lifetime is 30 minutes; PR #87 uses 24 hours. Choose one policy explicitly and keep Worker, email copy, frontend, and tests consistent. Proposed integration default: 24 hours, subject to review of abuse/rate-limit controls.
- PR #77's frontend already has a dedicated confirmation button. Do not replace it with an auto-consuming GET.
- PR #77's relay helper currently assumes a direct JSON response; PR #87's manual redirect guard is the required fix.
- PR #77's verification and password-reset completion currently perform multiple independent writes; PR #87's transaction guards are required.

## Required tests before a staging Preview build

- Full migration test on fresh and pre-existing database fixtures.
- Community API offline regression covering registration rollback, resend, verification success, invalid/expired/replayed token, and transaction rollback.
- Password-reset tests covering successful reset, invalid/expired/replayed token, zero-row password update, batch rollback, and session revocation only after success.
- Relay tests covering normal response, expected Google redirect, missing Location, untrusted origin, credentials, non-standard port, and ensuring the follow-up GET carries no secret/body/custom headers.
- Frontend tests proving the explicit confirmation action is required and tokens are removed from the URL after completion.
- OAuth regression tests proving Google verification rules and Facebook identity isolation remain unchanged.
- Static site, SEO, accessibility, and content quality gates from PR #77.
- Preview-only browser E2E with disposable test identity. Email delivery remains unverified until a safe, authorized end-to-end check succeeds.

## Release gates

- No Production migration, Worker deployment, DNS change, secret change, or merge is authorized by this plan.
- Do not bypass any tool safety block to send email or access account credentials.
- A successful offline test or Preview deployment does not establish successful email delivery.
- Keep PR #77, #85, and #87 unchanged until the integration branch passes all required gates and a separate release decision is made.


## Implementation progress (2026-11-09)

- Created the isolated integration branch from PR #77 head.
- Ported the guarded Apps Script redirect helper into the PR #77 Worker. The initial POST uses manual redirect handling; a redirect is accepted only for the exact HTTPS origin `https://script.googleusercontent.com`, with no URL credentials and no non-standard port. The follow-up GET does not forward the POST body, relay secret, or application headers. Both verification and password-reset email paths use the helper.
- Converted email verification completion into one D1 batch: guarded member verification, token consumption, and cleanup commit together.
- Converted password-reset completion into one D1 batch: password update, session revocation, and token consumption. Session/token cleanup is guarded by the newly generated password salt/hash.
- Expanded the community API test double to model D1 batch rollback and added regression cases for unsafe relay redirects, missing Location, verification transaction rollback, password-reset transaction rollback, and zero-row password-update protection.

### Validation status

- Structural source checks: PASS (expected helper, allowlist, D1 batch paths, guards, and test cases are present).
- Runtime Node test suite: NOT RUN. The GitHub connector used for this task exposes read operations but no workflow-dispatch action; the isolated container has no network access to retrieve the branch files. Do not treat the added tests as passing until GitHub Actions or another authorized local runner executes them.
- GitHub Actions run for this integration branch: none observed as of this update.
- Live email delivery: NOT VERIFIED.
- Preview deployment and Production: unchanged; no deployment or migration was performed.

Next: run the existing `Static CI Quality Gate` on this branch using an authorized runner, fix any test-double or SQL regressions, then proceed to the remaining OAuth and migration regression checks.

## Source and migration audit update (2026-11-09)

- Re-fetched the integration branch and confirmed it remains ahead of PR #77's starting commit, with no divergence behind that baseline.
- Reviewed Worker relay handling and the verification/password-reset D1 batches against their test-double handlers. The test harness snapshots and restores member, session, verification-token, and reset-token state when a simulated batch statement fails.
- Reviewed migrations 0001-0004 and executed the fetched migration test sources in an isolated local SQLite workspace:
  - `scripts/test_community_schema.py`: PASS.
  - `scripts/test_google_oauth_migration.py`: PASS.
  - These checks cover the existing-member verification backfill, expected tables, token single-use behavior, topic/member constraints, duplicate Google subject rejection, rejection of non-Google provider rows, and OAuth identity cascade on member deletion.
- Clarified the apparent Google/Facebook schema mismatch: the active staging OAuth route is Google-only, and the Worker integration test explicitly asserts that a Facebook OAuth route is not enabled. The migration's `CHECK (provider = 'google')` is therefore intentional for the currently exposed feature. The dormant provider-generic helper is not authorization to enable Facebook OAuth; do not broaden the schema or route without a separate security review and tests.
- Kept the existing PR #77 email-verification lifetime of 30 minutes. The Worker constant and both email bodies state 30 minutes; the earlier proposed 24-hour policy remains unadopted to avoid silently changing the established contract.
- GitHub Actions workflow runs and combined status checks for the audited code head and subsequent documentation-only updates: none returned. The documentation commits do not alter the Worker or runtime tests. Node runtime suite, browser E2E, and live email delivery remain NOT VERIFIED.
- No Worker deployment, D1 migration, DNS change, secret change, or Production action was performed.

### Remaining gates

1. Obtain an authorized GitHub Actions run for this exact integration branch/head; current connector does not expose workflow dispatch.
2. Execute the Node community API, relay redirect, verification/reset, Google OAuth, and static-site/SEO/content gates on that head.
3. Review fresh-database and populated-database migration behavior plus foreign-key cascades in the full workflow.
4. Only after those gates pass, perform Preview-only validation with the separately authorized staging target. Live email remains a separate gate and must not be attempted through a tool path that has been safety-blocked.

## Follow-up race-condition hardening (2026-11-09)

- Source review found a narrow time-of-check/time-of-use gap in email verification: the route selected an unexpired token before opening the D1 batch, but the first UPDATE inside the batch only checked member ID and unverified state. A concurrent resend/removal between the SELECT and batch could therefore leave a stale token able to verify the member.
- Closed the gap in `worker.mjs`: the transactional UPDATE now independently requires the exact token hash, matching member ID, and `expires_at > now` in an `EXISTS` predicate. The token is revalidated at the point of state change, not only before the transaction.
- Extended `scripts/test_community_api.mjs` so the MockD1 can simulate token invalidation between the initial lookup and batch, and added a regression case asserting the member remains unverified and the request fails closed.
- Static inspection of the updated Worker SQL, MockD1 handler, and race fixture: PASS. Runtime Node suite: NOT RUN; no GitHub Actions run or status check has been returned for the branch. This change is not represented as runtime-tested.
