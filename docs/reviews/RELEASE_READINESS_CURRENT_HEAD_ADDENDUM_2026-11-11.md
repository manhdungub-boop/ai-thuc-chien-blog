# Release readiness — current-head addendum (11/11/2026)

## Authority and scope

This addendum supersedes only the stale commit identifiers and current-state rows in `RELEASE_READINESS_AUDIT_2026-11-11.md`. It records a later read-only recheck of PR #96 and its exact current HEAD. It does not authorize merge, deployment, migration, secret changes, DNS changes, or Production operations.

Repository: `manhdungub-boop/ai-thuc-chien-blog`

## Current PR stack snapshot

| PR | State | Head | Base | Mergeability |
|---|---|---|---|---|
| #91 | Open / Draft | `979b038829db0637098972b0f1dd44c26452dad8` | `main` | `blocked` |
| #95 | Open / Draft | `e7d5b3f34d6b1e4b1aedb7ed91123111691509eb` | `fix/release-blockers-20261109` | `clean` |
| #96 | Open / Draft | `28c3561a5fb88971374648c71e6f85fd8975a273` | `security/pin-verified-actions-20261110` | `clean` |

These PRs remain stacked. Do not change bases or merge individual stack members out of order. PR #96 has no submitted review records and no inline review threads at this snapshot.

## Exact-head CI — PR #96

All three PR-triggered workflow runs associated with exact HEAD `28c3561a5fb88971374648c71e6f85fd8975a273` completed successfully:

- Static CI Quality Gate #43007152166 — success; validate job completed successfully.
- Staging Google OAuth integration #43007152193 — success.
- CodeQL Offline Security Analysis #43007152258 — success.

These results validate the automated checks represented by those workflows only. OAuth integration CI is not evidence of a live Google consent redirect, callback, token exchange, or persisted browser session. CodeQL is not an independent human security review.

## PR #91 review findings — downstream disposition

Five Codex inline comments remain attached to the older PR #91 review diff:

1. P1: branch-controlled Wrangler build hook could expose a production-capable token in the old deploy workflow.
2. P2: DNS validation/fetch time-of-check/time-of-use gap in the catalog URL checker.
3. P2: missing email-relay host allowlist defaulted to a Production hostname.
4. P2: password-login timing difference for unknown accounts.
5. P2: branch-deployed Preview code could access pre-existing Preview relay secrets.

PR #96 describes downstream changes for items 1–4: credential-free Auth Preview validation, socket-level DNS pinning and redirect revalidation, fail-closed relay allowlist, and dummy PBKDF2 work for unknown accounts. The current PR #96 description states that its Auth Preview workflow does not deploy PR code or expose Cloudflare/application secrets. These are downstream source changes, not a formal resolution of the old PR #91 comment threads.

Item 5 remains an investigation blocker: legacy Preview Worker secret provenance, active traffic, source/version ownership, and disposable credential isolation have not been established. Do not copy, compare, rotate, delete, redeploy, or broaden allowlists for legacy Preview resources.

## Remaining release blockers

- Stable Preview Worker does not have a verified dedicated relay-secret binding; live email E2E remains unverified.
- Live Google OAuth browser flow remains unverified; mock/integration CI is not equivalent.
- Cloudflare D1 metadata access remains blocked by missing `d1.read`; no D1 schema conclusion should be inferred from HTTP 401.
- Legacy Preview Worker provenance and secret isolation remain unresolved.
- No independent human security review of the exact final PR #96 HEAD is recorded.
- PR #91 remains mergeability-blocked and has five old inline findings; triage/resolution must be evidenced before stack completion.

## Safety record

This addendum was prepared from GitHub PR metadata, exact-head workflow-run metadata, review records, the existing audit, and source descriptions. No secret values were read. No Cloudflare resource was mutated. No Worker deployment, DNS change, D1 query/write/migration, external email, merge, or Production action was performed.

## Release decision

**BLOCKED — NOT APPROVED FOR MERGE OR PRODUCTION RELEASE.**

Re-open this gate only after the remaining Preview credential, live OAuth/email, D1 read-only evidence, legacy Worker provenance, PR #91 review triage, and independent security review blockers are closed with verifiable evidence on the final exact commit.


## Follow-up read-only Preview verification — later on 11/11/2026

This section supersedes the earlier D1 permission limitation recorded above.

- Cloudflare D1 metadata read now succeeded for Preview database UUID `51d814c8-a3fc-4481-a5f1-60bc67617f3c`: name `ai-thuc-chien-community-preview`, 9 tables reported by metadata.
- Read-only `SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY type, name` succeeded. It returned the expected community tables, `d1_migrations`, and SQLite internal tables. Cloudflare reported `rows_written=0` and `changed_db=false`.
- No member, message, token, or session records were selected. No schema mutation or migration was run.
- Read-only Worker secret metadata inventory for stable Preview returned exactly one secret binding: `GOOGLE_OAUTH_CLIENT_SECRET`. The relay secret binding `COMMUNITY_EMAIL_RELAY_SECRET` remains absent. No secret values were read.
- The D1 metadata/schema read gate is now **PASS for the inspected Preview scope**. This does not prove migration correctness, backup/restore, or full application E2E.
- Live email remains blocked by the missing Preview relay secret. Google OAuth is not yet proven end-to-end merely because a secret binding name exists; client ID, redirect configuration, consent/callback/token exchange and persisted session still require isolated live verification.

Safety: these were metadata and schema-only reads against the dedicated Preview D1. No Production D1, Worker, DNS, secrets, or user records were changed or read.
