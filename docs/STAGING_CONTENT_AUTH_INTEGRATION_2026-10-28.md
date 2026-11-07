# Staging content + authentication integration candidate

This branch intentionally combines the reviewed static snapshot with the existing isolated authentication Worker wrapper for staging QA only.

## What changed
- Replaced all 66 article HTML files and shared site resources with the reviewed \`content/weekly-reporting-static-release\` snapshot.
- Restored the 512x512 \`logo.svg\` and kept the 64x64 favicon.
- Removed the internal \`site-snapshot/RECOVERY-README.txt\` from the public asset directory.
- Updated \`staging-entrypoint.mjs\` to serve GET/HEAD static content directly from the configured \`ASSETS\` binding; route extensionless article URLs to their HTML assets; preserve legacy \`.html\` article 301 redirects; return a real 404 for unknown paths; and hide production sitemap/feed XML on staging.
- Authentication routes, \`/api/community/*\`, \`/api/chat\`, non-GET/HEAD requests and \`/__staging/*\` continue to the isolated auth Worker. Staging D1 binding remains \`ai-thuc-chien-blog-community-preview\`; no D1 ID, secrets, or environment variables were changed.

## Safety and QA
- Staging responses use \`noindex,nofollow,noarchive\`, no-store and security headers.
- \`robots.txt\` deliberately allows crawlers to observe the noindex response header; the sitemap is hidden.
- \`scripts/test-staging-content-routing.mjs\` uses a local mock \`ASSETS\` binding. Its database-less API test checks delegation and a safe 503 only. It performs no live requests or writes.
- GitLab CI runs local route tests and a Wrangler dry-run on this branch. It is not a production deployment or a real staging deployment.
- A historical Workers Builds branch-filter anomaly is documented in [MR !4](https://gitlab.com/manhdungub/ai-thuc-chien-blog/-/merge_requests/4). On 2026-10-28 the isolated staging Worker later showed a fresh active deployment after the reviewed 66-article integration commit; this confirms the content integration reached staging, not production. Continue using a reviewed MR rather than a direct push to the staging branch.
- The staging wrapper must rewrite structured-data logo references to the current staging host; production's canonical \`/logo.svg\` route remains a separate production issue. The read-only live staging smoke checks this behavior after the staging deployment becomes active.
- Production Worker, Pages, D1, DNS, secrets, email relay and production traffic are not changed by this candidate.
