# Live preview verification — 2026-10-25 (latest)

## Isolated Cloudflare preview
- The CI-passed candidate is deployed only to `ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev`; it uses the isolated D1 database `c8b301f0-afcf-4f36-9b8e-8194c01bbbc8` and an AI binding.
- A preview-only `/script.js` route serves the patched frontend from the staging candidate. This avoids changing the live Pages copy while explicitly allowing the preview hostname to use the community UI.
- Read-only public fetches verified: homepage loads; `/login` redirects to `/?mode=login#cong-dong`; `/register` redirects to `/?mode=register#cong-dong`; `/script.js` contains the preview hostname; `/styles.css` loads; an article route loads; `/api/community/me` returns `{"member":null}` for an anonymous visitor.
- The isolated D1 schema contains the email-verification token table and the required member fields. Read-only member count is 0; no account was created.
- The candidate passed local runtime tests with in-memory D1 and a fake relay: 20/20 assertions passed, including login gating, one-time/expiry checks, resend behavior, and fail-closed behavior when email relay configuration is missing. No real email was sent.
- GitLab pipeline #37 passed JavaScript and migration validation for commit `a255e50e93213ef3ac62fb460645ac52fd5e04da`.


## Staging diagnostics — 2026-10-25
- Added `GET /__staging/status`, gated to the exact isolated Worker hostname. It reports only boolean database/schema/email readiness values, never the email URL, shared secret, or member data.
- The endpoint uses read-only `sqlite_master` and `PRAGMA table_info` queries; it does not create accounts, mutate D1 rows, or call the mail relay.
- `registration_ready` stays false until D1 binding/schema and the valid Apps Script `/exec` URL plus a 32+ character secret are present. The preview binding remains intentionally without relay values while the Apps Script Web App is not deployed.


## Latest staging deployment — 2026-10-25
- Uploaded commit `3ed88e96f4c8210f9d131edb4b5a708046fb36ad` to the isolated preview Worker only. Cloudflare API returned HTTP 200; deployed Worker tag `12f82b387a494b3e9f53bb3ee55244c7`, deployment ID `dc944019ec744daea7da5ef9aea15a3e`.
- Read-only live checks verified `GET /__staging/status` returns `ok=true`, `database_ready=true`, `schema_ready=true`, `email_sending_enabled=false`, `registration_ready=false`; `GET /robots.txt` returns `User-agent: *` / `Disallow: /`; `/login` and `/register` still redirect to the correct mode; `/script.js` is served from the preview Worker.
- Re-ran the runtime suite against the exact candidate after the SEO patch: Node syntax check passed and all 20/20 in-memory D1/fake-relay assertions passed. No real email, account creation, or production DB write occurred.
- The preview Worker source applies `X-Robots-Tag: noindex, nofollow, noarchive` and `Cache-Control: no-store` only for the exact staging hostname. The live smoke-test fetch tool does not expose response headers, so the header value is confirmed in the deployed source but not independently observed in a response header by that tool.
- Pipeline `2985037688` for this change passed both JavaScript validation and migration validation.


## Release-readiness audit — 2026-10-25

### Read-only findings
- The public Worker hostname still sends `/login` and `/register` to the homepage without the `mode=login|register` query. This remains an outstanding user-facing bug; production was not changed.
- The Worker named `ai-thuc-chien-blog` has a `DB` binding to the database named `ai-thuc-chien-community-preview`, not the separately named `ai-thuc-chien-community` database. Do not switch that binding blindly: the currently bound database has the `email_verification_required` column while the separately named community database does not. The candidate's registration readiness check requires that column. A safe release needs a reviewed migration plan and backup before any production DB or binding change.
- The older Worker `ai-thuc-chien-blog-auth-preview` has a misspelled secret binding (`COMMUNITY_EMAIL_RELAY_SECR`) and no `COMMUNITY_EMAIL_RELAY_URL` binding. Do not use this Worker for email-verification acceptance testing without repairing it on staging.
- The current isolated Worker `ai-thuc-chien-blog-auth-app-preview` is the clean staging target; it uses the isolated `ai-thuc-chien-blog-community-preview` D1 and intentionally has no relay bindings. Its read-only status endpoint correctly reports `registration_ready=false`.
- The Google Apps Script staging project source was exported and inspected. It checks `COMMUNITY_EMAIL_RELAY_SECRET` in Script Properties and validates the verification URL host before calling `MailApp.sendEmail`. Its manifest specifies anonymous Web App access, but export alone does not prove an active deployment or configured Script Properties. No real email was sent.
- The legacy relay URL was probed only with GET and an invalid POST payload. The invalid POST returned `UNAUTHORIZED`; the Cloudflare connector could not directly fetch the Apps Script host. These results do not prove end-to-end email delivery.

