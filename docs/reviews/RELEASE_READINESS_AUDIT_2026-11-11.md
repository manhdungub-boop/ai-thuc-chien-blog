# Hồ sơ kiểm toán release readiness — 11/11/2026

## Phạm vi và nguyên tắc

- Repository duy nhất: `manhdungub-boop/ai-thuc-chien-blog`.
- PR trọng tâm: #96, branch `security/release-readiness-hardening-20261110`.
- Snapshot được kiểm tra trước khi ghi hồ sơ: PR #91 HEAD `c5d17ab60f033ed9e7026522d28a7e2d100db12e`; PR #95 HEAD `d86938debc516490cdd3ac2e8fc0ae9ddbd1fc74`; PR #96 HEAD `08a0120b99090de7cf83d5a0d156f5321e42e6e3`.
- Chỉ kiểm tra metadata PR, commit, CI, review, source/config và hồ sơ hiện có. Không đọc/tiết lộ secret values; không thay đổi Production Worker, DNS, D1, dữ liệu người dùng; không chạy migration; không gửi email; không merge hoặc deploy Production.

## PR stack và CI exact-head

| PR | Branch HEAD | State | CI evidence |
|---|---|---|---|
| #91 | `c5d17ab60f033ed9e7026522d28a7e2d100db12e` | Open / Draft | Commit-associated PR runs: Static CI, Content Quality, Website Health, Editorial, OAuth integration all success |
| #95 | `d86938debc516490cdd3ac2e8fc0ae9ddbd1fc74` | Open / Draft | Prior audit records exact-head Static CI run 42862801181 success; no PR-triggered run returned by current commit-run lookup |
| #96 | `08a0120b99090de7cf83d5a0d156f5321e42e6e3` | Open / Draft | Static CI run 42874750505 success; CodeQL run 42874750506 success; Staging Google OAuth mock integration run 42874750585 success |

For PR #96 HEAD `08a0120`, the three returned runs all completed successfully. Static CI has one successful validate job; CodeQL has successful JavaScript/TypeScript, Python and Actions jobs; OAuth integration has one successful job. The credential-free Auth Preview workflow was not present in the commit-associated run listing for this exact HEAD, so it is not marked PASS here. The latest audit's older exact-head PASS records are not substituted for current HEAD evidence.

## Source-level security review at PR #96 HEAD

- `.github/workflows/deploy-auth-app-preview.yml`: workflow is manual-dispatch only, checks out the selected source with `persist-credentials: false`, has `contents: read`, and runs static/build/regression checks only. It contains no Cloudflare token, relay secret, Google OAuth secret, deploy command, D1 operation or DNS operation. This removes the earlier branch-controlled build-hook/secret exposure path from this workflow.
- `email-relay/Code.gs`: missing relay host allowlist now becomes an empty list; requests require a configured allowed host. The relay checks a minimum 32-character shared secret, validates recipient and verification URL, rejects extra body URLs and unsafe HTML actions, and does not log payload/recipient/token/secret.
- `scripts/check-ai-tools-links.mjs`: resolves public addresses and pins the selected address into the actual HTTP(S) socket lookup; every redirect hop is revalidated and each bounded retry re-resolves/re-pins. Private IPv4/IPv6 addresses are rejected by the shared address-safety helper.
- PR #96 description records dummy PBKDF2 for unknown accounts, fail-closed relay allowlist, DNS-pinned requests, credential-free Auth Preview validation and offline-only Workers Builds updater. These changes have exact-head Static CI/CodeQL evidence above.
- Production Worker workflow source requires manual dispatch from `main` and explicit boolean confirmation. Pages deployment has the same main-ref + explicit confirmation boundary. This source inspection is not authorization to deploy.
- `wrangler.jsonc` declares separate Production and Preview D1 UUIDs. Preview identity is statically pinned; live schema/metadata remains unverified due missing API scope.

## Preview Worker / credential boundary — still blocked

Read-only inventory already recorded in the prior audit was reconciled against the current source policy:

1. Stable `ai-thuc-chien-blog-auth-app-preview`: dedicated Preview D1 UUID `51d814c8-a3fc-4481-a5f1-60bc67617f3c`; no secret binding was present in the latest metadata inventory. Relay URL is plain text. No relay secret or Google OAuth client credential binding was present. This explains why live relay and Google OAuth cannot be exercised on this stable Worker.
2. Legacy `ai-thuc-chien-blog-auth-preview`: a truncated/unexpected secret binding name was returned (`COMMUNITY_EMAIL_RELAY_SECR`) and a separate D1 UUID. Correctness, value provenance and isolation are unverified.
3. Legacy `ai-thuc-chien-blog-auth-isolated-20261104`: metadata showed the expected relay secret binding name and a separate D1 UUID. The value, provenance, and proof that it is disposable and distinct from Production are unverified.
4. The legacy Workers have public workers.dev hostnames enabled. Their ownership, active traffic, source/version provenance and rollback requirements are unresolved.

