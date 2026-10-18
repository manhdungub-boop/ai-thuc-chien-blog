# Release checklist — AI Thực Chiến

This checklist is the release gate for changes to the public site. A green CI run is necessary, but it does not by itself prove that the production deployment is healthy.

## 1. Before merging

- [ ] Confirm the pull request targets the intended default branch and contains only expected files.
- [ ] Read the diff for accidental secrets, tokens, private URLs, generated noise, and unrelated changes.
- [ ] Ensure all required GitHub Actions checks pass on the exact latest head commit.
- [ ] Confirm article quality: useful for the Vietnamese reader, original wording, clear steps, and no unsupported promises.
- [ ] Verify factual claims against primary or authoritative sources; mark uncertainty and date-sensitive claims.
- [ ] Check each changed article has a descriptive title, a unique meta description, one main H1, a canonical URL, valid structured data where used, and relevant source links.
- [ ] Confirm every article canonical appears exactly once in the generated sitemap and once in the RSS feed.
- [ ] Confirm internal links resolve and the homepage provides a discovery path to every published article.
- [ ] Confirm the Worker dry-run succeeds and route/security regression tests pass.

## 2. Production smoke test after an approved release

Run these checks against the actual production hostname, not only the preview or local build:

- [ ] Homepage returns HTTP 200 over HTTPS.
- [ ] A representative extensionless article URL returns the intended article, not a 404 or raw error.
- [ ] The matching .html asset behaves as intended and does not create duplicate-indexing problems.
- [ ] Sitemap XML returns 200 and contains the expected canonical URLs.
- [ ] RSS feed returns 200 and contains recent article titles and canonical links.
- [ ] Security headers are present on successful responses and error responses.
- [ ] Query strings survive article routing where relevant; non-GET/HEAD methods are not rewritten to article assets.
- [ ] Mobile layout, navigation, search, and copy-to-clipboard interactions work on a real phone.
- [ ] No accidental console errors, broken images, mixed content, or unexpected redirects are observed.

Record the date, tested URLs, status codes, and any failures. A browser that cannot access a URL is not evidence that the website is down; use another direct HTTP check before deciding.

## 3. Rollback readiness

- [ ] Identify the last known-good deployment/version before release.
- [ ] Know how to restore that version in the hosting dashboard.
- [ ] Do not delete or overwrite content while diagnosing an incident.
- [ ] If routing, availability, security headers, or key content fails, stop further rollout and restore the last known-good version.
- [ ] Re-run the production smoke test after rollback.

## 4. Search and measurement

- [ ] Verify ownership in Google Search Console.
- [ ] Submit the sitemap only after confirming it matches the production hostname.
- [ ] Monitor indexing, crawl errors, impressions, clicks, and queries; avoid interpreting early low-volume data as proof of failure.
- [ ] Track content updates and major technical releases so changes can be compared over time.

## Release decision

Release only when the automated checks pass, the change has been reviewed, production smoke tests can be performed, and an explicit release decision has been made. Never claim a change is live until the production URL has been checked.
