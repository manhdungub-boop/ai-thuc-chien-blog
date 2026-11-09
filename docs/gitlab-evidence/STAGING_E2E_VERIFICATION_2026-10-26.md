# Staging end-to-end verification — 2026-10-26

## Scope

Read-only checks were used wherever possible. One disposable account was created only on the isolated staging Worker to validate the real email relay and activation path, then deleted. No production Worker deployment, production D1 rows/schema, DNS, Pages deployment, or production secret was changed.

## Results from live staging

- `GET /__staging/status` returned HTTP 200 with `ok=true`, `environment=staging`, `database_ready=true`, `schema_ready=true`, `email_sending_enabled=true`, and `registration_ready=true`.
- The isolated staging registration endpoint returned HTTP 202 with `pendingVerification=true`; no session was issued at registration.
- A real confirmation email arrived in the connected Gmail mailbox. The message contained a staging-host confirmation link with a 30-minute expiration and single-use wording. No token, password, or test recipient is recorded here.
- The staging verification API returned HTTP 200 with the expected successful-confirmation message.
- A read-only D1 query then confirmed that `email_verified_at` had been populated for the disposable test member.
- Login after confirmation returned HTTP 200 and a member object.
- The disposable member was deleted from the isolated staging D1; a follow-up count query returned zero matching rows.
- Staging `/login` and `/register` both resolved to their matching `?mode=login` / `?mode=register` views. `/script.js`, `/styles.css`, and anonymous `/api/community/me` returned HTTP 200; anonymous `me` returned `{"member":null}`.
- After the observability change below, the staging health endpoint was rechecked and all readiness flags remained true. `/login`, `/register`, `/script.js`, `/styles.css`, and anonymous `/api/community/me` still returned HTTP 200.

## Changes validated on the staging branch