### Release decision
**Do not promote the auth candidate to production yet.** Required gates are: deploy/configure the Apps Script relay, set matching staging URL and secret bindings, deliver a real test email, verify the link and expiry/replay behavior end-to-end, reconcile the public Worker-to-D1 binding and production schema, and only then review a separately approved production rollout. No Worker, D1 rows, production binding, DNS, or production deployment was changed in this audit.

## Remaining release blockers
- The separate Google Apps Script staging project exists in Drive but has not been configured with Script Properties or deployed as a Web App. No real-inbox test has run.
- The preview Worker intentionally has no `COMMUNITY_EMAIL_RELAY_URL` or `COMMUNITY_EMAIL_RELAY_SECRET` binding. Registration must therefore fail closed; do not enable public registration yet.
- The live main Worker still redirects `/login` and `/register` to `/` without the matching `mode` parameter. Production was deliberately left unchanged pending email-relay setup and end-to-end validation.
- The recovered source is a candidate, not assumed to be an exact build of the original production Worker.

## Production safety
No production Worker, Pages deployment, production D1, DNS, or production secret was changed in this work. The only Worker uploaded was `ai-thuc-chien-blog-auth-app-preview`. All D1 queries in this verification were read-only; no registration POST was submitted and no email was sent.

---

# Recovery validation results — updated 2026-10-25

## Recovered source and static site
- Full original production Worker source recovered from Cloudflare's source map and cross-checked against the Drive recovery kit.
- Full static snapshot restored from Google Drive: 75 files, 68 HTML pages, 65 article pages, sitemap with 68 URLs.
- Node syntax checks passed for the three original Worker source files and the Apps Script relay source (checked as JavaScript).
- Static-site verifier passed: every sitemap URL maps to a recovered file and every local HTML href/src resolves.

## Email-verification candidate
- Candidate Worker and frontend are separate from the original production Worker snapshot.
- 23/23 candidate static assertions passed before the preview-host change.
- 20/20 runtime assertions passed using an in-memory D1 mock and fake relay, including direct `/login` and `/register` redirects, expiry, reuse, resend, login gating, and mail-failure cleanup.
- 11/11 Apps Script relay assertions passed with mocked Google services; no real email was sent.
- Migration smoke test passed on in-memory SQLite: existing accounts are grandfathered, new accounts remain unverified, token foreign-key cascade works, and required indexes exist.
- The candidate, frontend, and source verifier now target the dedicated isolated hostname `ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev`; this is a staging change only.
- CI includes source-level staging contract checks for explicit preview-host allowlisting, route-mode redirects, fail-closed email configuration, and absence of deployment commands.

## Live staging audit — 2026-10-25
- Main homepage and Pages backup returned HTTP 200 in read-only GET checks.
- On the main Worker, `/login` and `/register` currently return HTTP 302 to the homepage without a `mode=login` or `mode=register` query parameter. The route fix exists in the GitLab candidate but has not been verified on the public main Worker.
- Staging auth health endpoint returned HTTP 200 with `writes_enabled: true` and `email_sending_enabled: false`, while its schema-check endpoint returned `email_sending_enabled: true`. This runtime mismatch is a release blocker; do not treat schema readiness as proof that email sending works.
- Staging app preview settings currently show only a D1 binding and no email relay URL or shared-secret binding. The Apps Script relay safely returned `UNAUTHORIZED` for invalid/empty requests; no real email was sent.
- Read-only D1 inspection found 0 members in the auth preview database, 5 members in the separate community preview database, and 2 members in the production-named community database. Counts were read only; no member records were retrieved or changed.

## Remaining validation blockers
- The deployed staging Worker source/configuration must be reconciled with the repository snapshot; the live health and schema endpoints disagree.
- The Apps Script email relay has not been deployed/configured with a verified staging shared secret and allowed host; no real email was sent.
- The direct login/register route fix is not yet confirmed on the public main Worker.
- The recovered source is not assumed to be an exact build of the live production deployment.

## Production safety
No production Worker, Pages deployment, D1 data, DNS record, or production secret was changed in this staging audit. The only live database mutation was an additive column on the isolated auth-preview D1; all row-count queries were read-only. All other behavior tests used in-memory mocks. No email was sent.
