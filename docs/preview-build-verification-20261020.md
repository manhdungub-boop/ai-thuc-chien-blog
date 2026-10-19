# Preview build verification

## Purpose

This note records the safe verification sequence for the Workers Preview build. It is documentation-only and does not change the production Worker or production D1 database.

## Required Workers Builds settings

- Build command: `npm run build`
- Production deploy command: preserve the existing `npx wrangler deploy`
- Preview command: `npx wrangler preview`

Workers Builds must run the build command before the preview command. The static-site build creates `dist/`, which is required by the `assets.directory` entry in `wrangler.jsonc`.

## Verification criteria

1. The new preview build log shows the build command running before Wrangler Preview.
2. The build script completes and creates `dist/`.
3. Wrangler Preview gets past the missing-assets-directory error.
4. Preview-only D1 binding is verified against the actual D1 database named `ai-thuc-chien-community-preview` before merging this PR or applying migrations.

Do not merge this PR or run any migration until preview succeeds and the preview D1 ID is verified. Production D1 must remain `fc2517cb-9543-4d7b-98f4-bcd5f3c013e7`.