- Fixed the reconstructed fresh-scratch migration so it creates the `email_verification_required` column expected by the staging schema-readiness check.
- Extended `scripts/verify-migrations.py` to assert both verification columns exist after applying the recovery migrations, while also checking legacy-member backfill, pending-member state, foreign-key cascade, and required indexes.
- Latest verified pipeline [#94](https://gitlab.com/manhdungub/ai-thuc-chien-blog/-/pipelines/2987817204) passed on commit `b7d8cd79da14c98a2e82a89c9e08cf3a10741d95`.
- These migrations are reconstructed test fixtures, not authoritative production migrations. Do **not** apply them to an existing staging or production D1; the deployed schema already contains these fields, so blind application may fail on duplicate columns.

## Cloudflare deployment reconciliation — important correction

Cloudflare distinguishes the latest uploaded Worker version from the version currently deployed to the public hostname. Earlier wording that treated the latest settings response as the live production binding was inaccurate; this section supersedes that interpretation.

- Public Worker `ai-thuc-chien-blog` has deployment `51587fe9-266d-4c54-a04d-7441de83b445`, created 2026-10-24 09:39:20Z, assigning 100% traffic to deployed version **175** (`3713d7c4-ca28-470a-b0bc-33c8e3712877`).
- Deployed version 175 binds `DB` to D1 ID `fc2517cb-9543-4d7b-98f4-bcd5f3c013e7`.
- A later uploaded version **176** (`6a5e8b7e-35b3-4e13-9dfa-edc71cc651b7`) is explicitly annotated `Preview only: email verification integration using staging D1` and binds `DB` to `51d814c8-a3fc-4481-a5f1-60bc67617f3c`. This is a different resource and must not be assumed to be production.
- The staging Worker `ai-thuc-chien-blog-auth-app-preview` is separately deployed to version 24 (`edf26044-6ea7-4790-8ee5-cfba4799f045`) and uses D1 ID `c8b301f0-afcf-4f36-9b8e-8194c01bbbc8`.
- The latest uploaded public Worker version 176 and the isolated staging Worker are not interchangeable. Do not deploy version 176 or change any DB binding until the intended rollout and schema are explicitly reviewed.
- This earlier source attribution is superseded by the version-scoped audit performed on 2026-10-26. The exact active public version 175 source does **not** contain the `/api/community/verify` route or email-verification markers. Those belong to uploaded preview-only version 176, which is bound to a preview D1. See [version-scoped Worker source audit](VERSION_SCOPED_WORKER_SOURCE_AUDIT_2026-10-26.md). The live public `/login` and `/register` route behavior remains a separate route-resolution issue; it does not prove that version 175 contains email-verification code.

## Observability change — verified on staging only

- On 2026-10-26, updated only the staging Worker Script Settings endpoint to set `observability.redact_query_string=true`. The update returned HTTP 200 and a subsequent read confirmed the flag is `true`.
- Existing staging observability options were preserved: observability remains disabled at the top level; logs and invocation logs remain enabled and persistent; traces remain disabled.
- A post-change staging smoke test returned HTTP 200 for `/__staging/status`, `/login`, `/register`, `/script.js`, `/styles.css`, and `/api/community/me`. The status payload continued to report database/schema/email/registration readiness as true.
- A separate read confirmed the public Worker Script Settings still has `redact_query_string=false`; no production settings were changed. This is an outstanding security-hardening item for a separately reviewed production settings change.

## Remaining release blockers

1. Direct requests to public `/login` and `/register` still resolve to the homepage without the matching mode parameter. The route fix is present in the preview candidate but is not part of deployed public version 175.
2. Live end-to-end expiry, token-replay, resend-rate-limit, and mobile Safari acceptance tests still need recorded evidence. Existing CI runtime tests cover these behaviors with an in-memory D1 and a fake relay; those mock tests are not equivalent to live tests.
3. The latest read-only Apps Script export matches the reviewed `email-relay/Code.gs` by SHA-256 after newline normalization (`587e27db36652e18b7b85d5382a5defefa93d688b9b2d569a6bfbe5cd07040d8`), and the exported project has exactly one `doPost` across all source files. The successful live test confirms the current staging path can send the expected email; Script Properties values were not read, and the Web App deployment ID/version was not independently fetched. The exported manifest uses `America/New_York` while the repository manifest uses `Asia/Ho_Chi_Minh`; this should be reconciled before a future manual deployment.
4. The public deployed version 175 references a different Apps Script relay URL from the isolated staging Worker. Treat the two relay deployments as separate until the active deployment source and security properties are independently verified.
5. The public Worker is still marked in settings as preview-only for email verification and its current deployed code differs from the isolated staging candidate. Before any release, reconcile deployed code, intended database, relay endpoint, migration strategy, and rollback plan as a single reviewed release candidate.

## Decision

**NO-GO for production release.** Staging registration, real email delivery, confirmation, and post-confirmation login passed once end to end. The latest staging CI passed. Staging query-string redaction is now enabled and smoke-tested. Production remains on deployed version 175; version 176 is a preview-only upload. No production deployment, database, DNS, or configuration was changed.

## Friendly login/register route fix — branch candidate only

- Commit `9d2d4e2cb41f69b6fc8c2e0265c557837411dbd6` updates `recovery-snapshots/worker.mjs` so safe `GET`/`HEAD` requests to `/login` and `/register` resolve to `/index.html?mode=login` or `/index.html?mode=register`. The requested mode overrides any conflicting existing `mode` query value while preserving unrelated query parameters. Non-GET/HEAD requests are not rewritten.
- Added `scripts/test-route-resolution.mjs` covering both auth routes, query preservation/override, extensionless article URLs, and no rewrite of `POST /login`. The GitLab CI configuration runs this test in the validation job.
- Pipeline [#99](https://gitlab.com/manhdungub/ai-thuc-chien-blog/-/pipelines/2987861808) passed. Both `javascript-validation` and `migration-validation` jobs reported success.
- This is a repository-only candidate change. It has **not** been uploaded or deployed to Cloudflare, and the live public `/login` and `/register` behavior remains unchanged until a separately reviewed staging deployment. Production remains NO-GO.

## Follow-up: friendly login/register route fix in GitLab candidate — 2026-10-26

- Commit `9d2d4e2cb41f69b6fc8c2e0265c557837411dbd6` updates only the branch candidate `recovery-snapshots/worker.mjs`, adds `scripts/test-route-resolution.mjs`, and adds that test to validation CI.
- The resolver maps safe `GET`/`HEAD` requests for `/login` and `/register` to `/index.html`, setting `mode=login` or `mode=register` while preserving other query parameters. It does not rewrite `POST` requests and leaves existing extensionless article URL mapping in place.
- Pipeline [#99](https://gitlab.com/manhdungub/ai-thuc-chien-blog/-/pipelines/2987861808) passed. Both `javascript-validation` and `migration-validation` jobs passed. The route test uses a mock asset binding, so this is CI evidence only, not live Cloudflare evidence.
- The code has **not** been uploaded to or deployed on the Cloudflare staging Worker; the public Worker was not changed. A live staging deployment test is a separate gate and must preserve current static assets, D1 binding, relay URL, and secret bindings.

## Follow-up: repeat live route smoke test — 2026-10-26 04:12 UTC

Read-only GET checks were repeated after the branch-only route patch. These results describe the deployed services, not the GitLab mock test:

- Public Worker homepage: HTTP 200. Public `/login` and `/register` both resolve to the public homepage without `mode=login` / `mode=register`. Public anonymous `/api/community/me` returns HTTP 200 with `{"member":null}`. This confirms the live public-route bug remains until a reviewed Worker release is deployed.
- Pages backup homepage: HTTP 200; direct `/login` and `/register` return HTTP 404, so Pages is not a working fallback for those friendly auth URLs by itself.
- Isolated staging: `/__staging/status` returns HTTP 200 and all readiness flags are true; `/login` and `/register` resolve to the corresponding mode query and `#cong-dong`; `/script.js`, `/styles.css`, and anonymous `/api/community/me` return HTTP 200.
- The current route-fix commit is CI-tested only. It has not been deployed to Cloudflare staging or the public Worker. Do not describe the public routing defect as fixed until a deployment to a controlled preview has been verified end to end.

## Follow-up: route fix no longer requires an ASSETS binding — 2026-10-26 04:23 UTC

- Commit [`89f51a97`](https://gitlab.com/manhdungub/ai-thuc-chien-blog/-/commit/89f51a9760e5ff5ca73ad142514835e8a6be633c) changes `/login` and `/register` handling to a no-store 302 redirect to `/?mode=login#cong-dong` or `/?mode=register#cong-dong`. Existing query parameters are preserved, the requested mode overrides any conflicting `mode` parameter, and only GET/HEAD requests are redirected.
- The resolver now avoids relying on `ASSETS` for the auth route itself, which makes the intended behavior testable even though the isolated auth preview has no `ASSETS` binding. Article asset mapping remains unchanged.
- Pipeline [#107](https://gitlab.com/manhdungub/ai-thuc-chien-blog/-/pipelines/2987950019) passed on commit `89f51a9760e5ff5ca73ad142514835e8a6be633c`; both JavaScript and migration validation passed. This is still CI evidence, not a live deployment.

## Read-only D1 schema comparison — 2026-10-26

Cloudflare D1 `sqlite_master` was queried read-only for the three databases involved; every query reported `changed_db=false` and `rows_written=0`.

- D1 `fc2517cb-9543-4d7b-98f4-bcd5f3c013e7`, bound to the public deployed version 175, has `community_email_verification_tokens` and `community_members.email_verified_at`, but **does not** have `community_members.email_verification_required`.
- D1 `51d814c8-a3fc-4481-a5f1-60bc67617f3c`, bound to the uploaded preview-only version 176, has both `email_verified_at` and `email_verification_required`.
- D1 `c8b301f0-afcf-4f36-9b8e-8194c01bbbc8`, bound to isolated staging version 24, also has both columns.

This schema difference is a concrete release blocker: do not switch the public Worker to version 176 or point it at the preview D1 without a reviewed migration and data-preservation plan. The current production D1 was only inspected; no rows or schema were changed.


## Staging deployment checkpoint — 2026-10-26

- The dual-Worker route regression suite passed in GitLab pipeline [#115](https://gitlab.com/manhdungub/ai-thuc-chien-blog/-/pipelines/2988053582) on commit [`3a7763ce`](https://gitlab.com/manhdungub/ai-thuc-chien-blog/-/commit/3a7763ce89b846078cfaa2d7ab447fccd0ec64f9).
- Uploaded the CI-tested email-verification candidate from `recovery-snapshots/worker-email-verification-candidate.mjs` to the isolated Worker `ai-thuc-chien-blog-auth-app-preview` as version 25, ID `a8a5521d-3fc5-42b3-926f-2d5c427d7841`. The version upload used strict binding inheritance; Cloudflare confirmed `AI`, `COMMUNITY_EMAIL_RELAY_SECRET`, `COMMUNITY_EMAIL_RELAY_URL`, and `DB` remain attached, with `DB` pointing to isolated staging D1 `c8b301f0-afcf-4f36-9b8e-8194c01bbbc8`.
- Staging deployment `4fc74b54-e921-4bee-9aad-72cc92626874` now serves version 25 at 100% on the **staging Worker only**. The previous staging version 24 (`edf26044-6ea7-4790-8ee5-cfba4799f045`) remains the rollback target.
- Production was not modified. Its latest deployment remains version 175 (`3713d7c4-ca28-470a-b0bc-33c8e3712877`) at 100%. No production D1 schema/data changes were made.
- Verification limitation: direct HTTP probes from the Cloudflare API execution environment returned `403 Forbidden: requests to ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev are not allowed`. This response is generated by the tool sandbox's outbound-request restriction, so it does **not** prove the Worker returned an application error. The deployment API confirms version 25 is serving staging traffic, but a fresh post-deployment HTTP smoke test has not yet been independently completed. Earlier successful E2E checks apply to the prior staging state/version and must not be reported as a fresh version-25 test.
- Next release gate: obtain an independent, non-metered HTTP check of staging `/__staging/status`, `/login`, `/register`, `/script.js`, `/styles.css`, and anonymous `/api/community/me`; do not run another registration flow or create test accounts. Only then continue reviewing production relay configuration and the final release/rollback plan.


## Follow-up: deployed-candidate schema compatibility audit — 2026-10-26

- Read-only Cloudflare D1 schema queries were run against production DB `fc2517cb-9543-4d7b-98f4-bcd5f3c013e7`, isolated staging DB `c8b301f0-afcf-4f36-9b8e-8194c01bbbc8`, and preview-only DB `51d814c8-a3fc-4481-a5f1-60bc67617f3c`. The queries selected table definitions only and made no data or schema changes.
- The current GitLab candidate `worker-email-verification-candidate.mjs` (the source used for staging version 25) contains **no** reference to `email_verification_required`. Its referenced community tables are `community_members`, `community_messages`, `community_rate_limits`, `community_sessions`, and `community_email_verification_tokens`; all five exist in the active production D1. Production `community_members` has `email_verified_at`, and the token table has the columns used by the current candidate.
- Therefore the missing `email_verification_required` column is **not a schema blocker for this current candidate**. That warning still applies to older preview-only version 176, which is bound to the preview D1; do not substitute version 176 for the current candidate.
- Deployment metadata was checked separately from the Worker `/settings` view: production remains version 175 at 100% and its active version binding points to production D1 `fc2517cb-9543-4d7b-98f4-bcd5f3c013e7`; staging remains version 25 at 100% and points to staging D1 `c8b301f0-afcf-4f36-9b8e-8194c01bbbc8`. The script settings view reflects the latest uploaded preview configuration and must not be mistaken for the active production deployment's bindings.
- The current release blockers are now narrower: a fresh independent HTTP smoke test of staging version 25 is still outstanding because outbound GETs from the execution sandbox are explicitly blocked, and the production relay URL differs from the staging relay URL. The relay deployments and their host allowlist must be verified before a production cutover. No production traffic, D1 schema, or D1 rows have been changed.


## Manual staging URL checks — user-confirmed, 2026-10-26

- User opened staging `/__staging/status` and confirmed JSON: `ok=true`, `environment=staging`, `database_ready=true`, `schema_ready=true`, `email_sending_enabled=true`, `registration_ready=true`.
- User opened `/login?from=menu` and `/register?campaign=smoke`. Final browser URLs were the homepage with the original parameters and `#cong-dong`.
- This URL normalization is expected in the current frontend script: it reads `mode=login|register`, calls `setAuthMode(initialAuthMode)`, then removes the `mode` parameter using `history.replaceState`. The URL alone does not establish which form was visually shown; the visible form should still be confirmed if this was not obvious during the check.
- **Production release remains blocked on email relay allowlist verification.** The Apps Script `doPost` explicitly rejects verification links unless their hostname is present in `COMMUNITY_EMAIL_ALLOWED_HOSTS`. The currently documented Script Properties allowlist was restricted to the staging hostname; production verification links use `ai-thuc-chien-blog.manhdungub.workers.dev`. Before any production cutover, verify/update the allowlist to include the exact production hostname as well as staging, without reading or changing the shared secret. No such property change was made during this check.
- No registration was submitted during these URL checks, no new test account was created, and no production Worker/D1/traffic change was made.

## Follow-up verification after pipeline #118 — 2026-10-26

- Pipeline [#118](https://gitlab.com/manhdungub/ai-thuc-chien-blog/-/pipelines/2988451711) completed with status `success` at commit `a838901d69e429227cf507a804886441c0287f06`. Both `javascript-validation` and `migration-validation` succeeded. This validates the automated checks, not production email delivery.
- Cloudflare deployment records confirm production Worker `ai-thuc-chien-blog` remains at 100% traffic on version 175 (`3713d7c4-ca28-470a-b0bc-33c8e3712877`) with production D1 `fc2517cb-9543-4d7b-98f4-bcd5f3c013e7`. Staging remains at 100% traffic on version 25 (`a8a5521d-3fc5-42b3-926f-2d5c427d7841`) with isolated D1 `c8b301f0-afcf-4f36-9b8e-8194c01bbbc8`. No deployment, binding, secret, or database change was made during this read-only check.
- In the deployed version metadata, both Workers have the relay secret binding (its value was not read) and a relay URL at `script.google.com`; their URL paths identify different web-app deployment IDs. That difference alone does not establish whether the two URLs are deployments of the same Apps Script project.
- The checked-in relay source parses `COMMUNITY_EMAIL_ALLOWED_HOSTS` as a comma-separated, case-insensitive host allowlist and rejects a verification URL if its exact host is absent. The previously verified property value was staging-only. The exact production hostname to allow is `ai-thuc-chien-blog.manhdungub.workers.dev`; staging hostname is `ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev`.
- **Remaining release gate:** verify in Apps Script's **Deploy → Manage deployments** which project owns the production relay URL. If both relay URLs are deployments of the same project, add the production hostname to that project's existing `COMMUNITY_EMAIL_ALLOWED_HOSTS` value while preserving the staging hostname and any other existing entries. If they belong to separate projects, update the allowlist in the production relay project's Script Properties as well. Do not alter `COMMUNITY_EMAIL_RELAY_SECRET`. Then retest the staging flow before any production cutover. No allowlist change or production cutover has been performed.


## Fresh read-only HTTP and relay probe — 2026-10-26

- After staging version 25 was confirmed deployed, a fresh independent HTTP smoke test was completed through a separate outbound-capable environment. Staging `/__staging/status` returned HTTP 200 with `ok=true`, `environment=staging`, and all four readiness flags true: database, schema, email sending, and registration.
- Staging `/login` and `/register` each returned HTTP 302 to the matching `/?mode=login#cong-dong` / `/?mode=register#cong-dong`. `/script.js`, `/styles.css`, and anonymous `/api/community/me` returned HTTP 200; anonymous `me` returned `{"member":null}`. No account was created and no D1 write was performed.
- Production read-only GET checks returned HTTP 200 for `/` and `/api/community/me`, but `/login` and `/register` still return HTTP 302 to the homepage without the matching mode parameter. The production route bug is therefore independently reproduced and remains a release blocker.
- The active production relay URL's GET request returned an Apps Script HTML error, `Script function not found: doGet`. The exported production project has no `doGet`; therefore this GET response is consistent with the source and is **not** evidence that `doPost` is broken. The staging relay GET returned HTTP 200 JSON `{"ok":true,"service":"AI_THUC_CHIEN_EMAIL_RELAY"}`.
- A safe POST probe with an empty JSON object to both active relay URLs returned HTTP 200 JSON `{"ok":false,"code":"UNAUTHORIZED"}`. This confirms both endpoints execute `doPost` and the request was rejected before message validation/sending. It does **not** prove production email delivery or that the production allowlist accepts a real verification URL.
- User confirmed that production Script Properties `COMMUNITY_EMAIL_ALLOWED_HOSTS` contains `ai-thuc-chien-blog.manhdungub.workers.dev`. The property value was not independently read. The shared secret was never read, sent, or changed. No email was sent by these probes.
- A read-only export of the production Apps Script project shows `doPost` declarations in both `Code` and `appsscript.js`; both source entries appear to implement the same relay checks. This duplication should be reconciled in a controlled branch/release review, not edited live during this verification. The production project manifest timezone remains `America/New_York`; the repository manifest uses `Asia/Ho_Chi_Minh`.
- Cloudflare deployment metadata was rechecked: production remains 100% on Worker version 175 and production D1 `fc2517cb-9543-4d7b-98f4-bcd5f3c013e7`; staging remains 100% on version 25 and isolated staging D1 `c8b301f0-afcf-4f36-9b8e-8194c01bbbc8`. No deployment, property, secret, DNS, or database changes were made.

## Updated decision

**NO-GO for production cutover.** Staging version 25 now has fresh HTTP smoke-test evidence and remains ready. The relay's non-delivery probes confirm endpoint execution only, not successful production mail delivery. Production's friendly login/register routing remains broken, and a real production-host verification email has not been proven. Do not switch production traffic or run migrations until these issues are resolved through a separately reviewed, staging-first release.
## Live active Worker source comparison — 2026-10-26

A read-only Cloudflare API comparison was made against the actual Worker script content for the public Worker and isolated staging Worker. This inspects deployed script content, not only repository files or the latest uploaded preview version.

- Public Worker script content was returned successfully (HTTP 200) from the Cloudflare API. Its bundled source has zero occurrences of the explicit `pathname === "/login"` / `pathname === "/register"` branch and zero occurrences of the frontend `requestedMode` / `setAuthMode(initialAuthMode)` logic.
- Staging Worker script content was returned successfully (HTTP 200). It contains the explicit GET/HEAD handler for both auth routes, redirects to `/`, preserves existing query parameters, sets `mode` from the route, sets `#cong-dong`, and contains the frontend code that reads `mode` and selects the initial auth form.
- This source-level difference matches the live HTTP observations: public `/login` and `/register` redirect without the matching mode, while staging returns the matching mode redirect. The cause is therefore confirmed in the currently deployed public Worker code, rather than merely inferred from repository status.
- Public deployment metadata was rechecked: deployment `51587fe9-266d-4c54-a04d-7441de83b445` assigns 100% traffic to version 175 (`3713d7c4-ca28-470a-b0bc-33c8e3712877`). The read was inspection-only; no Worker version, traffic allocation, D1, secret, relay property, or DNS record was changed.
- The staging Worker source currently serving traffic is version 25 (`a8a5521d-3fc5-42b3-926f-2d5c427d7841`), at 100% staging traffic. This is separate from public production.
- The production Apps Script relay remains unproven for successful real email delivery. Empty-JSON POST probes return `UNAUTHORIZED`, which proves the handler executes but does not exercise authenticated validation or mail delivery. The production hostname is now user-confirmed as present in `COMMUNITY_EMAIL_ALLOWED_HOSTS`; the shared secret was not read or changed.

## Current release decision

**NO-GO for production.** The route defect and its source-level cause are now confirmed. Next safe work is to add or strengthen a branch-only regression test that compares expected auth-route behavior and review the relay's duplicate source declarations in a controlled copy. A production cutover still requires a separate release plan, verified relay delivery on the production hostname, and a rollback target.
## Follow-up: combined relay allowlist regression coverage — 2026-10-26

- Added a branch-only mocked Apps Script relay test proving a comma-separated `COMMUNITY_EMAIL_ALLOWED_HOSTS` value can approve the exact staging hostname and exact production hostname at the same time.
- The test exercises the existing validation path with a synthetic token, test-only recipient domain, mocked `MailApp`, and fake secret. It does not call the live relay, send a real email, read Script Properties, or expose a secret.
- Pipeline [#122](https://gitlab.com/manhdungub/ai-thuc-chien-blog/-/pipelines/2988557444) passed on commit [`5934202f`](https://gitlab.com/manhdungub/ai-thuc-chien-blog/-/commit/5934202f66f38fedc47a48874cf3b89076531459). Both `javascript-validation` and `migration-validation` passed.
- This strengthens unit-level evidence only. The production Apps Script property was user-confirmed to contain the production hostname, but no independent readback of the full allowlist was performed. Successful real email delivery through the active production relay remains unproven.

## Current deployment gate — keep production unchanged

Before a production cutover, the release evidence must include all of the following:

1. Review the final Worker candidate and confirm it uses the currently active production D1 and the active production relay URL/secret bindings; never deploy preview-only version 176.
2. Preserve a rollback path to deployed public version 175 (`3713d7c4-ca28-470a-b0bc-33c8e3712877`) and verify the rollback deployment procedure before making traffic changes.
3. Prove production relay delivery and the confirmation flow on the production hostname without exposing the shared secret or leaving disposable records behind.
4. Confirm the candidate's route, verification-token expiry/replay, resend-throttling, login gating, and post-verification login behavior; distinguish mock/CI evidence from live checks.
5. Recheck active Worker deployment and D1 bindings immediately before and after any release. A successful upload or CI pipeline alone is not evidence of a production deployment.

Until these gates are met, the release decision remains **NO-GO**. No production resources were changed in this follow-up.
## Critical production schema incompatibility confirmed — 2026-10-26

Read-only inspection of the active production Worker source and D1 schema found a concrete incompatibility in deployed version 175:

- Active public version 175 inserts `email_verification_required` during registration and selects that column during login and verification.
- A fresh `PRAGMA table_info(community_members)` on active production D1 `fc2517cb-9543-4d7b-98f4-bcd5f3c013e7` returned these columns: `id`, `username`, `email`, `display_name`, `password_salt`, `password_hash`, `created_at`, and `email_verified_at`. It does **not** contain `email_verification_required`.
- Non-mutating SQLite `EXPLAIN` preflight against production D1 failed for the version-175 registration INSERT with `table community_members has no column named email_verification_required`, and failed for its login SELECT with `no such column: email_verification_required`. These are SQL preparation checks; no registration, INSERT, or UPDATE was run.
- The same read-only preflight succeeded for the candidate's compatible INSERT/SELECT statements using the existing columns. This supports using the current branch candidate rather than deploying preview-only version 176 or applying an unreviewed reconstructed migration.
- A count-only query reported zero rows in production `community_members` at the time of the check; no member identifiers or emails were read. The query returned `changed_db=false` and `rows_written=0`.
- The staging `community_members` schema includes `email_verification_required`; its count-only query returned one already verified row at the time of this audit. That row was not inspected or modified; do not delete it without identifying its owner and purpose.

### Effect and required response

Production version 175's registration and login SQL paths are expected to fail against its currently bound D1 schema. The public homepage and anonymous community endpoint still returned HTTP 200, but that does not prove registration/login health. The active `/login` and `/register` redirects also fail to set/override the correct `mode`; the route matrix reconfirmed this while staging correctly sets the matching mode and preserves unrelated query parameters.

**Production remains NO-GO for cutover until the new candidate passes the production relay gate.** The candidate avoids the missing `email_verification_required` column, and its insert/select SQL preflights against production D1 succeeded. The active production relay has only been confirmed to execute `doPost` and reject unauthenticated requests; a real confirmation email through the active production relay has not yet been proven. No Worker, deployment, traffic percentage, D1 schema/data, relay property, secret, or DNS was changed by these checks.
## Production Worker / relay verification-link contract mismatch — 2026-10-26

A further read-only source comparison shows that adding the missing production column alone is not a sufficient repair:

- Active public Worker version 175 constructs its verification link as `/api/community/verify?token=...` and does not add the candidate's `#cong-dong` fragment.
- The reviewed relay handler contract in `email-relay/Code.gs` accepts only a root URL of the form `https://<approved-host>/?verify=<token>#cong-dong`. The candidate Worker constructs this matching format.
- Therefore version 175's link format does not match the reviewed relay validation contract. A schema-only hotfix would leave another registration failure path in place and should not be used as a partial production repair.
- This is source-contract evidence, not proof that the active production Web App deployment runs byte-for-byte the checked-in relay source; the active relay's exact deployment version is still not independently established. The live unauthorized POST probe proves handler execution only.

**Repair direction:** release the branch candidate as a single reviewed unit (route handling + verification API + relay-compatible URL + compatible production D1 queries), with explicit production binding reconciliation and rollback to version 175. Do not apply the reconstructed migration or deploy preview-only version 176.
## Regression tests after production mismatch discovery — 2026-10-26

- Commit [`605b9e65`](https://gitlab.com/manhdungub/ai-thuc-chien-blog/-/commit/605b9e654656472076fc342d8524189e600e4348) adds regression coverage that the current candidate does not reference the absent production `email_verification_required` column and constructs the root `/?verify=...#cong-dong` link format required by the reviewed relay contract.
- The relay test now explicitly rejects the legacy version-175 `/api/community/verify?token=...` link shape and confirms a comma-separated allowlist can approve both exact staging and production hostnames. These run with mocked Google services and do not send an email.
- GitLab pipeline [#126](https://gitlab.com/manhdungub/ai-thuc-chien-blog/-/pipelines/2988597795) succeeded; both JavaScript and migration validation passed.
- Final read-only Cloudflare deployment check confirms public production is still on version 175 at 100% traffic, and staging is still on version 25 at 100% traffic. Production D1 schema/data, secrets, relay properties, DNS, and traffic allocation were not changed.
## User-authorized live staging relay smoke test — 2026-10-26

- A single real registration request was sent to the isolated staging Worker using the email address supplied by the user for testing. The API returned HTTP 202 with `pendingVerification: true`, which means the staging Worker accepted the request and its configured staging relay returned success.
- This is a real staging relay request, not a mocked CI test. The recipient's inbox/spam delivery has not yet been independently verified in this session. No production Worker, production relay, production D1, production secrets, DNS, or production traffic was touched.
- A pending test member and a 30-minute verification token were created in staging for this smoke test. The test username is held in the operational session, not written here; clean up only that exact test member and its token after delivery verification or expiry, without deleting unrelated staging data.
- This does not clear the production release gate. The active production relay still needs its own authenticated end-to-end delivery proof, which cannot be inferred from staging success.

## Follow-up: user-confirmed staging activation and exact test cleanup — 2026-10-26

- The user confirmed that the staging verification email was clicked.
- A read-only query of the isolated staging D1 found that the exact disposable test member had a non-null `email_verified_at` timestamp. The verification-token table contained zero tokens for that member, consistent with one-time token consumption.
- Removed only that exact disposable member from staging, guarded by its recorded member ID, the unique test username, and a non-null verification timestamp. The database reported one member row affected. No other member row was targeted.
- Follow-up read-only queries confirmed zero matching member rows and zero associated verification-token rows. The test email address and account identifier are intentionally not recorded here.
- The change was limited to isolated staging D1 `c8b301f0-afcf-4f36-9b8e-8194c01bbbc8`. Production Worker, production D1, production relay, secrets, DNS, and traffic allocation were not changed.
- Latest branch pipeline [#128](https://gitlab.com/manhdungub/ai-thuc-chien-blog/-/pipelines/2988629114) passed on commit [`e90c0403`](https://gitlab.com/manhdungub/ai-thuc-chien-blog/-/commit/e90c0403c25ce5365de49fde4d16189e2e26b40b). Both `javascript-validation` and `migration-validation` passed.
- This closes the one-time staging confirmation test. It does **not** prove successful delivery through the active production relay or repair the active production Worker. The production release decision remains **NO-GO** until the production relay, current production routing/verification path, active D1 compatibility, and rollback procedure are reconciled and tested.

## Follow-up: full candidate SQL preparation against active production D1 — 2026-10-26

- Extracted the 20 unique SQL statements used by the current email-verification candidate, excluding the separately inspected read-only `PRAGMA table_info` check.
- Ran each as SQLite `EXPLAIN` against active production D1 `fc2517cb-9543-4d7b-98f4-bcd5f3c013e7`, supplying null placeholder values solely for query preparation. **All 20/20 prepared successfully.**
- Every response reported `changed_db=false` and `rows_written=0`. No INSERT, UPDATE, DELETE, schema migration, or production test account was executed by this preflight.
- This expands the earlier compatibility check beyond the registration/login statements to the candidate's verification-token, session, message, rate-limit, and table-inspection SQL. It supports schema compatibility of the candidate with the current production D1; it does not prove a successful runtime transaction or production mail delivery.
- Active production remains on version 175 at 100% traffic; isolated staging remains on version 25 at 100%. The candidate has not been deployed to production.
- Decision remains **NO-GO for production cutover** until a controlled proof of the active production relay's authenticated delivery is available, followed by a reviewed release with the documented rollback path.
