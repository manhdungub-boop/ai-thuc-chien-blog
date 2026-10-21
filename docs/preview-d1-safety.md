# Preview D1 database safety

## Confirmed configuration

The production binding `DB` points to `ai-thuc-chien-community`. The Worker Preview override points to the separate D1 database `ai-thuc-chien-community-preview`. On 22 October 2026, the live Cloudflare health check verified both UUID/name pairs through read-only API requests and confirmed the database UUIDs differ.

## Preview migrations

Use `.github/workflows/migrate-preview-d1.yml` to inspect or apply migrations. The default mode is `list`, which does not modify data. Before running Wrangler, the workflow revalidates the exact preview UUID/name using Cloudflare's read-only API and checks that `wrangler.preview-migrations.jsonc` points to that same verified preview database, rather than production.

Choose `apply` only when you intend to bring the preview schema up to date. Wrangler applies the repository migrations through the dedicated `PREVIEW_DB` config. The workflow never uses the production migration configuration or production database name.

## Safety rules

- Never change the production D1 UUID as part of preview work.
- Never run preview migrations against `ai-thuc-chien-community`.
- Verify the target before any remote D1 write.
- A successful setup step is not proof a migration was applied; use the final migration-list output as evidence.
