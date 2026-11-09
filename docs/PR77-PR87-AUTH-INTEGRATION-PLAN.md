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

- PR #77 verification token lifetime is 30 minutes; PR #87 uses 24 hours. The integration deliberately keeps PR #77's existing 30-minute contract; do not change the lifetime without a separate product/security decision.
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
- Historical checkpoint only: at the time of this section, runtime Node tests had not yet run. This status is superseded by the later CI result recorded below.
- Live email delivery: NOT VERIFIED.
- Preview deployment and Production: unchanged; no deployment or migration was performed.

Next at that checkpoint: run the existing `Static CI Quality Gate` on this branch using an authorized runner. This was subsequently completed successfully as recorded below.

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

## Latest source review checkpoint (2026-11-09)

- Current code commits on the integration branch include the verification-token race fix in Worker commit `f258ed0cc2866212315f14fa0b42622fc23bada3` and its regression test in `47adfab11231a4d9fe48ef7f45e7d1684b7e2ee7`.
- Re-inspected the exact D1 SQL and normalized MockD1 dispatch:
  - The verification UPDATE checks the token hash, member ID, and expiry inside the same D1 batch as activation and token cleanup.
  - The MockD1 normalizes whitespace before matching and has a dedicated handler for the new EXISTS query; the race fixture invalidates the token before the batch snapshot and asserts HTTP 400 plus an unverified member.
  - Password-reset batch still updates password only from an unexpired token for a verified member; session deletion and token deletion both require the newly written salt/hash to match.
  - Relay POST remains `redirect: manual`; the follow-up GET has no POST body or application headers and is restricted to HTTPS `script.googleusercontent.com`.
- Static source assertions: PASS. This is source inspection only, not a Node runtime execution.
- The integration branch still has no workflow run or combined status check reported by the connected GitHub integration. No available authorized workflow-dispatch action was exposed; do not create a large PR to main solely to force CI.
- Live email, browser E2E, Preview deployment, and remote Preview D1 migration remain NOT VERIFIED / NOT RUN. Production remains untouched.

## Full Static CI execution — PASS (2026-11-09)

- Found the existing `workflow_dispatch` trigger in `.github/workflows/ci-quality.yml` and dispatched the workflow on the isolated integration branch. This was a read-only validation workflow (`permissions: contents: read`) with no deployment, remote D1 migration, DNS, or secret-write steps.
- Exact tested code commit: `c6aa33e4773f04d6ec10207862fb06a2ae5d7adc`.
- GitHub Actions run #457 / run ID `42541166250`: SUCCESS.
  - Run URL: https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/42541166250
  - Job `validate`: SUCCESS (job ID `128916180391`).
  - All 17 validation steps completed with conclusion `success`.
- Passing checks include:
  - Static site + SEO feed build; generated output reports 69 homepage-linked articles.
  - JavaScript syntax and Worker security/runtime tests.
  - Community API tests, including the verification-token race case, relay redirect restrictions, D1 transaction rollback, and password-reset session revocation.
  - Community schema and Google OAuth migration tests on local SQLite.
  - Isolated Preview D1 configuration checks (configuration-only; no remote migration applied).
  - Content quality, AI Bank catalog/review queue, article attribution/diagrams, SEO, accessibility/performance, copy prompt, article navigation, and homepage article coverage.
- CI-discovered test issues were corrected on this branch before the successful run:
  1. Registration tests now use isolated default TEST-NET IPs while explicitly reusing one IP only for rate-limit assertions.
  2. MockD1 now matches the multiline password-reset session DELETE query, rather than accidentally routing it through a generic handler.
  3. The password-reset standalone test double now simulates D1 batch commit/rollback and verifies that a failed batch preserves password, sessions, and reset token.
  4. The email-verification source assertions now validate the atomic D1 batch and normalized multiline SQL instead of obsolete pre-transaction SQL/RETURNING patterns.
