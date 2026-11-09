# AI Tools Catalog — Engineering Follow-up
**Date:** 2026-10-31  
**Branch:** `staging/auth-worker-build`  
**Scope:** staging code and read-only repository audit only

## Changes committed
- Added `scripts/check-ai-tools-links.mjs`: sequential public-source link checker with a 10-second timeout, 1.2-second interval, HEAD request and small Range GET fallback. Redirects are checked manually and unsafe/non-public redirect targets are blocked.
- Extended `scripts/audit-ai-tools-catalog.mjs`: compares candidate IDs, normalized names, name/vendor pairs and exact official domains against the main catalog; also detects duplicate identities within the candidate queue.
- Tightened `scripts/validate-ai-tools-catalog.mjs` and the audit date check to reject impossible calendar dates, not only malformed date strings.
- Added opt-in CI jobs. Set `AI_CATALOG_VALIDATE=1` to run structural, UI-contract and duplicate checks. Set `AI_CATALOG_LINK_CHECK=1` separately to run public URL checks. Both are limited to the staging branch/MR and neither deploys nor writes to D1.
- Updated catalog governance with the script behavior and the distinction between URL reachability and product/pricing verification.

## Read-only data audit
| Metric | Result |
|---|---:|
| Main catalog records | 12 |
| Review candidates | 7 |
| Candidate-to-main exact ID/name/domain matches | 0 |
| Duplicate identities inside candidate queue | 0 |
| Invalid calendar dates in main catalog | 0 |
| Main records still requiring price/product review | 12 |
| Candidates marked `needs_review` | 7/7 |

The domain/name comparison was performed against the JSON files currently on the branch. Same-domain matches are treated as a review signal, not proof that two products are duplicates.

## Verification boundaries
- JavaScript syntax was parsed for all four catalog scripts in the current tool runtime. This is not a substitute for running `node --check` in Node 22.
- The data-level duplicate/date checks above were performed against the retrieved JSON content.
- GitLab CI was not run. The latest branch pipeline remains `skipped`; the new jobs are opt-in to avoid unexpectedly consuming CI quota.
- The public link checker was not executed, so this report makes no claim that any source URL is reachable or broken.
- No pricing, license, regional availability or product-feature claims were newly verified in this engineering pass.
- The latest Cloudflare preview deployment remains the 2026-10-29 deployment previously read from the API; these commits are not deployed to preview.

## Next actions
1. When GitLab CI quota is available, run a pipeline on this branch with `AI_CATALOG_VALIDATE=1`.
2. Run a separate pipeline with `AI_CATALOG_LINK_CHECK=1` to check public URLs at the configured low request rate.
3. Review the seven candidate records against vendor pricing, license and regional pages before importing any into the public catalog.
4. Do not merge, deploy, publish or modify production/D1 without separate approval.
