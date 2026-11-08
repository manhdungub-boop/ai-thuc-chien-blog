# AI Tools Catalog — Operating Model

## Goal
Maintain a searchable, extensible directory of hundreds or thousands of AI products. The catalog is data-driven; UI pages must not hard-code one HTML card per tool.

## Source of truth
- Seed catalog: `data/ai-tools.json` (canonical path in this repository).
- Schema/field contract: documented below and enforced by `scripts/validate-ai-tools-catalog.mjs`
- Public status: only records with `status=active` AND `verification_status=verified` may be presented as verified listings. `needs_review` is an editorial queue, not a verified claim.
- Automatic publishing: when a record has passed source, accuracy, deduplication, attribution, safety and catalog CI quality gates, it may be published publicly without another user confirmation. Records that have not passed every gate must remain unpublished or clearly marked as pending review; never promote an unverified price, limit, license or availability claim.
- Never infer that a tool is free merely because it has a free trial, open-source repository, or a free self-hosted edition.

## Record requirements
Each record has a stable lowercase `id`, display name, vendor, official website, one or more categories, pricing model/status, license, supported platforms, concise description, free-tier summary, official source URLs, last verification date, verification status, lifecycle status, and searchable tags.

### Allowed controlled values
- `pricing_model`: `free`, `freemium`, `paid`, `trial_or_credits`, `self_hosted_free_and_cloud_paid`, `unknown`
- `pricing_status`: `verified_free`, `verified_free_tier`, `limited_credits`, `paid_only`, `self_hosted_free`, `unknown`
- `verification_status`: `verified`, `needs_review`, `stale`, `disputed`
- `status`: `active`, `deprecated`, `closed`, `rejected`
- categories are extensible slugs, initially: assistant, writing, research, search, image, design, video, audio, coding, developer, automation, agents, integration, documents, presentation, data, marketing, education, business, productivity, security, translation, voice, 3d, other.

## Editorial and update workflow
1. Discover candidates from official launch pages, vendor directories, reputable public indexes, product documentation and reviewed community submissions.
2. Normalize vendor + official domain + product identity; detect duplicate products and aliases before insertion.
3. Verify the official website, core use case, pricing tier, geographic/usage limitations, license, and relevant privacy/data terms.
4. Save official source URLs and `last_verified`; never use search snippets alone as evidence.
5. New or uncertain records enter `needs_review`; do not publish as verified until a human/editorial check passes. Once all required editorial and automated quality gates pass, publish the verified record automatically under the project publishing rule.
6. Recheck pricing and product status at least every 30 days; prioritize rapidly changing pricing pages and high-traffic listings weekly.
7. Check outbound links weekly. If a source cannot be reached or a price cannot be verified, mark `stale` or `unknown`; do not silently preserve old pricing as current.
8. Retain change history in Git commits. Remove from public active results only after confirming a product is closed, deprecated, or unsafe/misleading.
9. Do not scrape behind logins, bypass robots/rate limits, copy proprietary descriptions, or use unlicensed logos. Prefer official APIs/feeds and public pages; obey terms.
10. Monetization/affiliate links, if added later, must be clearly labeled and must not influence ranking.

## Scale and user experience
- Search by name, vendor, function, tags, and user need.
- Filter by category, pricing, platform, license, and verification status.
- Sort by recently verified, name, and relevance; paginate or progressively load results.
- Show last verified date and distinguish free tier, limited trial credits, paid-only, and self-hosted free.
- Keep canonical tool IDs stable so reviews, references and future user submissions do not break.

## Automation roadmap
- Phase 1: structured JSON catalog + deterministic validator (this commit).
- Phase 2: render listing cards from JSON, with pagination/search/filter and detail pages.
- Phase 3: scheduled discovery and link/pricing checks; uncertain candidates are generated as a review report or merge request and remain unpublished. Entries that pass all evidence, editorial and automated quality gates are published automatically under the project publishing rule.
- Phase 4: editor review queue, change history, and optional user-submitted suggestions with moderation.

## Safety and quality gates
- Never automatically publish unreviewed tools or unverified price changes. Automatically publish records and updates only after their evidence, editorial review and automated quality gates pass.
- No secrets/API keys in catalog records.
- A successful file commit is not evidence that CI, browser rendering, or deployment passed.
- Production changes require separate explicit approval.

## Automated review scripts
- `scripts/audit-ai-tools-catalog.mjs` compares candidates with the main catalog and with each other by stable ID, normalized name, vendor and official site identity. For GitHub/GitLab/Bitbucket/Codeberg links, the owner/repository path is compared instead of the generic hosting domain, avoiding false duplicates between unrelated projects. Remaining domain collisions are editorial warnings, not automatic proof of duplicate products.
- `scripts/check-ai-tools-links.mjs` checks public official URLs sequentially, with a 10-second timeout and 1.2-second spacing; it does not retry 429 responses. It uses HEAD and a one-byte Range GET fallback when HEAD is rejected. HTTP 404/410 are broken; access-denied, rate-limited, server-error and network failures remain inconclusive.
- CI jobs are opt-in: set `AI_CATALOG_VALIDATE=1` for structure/UI/deduplication checks, and `AI_CATALOG_LINK_CHECK=1` for public-link checks. Neither job deploys or writes to D1.
- HTTP reachability does not verify current pricing, licensing, regional availability or product claims.
