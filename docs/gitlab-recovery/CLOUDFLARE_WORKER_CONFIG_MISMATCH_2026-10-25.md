# Cloudflare Worker configuration mismatch — read-only audit — 2026-10-25

## Why this note exists

A read-only Cloudflare API audit found that the live Worker named `ai-thuc-chien-blog` has an annotation describing it as preview-only, but its latest deployment is assigned 100% of traffic. Its bindings point to the preview D1 database and the legacy Apps Script relay URL. This is a configuration/provenance mismatch and needs reconciliation; it is not, by itself, proof of compromise.

## Observed live metadata

- Worker: `ai-thuc-chien-blog`
- Latest deployment ID: `51587fe9-266d-4c54-a04d-7441de83b445`
- Latest version: `3713d7c4-ca28-470a-b0bc-33c8e3712877`
- Latest deployment source: Cloudflare dashboard
- Latest deployment traffic allocation: 100%
- Annotation: `Preview only: email verification integration using staging D1`
- D1 binding `DB`: `ai-thuc-chien-community-preview`, ID `51d814c8-a3fc-4481-a5f1-60bc67617f3c`
- Plain-text binding `COMMUNITY_EMAIL_RELAY_URL` points to the legacy Apps Script `/exec` URL. Do not copy or expose relay secrets.
- Secret binding name is `COMMUNITY_EMAIL_RELAY_SECRET`; the secret value was not read.
- The separate isolated Worker `ai-thuc-chien-blog-auth-app-preview` uses isolated D1 `c8b301f0-afcf-4f36-9b8e-8194c01bbbc8` and currently has no relay binding, consistent with relay intentionally unconfigured.
- The separate `ai-thuc-chien-blog-auth-preview` Worker has a truncated secret binding name `COMMUNITY_EMAIL_RELAY_SECR` and should not be treated as a valid configured relay integration.

## Safety decision

Do not update, redeploy, rebind, rotate secrets, or migrate D1 based only on these labels. First establish which Worker is intended to serve each hostname, confirm the actual route/domain mapping, identify the authoritative D1, compare the deployed source to the reviewed GitLab candidate, and confirm whether the legacy relay is still active. Keep current live resources unchanged until a reviewed reconciliation plan and rollback evidence exist.

## Google Apps Script access status

The existing free Google Drive connector can find the staging Apps Script project by name and ID, but exporting its source returns 404/no-access. The legacy Apps Script source export works. No Script Properties, deployment settings, secrets, or email delivery were changed or verified through the connector. Do not use a paid browser automation service or top up any tool wallet.

## Current release gate

Production release remains NO-GO. Email verification cannot be considered enabled until the isolated staging relay is configured, a real email is received and verified, browser/runtime checks pass, and Worker/D1/hostname provenance is reconciled.
