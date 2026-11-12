# Cloudflare Worker configuration audit — 2026-10-25

## Read-only observations
Account scope: Cloudflare account used by the project. This audit did not change any Worker, D1 binding, secret, DNS record, or deployment.

### `ai-thuc-chien-blog-auth-app-preview`
- Script settings endpoint returned HTTP 200.
- Bound D1: `c8b301f0-afcf-4f36-9b8e-8194c01bbbc8` (isolated preview DB).
- No secret bindings listed.
- Annotation says isolated auth preview and mail relay intentionally unconfigured.
- Latest listed deployment was 100% to version `dc944019-ec74-4dae-a7da-5ef9aea15a3e`.

### `ai-thuc-chien-blog-auth-preview`
- Bound D1: `c8b301f0-afcf-4f36-9b8e-8194c01bbbc8`.
- Secret binding name is truncated to `COMMUNITY_EMAIL_RELAY_SECR`; no relay URL binding was present in the settings response.
- This binding name does not match the expected `COMMUNITY_EMAIL_RELAY_SECRET`. No secret value was retrieved or exposed.
- Do not treat this Worker as ready for email delivery.

### `ai-thuc-chien-blog`
- Script annotation says: `Preview only: email verification integration using staging D1`.
- Its D1 binding is `51d814c8-a3fc-4481-a5f1-60bc67617f3c` (named `ai-thuc-chien-community-preview`).
- Settings show a plain-text `COMMUNITY_EMAIL_RELAY_URL` pointing at the legacy Apps Script endpoint and a secret binding named `COMMUNITY_EMAIL_RELAY_SECRET`.
- Latest deployment list returned a 100% deployment to version `3713d7c4-ca28-470a-b0bc-33c8e3712877` on 2026-10-24.
- This is a **configuration/provenance mismatch requiring investigation**: the Worker has the main script name but is annotated as preview-only and is bound to a preview D1. This read-only result alone does not prove which hostname receives traffic or that production data was exposed.

## Required safety response
- Do not edit, redeploy, rebind, or rotate any secret based only on this observation.
- First establish the hostname/routes and authoritative intended Worker/D1 mapping from deployment configuration and repository history.
- Confirm the legacy Apps Script endpoint is intended for the relevant environment; do not send test email or change Script Properties until that is established.
- Then create a reviewed staging-only correction plan and test it on a separate preview Worker.
- Keep production untouched until the mapping and rollback are documented.

## Release impact
Email verification is not release-ready. The isolated D1 time-travel restore drill passed on the disposable database, but SQL export download/import and production recovery are not yet verified. Browser and email end-to-end tests remain outstanding.