- Branch comparison from PR #77 baseline `54888d22b0e70d1ca9f06bac831051eede841eb0` to tested commit: 22 commits ahead, 0 behind.
- Important distinction: this PASS is for the offline/static CI workflow and its local SQLite fixtures. It does not prove live email delivery, remote Preview deployment, browser E2E, or successful OAuth with real staging credentials.
- No remote Preview deployment, remote D1 migration, Production Worker/D1, DNS, or secret changes were made.

### Remaining staging gates

1. Inspect the dedicated staging deployment path and ensure it cannot write secrets or apply migrations before any Preview deployment is considered.
2. If a safe deployment path is approved, deploy only to `ai-thuc-chien-blog-auth-app-preview` with `ai-thuc-chien-community-preview`; never use the Production Worker/D1.
3. Run read-only HTTP smoke and isolated OAuth checks on the deployed Preview. Do not attempt real email delivery through a tool path previously blocked by the safety system.
4. Keep live email delivery marked NOT VERIFIED until a permitted, independent delivery test is available.

## Isolated OAuth Preview deployment — PASS (2026-11-09)

- Enabled the existing staging-only workflow for this integration branch as a manual-only dispatch. The integration-specific workflow version does not run automatically on push.
- Removed the Cloudflare `wrangler secret bulk` step from this integration workflow. Existing Preview secrets are preserved; no secret was created, replaced, rotated, or deleted.
- Workflow run #14 / ID `42541667811`: SUCCESS.
  - Run URL: https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/runs/42541667811
  - Exact source commit: `2bc5151ff1fa34af55bef72e95e7617ebe4d661e`.
  - Dedicated Worker deployed: `ai-thuc-chien-blog-auth-app-preview`.
  - Dedicated D1 target verified read-only: `ai-thuc-chien-community-preview`, ID `51d814c8-a3fc-4481-a5f1-60bc67617f3c`.
- Safety checks completed:
  - Cloudflare confirmed the exact Preview D1 identity and that it differs from Production D1.
  - Wrangler migration listing reported `No migrations to apply!`; no SQL migration was applied.
  - Deployment config was generated with only the dedicated Preview Worker name and Preview D1 binding.
  - Existing relay secret and Google OAuth staging credentials were confirmed present but were not rewritten.
- Post-deployment checks: PASS.
  - Apps Script no-send probe accepted the shared secret and returned `INVALID_MESSAGE` before `MailApp`; no email was sent.
  - Preview frontend allowlist, unauthenticated `/api/community/me`, exact-origin credentialed CORS, and Google OAuth provider readiness: PASS.
  - Facebook OAuth remains disabled.
  - Two overlapping Google OAuth starts generated six distinct transaction-scoped secure cookies.
  - Invalid callback did not clear cookies from either active transaction.
  - Search Console verification asset served correctly.
  - Test summary explicitly confirms no user account was created and no email was sent.
- Production Worker, Production D1, DNS, and Production secrets were not targeted. No D1 migration was applied.
- Current distinction: Preview deployment and HTTP/OAuth-start smoke checks are PASS. Actual Google account consent/callback with a real user, browser session end-to-end, and email delivery are not yet verified. Do not claim them as PASS.

## Draft review handoff — PR #88 (2026-11-09)

- Created Draft PR #88: https://github.com/manhdungub-boop/ai-thuc-chien-blog/pull/88
- Head: `integration/pr77-auth-hardening-20261109` at `eac44fc90f3d0b57bb8276eddf32539b02bdf4fe`.
- Base: PR #77 branch `sync/gitlab-completed-work-20261107` at exact baseline `54888d22b0e70d1ca9f06bac831051eede841eb0`.
- GitHub reports PR #88 open, Draft, mergeable=true, merged=false.
- The PR is intentionally stacked on PR #77, not opened against `main`; it adds six changed files to the PR #77 baseline.
- PR #77, PR #85, PR #87, and PR #88 all remain Draft/open and unmerged. No PR was marked ready and no merge was performed.
- PR #88 is a review handoff only. The passing CI and Preview evidence above applies to the exact deployed code commit `2bc5151ff1fa34af55bef72e95e7617ebe4d661e`; the later head changes only update this plan document. Re-run CI if any code or workflow files change.
