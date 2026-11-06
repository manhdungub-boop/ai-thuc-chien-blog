# GitLab → GitHub synchronization record

Updated: 2026-11-07

## Source and destination

- GitLab source branch: `staging/auth-worker-build`
- GitLab source commit: `e485019c9f7d9b819aece12afa2ae36c5350a1b3`
- GitHub integration branch: `sync/gitlab-completed-work-20261107`
- GitHub destination repository: `manhdungub-boop/ai-thuc-chien-blog`
- GitHub target for review: `main` (no merge or production release performed by this synchronization)

## Work consolidated into the GitHub integration branch

- Community email verification, Google OAuth staging integration, password reset, token expiry/replay protections, rate limits and current Worker API tests.
- AI Bank page and structured catalog (27 records), search/filter/sort/pagination UI, catalog governance and review material.
- 69 article pages, homepage and topic-library updates, four additional practice articles, source-backed privacy guide update, SEO feed/build updates and related illustrations/social assets.
- D1 diagnostic workflow correction and GitHub migration control plan.
- GitLab catalog review reports, editorial QA reports, draft articles and their SVG diagrams, social-login/staging notes and working-rule documentation.
- GitHub Actions gates for catalog validation, catalog UI contract, strict catalog/review-queue audit, article attribution, article diagrams, and 69-page browser smoke plus static artifact packaging.

## Test mapping

| GitLab validation | GitHub implementation |
|---|---|
| JavaScript and static validation | `.github/workflows/ci-quality.yml` and existing npm tests |
| Email verification and password reset runtime tests | `scripts/test_community_api.mjs`, `scripts/test_email_verification.mjs` |
| Google OAuth runtime/integration | `tests/staging-google-oidc-runtime.test.mjs`, `scripts/test_google_oauth_worker_integration.mjs` |
| AI catalog schema and duplicate checks | `scripts/validate-ai-tools-catalog.mjs`, `scripts/audit-ai-tools-catalog.mjs` |
| AI Bank UI/data contract | `scripts/test-ai-tools-catalog-ui.mjs` |
| Editorial author/copyright checks | `scripts/verify-article-attribution.mjs` |
| Per-article diagram accessibility/uniqueness | `scripts/verify-article-diagrams.mjs` |
| 69-article browser smoke and static bundle | `.github/workflows/editorial-release-readiness.yml` |
| Official catalog URL reachability | Manual-only `workflow_dispatch` workflow; does not block offline CI |

## Deliberately not copied into active GitHub runtime

The GitLab `site-snapshot/` tree is a historical static export. Its files differ from the current GitHub root implementation; 80 of 81 comparable files had different blob hashes. The GitHub content integration already contains the 69-page article set and AI Bank, so the older snapshot was not allowed to overwrite current files.

The following GitLab-specific or historical test assets were not wired into active GitHub CI because they target the older `recovery-snapshots/worker-email-verification-candidate.mjs`, `staging-entrypoint.mjs`, `site-snapshot/`, `.gitlab-ci.yml`, or old Wrangler configurations:

- Legacy Worker-only password-reset, social-auth and email-verification scripts.
- Old staging/content-preview Worker routing tests and deployment dry-runs.
- The GitLab release-safety validator that parses `.gitlab-ci.yml`.
- Reconstructed legacy migration tests whose migration filenames/schema do not match the current GitHub migration chain.

Their security intent is represented by tests against the current GitHub Worker, current D1 migrations, and current Preview workflows. They must not be run against Production.

## Evidence and release boundary

- The GitLab latest branch pipeline at the source commit was reported as `running` with source `external`; a related merge-request pipeline was `failed`. GitLab's pipeline SUCCESS on older commits is not treated as proof that every manual or allowed-to-fail job passed.
- GitHub CI must run against the final integration commit. A test is complete only after its corresponding GitHub run is green.
- No Production Worker, Production D1, DNS, secrets, live user records, or public deployment was changed.
- The integration branch is for review and CI only. Merge to `main`, D1 migration, Worker deployment, and Production promotion remain separate release decisions.
