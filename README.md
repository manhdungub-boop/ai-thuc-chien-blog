# AI Thực Chiến Blog — Official source repository

The `main` branch is the official version-controlled source for the website's static content. It was restored from a verified Production content snapshot and now serves as the canonical source for future content maintenance and reviewed releases.

## Source provenance
- Restored snapshot: `release/production-approval-required:site-snapshot/`
- Snapshot reference: Cloudflare Production Worker version `bd0457e2-ff7c-4a13-936e-cf6747ac3dd2` (v187)
- Snapshot date: 2026-11-03
- Restored content: 69 article pages, homepage, About page, library, AI tools directory/data, sitemap, RSS, styles, JavaScript and static assets.

The provenance above identifies the source snapshot; it does not assert that this repository commit is currently deployed to Production.

## Scope and boundaries
This repository snapshot contains static website content and assets. It does not include or modify the Production Worker runtime, Cloudflare bindings, D1 schema/data, DNS, secrets, email relay, authentication, or OAuth configuration.

## Validation
The dependency-free Node.js validation job checks article count, sitemap coverage, canonical URLs, author/attribution metadata, static entry points and AI tools JSON. A passing job verifies source-snapshot integrity only. It is not an editorial fact-check, a live-site acceptance test, or authorization to deploy.

## Release process and safety
- Treat `main` as the canonical source for reviewed static-content changes.
- Make changes on a feature branch and submit a merge request with a successful validation pipeline.
- Validate the candidate in Staging and inspect the resulting site before considering any Production release.
- A merge into `main` does not, by itself, prove that Cloudflare Pages or the Production Worker has deployed the change.
- Production deployment requires a separate, explicit approval and a verified release procedure.
- Do not use static-content releases to alter Worker runtime, bindings, D1, DNS, secrets, email relay, authentication, or OAuth. Those require separate review and authorization.

## Netlify Deploy Preview validation
- The separate Netlify site `ai-thuc-chien-blog-preview` is connected to this GitLab repository; Deploy Previews are enabled by the site owner.
- Merge-request previews must be generated in Netlify's `deploy-preview` context and use the MR's source commit. A deploy of branch `main` in `production` context is not evidence of an MR preview.
- `netlify.toml` invokes `scripts/netlify-preview-build.mjs`; the wrapper is intended to fail closed outside the Deploy Preview context.
- Verify the preview's commit SHA, branch, deploy context, build result and access controls before using it for acceptance testing.
- Team SSO is required on the preview site. `noindex` is a search-engine directive, not access control.
- Preview validation does not authorize merge, Production deployment, Worker/D1/DNS/secrets changes, or public content publication.