No secret values were requested or read. Do not copy, compare, rotate, delete, redeploy, alter bindings, or add either legacy hostname to OAuth allowlists until ownership, traffic and an independently proven disposable Preview credential boundary are established. Do not broaden OAuth allowlists to arbitrary Preview hostnames.

## D1 metadata

- Cloudflare D1 metadata/detail requests for the known Preview/legacy/Production database identifiers returned HTTP 401 / authentication error under the connected token because `d1.read` is absent.
- This is a permission limitation, not evidence of a database/schema defect. No SQL query, migration, D1 write or production schema change was performed in this round.
- Required next evidence: owner-authorized read-only `d1.read` access scoped to the necessary Preview database(s), then inspect metadata/schema without granting `d1.write`. Production D1 remains out of scope.

## Live OAuth and email

- OAuth integration run 42874750585 is mock/integration CI only. It does not prove a real Google consent redirect, callback, token exchange or session on a live Preview Worker.
- Live Preview provider endpoint was previously observed as `google:false, facebook:false`; stable Preview metadata lacks Google OAuth client credential bindings.
- Live email delivery/reset E2E is not verified; stable Preview has no relay secret binding. No external email was sent.
- Required next evidence: separately provisioned disposable Preview-only Google OAuth client and relay secret through the approved secret-management path; verify exact stable Preview hostname only; use an isolated test account and test inbox; do not reveal values or use Production credentials.

## Independent security review

- PR #95 and #96 have no recorded review submissions or inline review threads.
- PR #91 retains five unresolved Codex inline findings on an older reviewed commit. Four have downstream mitigations in PR #96 (dummy PBKDF2, fail-closed relay allowlist, DNS-pinned requests, credential-free Preview workflow). The Preview secret-boundary finding remains an open investigation item; the credential-free workflow removes the direct exposure path from that workflow but does not prove legacy Worker secret provenance.
- Codex review service previously reported its usage limit was exhausted. CodeMouse account status was recorded as inactive. CodeQL and scoped source review are useful free checks but are not an independent human security review.
- Do not claim independent review PASS until a genuinely independent reviewer completes a fresh review of the exact final PR head. Use a no-cost provider/reviewer only; no trial, paid plan or payment setup.

## Release gate

| Gate | Status | Evidence / remaining action |
|---|---|---|
| Static CI on PR #96 HEAD `08a0120` | PASS | Run 42874750505 |
| CodeQL on PR #96 HEAD `08a0120` | PASS | Run 42874750506; three language/workflow jobs success |
| OAuth mock/integration on PR #96 HEAD `08a0120` | PASS | Run 42874750585; not live OAuth |
| Credential-free Auth Preview on exact HEAD | NOT VERIFIED | No exact-head run returned |
| Stable Preview relay secret | BLOCKED | No dedicated secret binding |
| Live Google OAuth | BLOCKED | No Preview client credentials; provider previously false |
| Live email E2E | BLOCKED | No relay secret binding; no test email sent |
| Preview D1 metadata/schema | BLOCKED | Missing `d1.read`; HTTP 401 |
| Legacy Preview Worker provenance | BLOCKED | Two secret-bearing legacy metadata records unresolved |
| Independent security review | BLOCKED | No independent review submissions |
| Production release authorization | NOT GRANTED | No merge/deploy/migration authorization in this audit |

## Actions taken in this audit round

- Re-read current PR #91/#95/#96 metadata, branch heads, base relationships, review submissions, inline review threads, comments, changed-file inventory and commit-associated CI.
- Inspected current PR #96 Preview validation workflow, relay allowlist implementation, DNS-pinned link checker, D1 diagnostic workflow, release-safety verifier, Worker configuration and Production deployment guards.
- Confirmed the exact-head CI conclusions listed above.
- No application code, workflow, secret, Worker, DNS, D1, account, real user data or Production resource was modified by the audit.

## Decision

**NOT READY FOR RELEASE.** Keep PR #96 Draft/open and do not merge or deploy Production. Continue only with read-only inspection, credential-free CI, isolated Preview work and separately authorized Preview-only credential provisioning. Re-run only checks affected by subsequent changes, and record every PASS against the exact commit SHA.
