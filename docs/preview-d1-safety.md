# Isolated D1 for Workers previews

## Purpose

Preview builds must not read from or write to the production community database. The production binding remains `DB` and points to `ai-thuc-chien-community`. The preview override is declared separately in `wrangler.jsonc` under `previews.d1_databases`.

## Before merging this change

1. In Cloudflare D1, independently confirm that the configured preview database name and UUID identify the intended non-production database. The ID supplied for this branch has not yet been independently verified.
2. Confirm the Workers Builds preview succeeds and that the build step creates `dist` before Wrangler reads the `assets.directory` setting.
3. Inspect the preview configuration and verify the production `d1_databases` entry is unchanged.
4. Do not run migrations against production while validating preview. The optional `wrangler.preview-migrations.jsonc` file uses a separate `PREVIEW_DB` binding; only use it after confirming its database target.
5. Test the preview endpoint with non-production data before merging.

## Build settings

The repository's static build command is `npm run build` (runs `node scripts/build_static_site.cjs`). A successful GitHub Actions configuration workflow has set the verified production Workers Builds triggers to use this build command while preserving their expected production deploy command. Preview checks still need to be rerun to confirm the missing-`dist` error is resolved.

## Production safety

Do not change the production database ID, run production migrations, or switch a preview deploy command to `wrangler deploy` as part of this validation.