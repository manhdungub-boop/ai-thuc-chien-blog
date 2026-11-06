# GitHub migration control plan — 2026-11-06

## Decision

GitHub is the sole source-control and CI platform for ongoing project work. New development, review, and automated validation must use GitHub branches, Pull Requests, and GitHub Actions. Do not rely on GitLab pipelines or quota.

This document records a verified migration audit. It does not authorize a merge, deployment, production change, D1 write, DNS change, or secret rotation.

## Verified repository state

- The GitHub `main` branch is commit `61c53cb8b2c74c69dbbe5afc114c83592bf43c67`.
- At the time of this audit, `main` contains 65 HTML article files, 12 GitHub workflow files, `worker.mjs`, Wrangler configuration, `package.json`, migrations, and existing test scripts.
- The isolated content snapshot branch `ci-mirror/mr-129-38db960` contains 69 HTML article files, `data/ai-tools.json`, and a static-snapshot validation workflow. Its validation run `42163284306` completed successfully.
- The snapshot branch is one commit ahead of `main`, but its diff removes the existing 12 GitHub workflows, Worker runtime, Wrangler configuration, migrations, package manifest, and many test scripts. It is therefore not safe to merge wholesale.
- The snapshot's successful validation covers static-content integrity and local packaging only. It is not a complete Worker/authentication E2E test and is not a deployment check.
- The separate OAuth harness PR #72 has successful mock-focused CI evidence. It remains an isolated test harness, not a full repository migration or proof of live OAuth E2E.

## Safe migration strategy

1. Keep `main` intact as the baseline until a complete GitHub-native candidate passes review.
2. Bring in snapshot content selectively: article pages, library/catalogue data, illustrations, and other static assets. Preserve existing Worker runtime, Wrangler configuration, migrations, security controls, and CI workflows unless a separately reviewed change proves a replacement is safe.
3. Reconcile article count, sitemap, RSS, canonical URLs, homepage discovery, attribution, author metadata, AI tools catalogue schema, and duplicate slugs.
4. Integrate OAuth/authentication changes as separate reviewed commits and retain the mock-only test boundary.
5. Require GitHub Actions checks to pass on the exact candidate commit before considering a merge.
6. After merge, validate Staging separately. Production release remains a separate explicit approval.

## Mandatory safety constraints

- No writes to real D1 in mock/simulated testing.
- No production deployment, Worker configuration change, DNS change, secret change, migration execution, or destructive operation without separate explicit approval.
- No paid CI or paid plan upgrades.
- Do not merge PRs automatically.
- Report checks as PASS, FAIL, SKIPPED, or NOT RUN; never describe skipped live checks as E2E success.

## Current next work

Build a GitHub-native integration candidate from the existing GitHub baseline. Selectively reconcile the 69-article snapshot and OAuth test harness without replacing the current runtime or CI. Keep the work in Pull Requests until all required checks are green.
