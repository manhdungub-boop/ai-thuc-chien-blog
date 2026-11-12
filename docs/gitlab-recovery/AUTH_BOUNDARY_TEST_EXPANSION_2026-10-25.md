# Auth boundary test expansion — 2026-10-25

## Work completed
- Added `scripts/test-worker-email-verification-boundaries.mjs`.
- Wired the test into the non-deploying `javascript-validation` job in `.gitlab-ci.yml`.
- Test cases exercise the candidate Worker with a fake DB that throws on any unexpected database call. They verify:
  1. Disallowed Origin is rejected before DB access and receives no CORS allow-origin header.
  2. Allowed CORS preflight returns explicit allow-origin/methods and non-cacheable response.
  3. Malformed verification token is rejected before token lookup and has safe `nosniff` and `no-store` headers.
  4. Oversized JSON request is rejected before database access.
  5. Missing D1 binding fails closed with non-cacheable response.
- No real email, live D1, secret, or deployed Worker was used.

## CI evidence
- Initial pipeline #55 failed because the test expected Cache-Control to equal exactly `no-store`, while the Worker correctly emitted `no-store, max-age=0`. This was a test expectation error, not a production code change.
- Updated the assertions to check for the `no-store` directive rather than an exact header string.
- Pipeline #56 then passed: both `javascript-validation` and `migration-validation` succeeded.
- Pipeline #56 commit: `22e86a6ca96718c38db42934731f5bc1c4b47287`.
- [Pipeline #56](https://gitlab.com/manhdungub/ai-thuc-chien-blog/-/pipelines/2985129789)

## Important limitation
This adds request-boundary tests but does not prove browser compatibility, real Apps Script deployment, actual email delivery, or production integration. The Worker/D1 provenance mismatch, relay setup, authoritative migration, and production recovery gates remain unresolved.

## Safety
No production Worker, D1 data/schema, DNS, or secrets were changed. No email was sent and no deployment job was added.
