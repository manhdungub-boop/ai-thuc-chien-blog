# Cloudflare Worker deployment and source reconciliation — 2026-10-26

## Authority and method

This report uses read-only Cloudflare deployment records and version-scoped main-module retrieval. For source identity, it uses `GET /workers/workers/{worker_id}/versions/{version_id}?include=modules` rather than inferring the active source from the latest uploaded settings/content endpoint.

## Public Worker: `ai-thuc-chien-blog`

- Active deployment: `51587fe9-266d-4c54-a04d-7441de83b445`, created `2026-10-24T09:39:20.272966Z`.
- Active version at 100%: **v175**, ID `3713d7c4-ca28-470a-b0bc-33c8e3712877`.
- D1 binding: production D1 `fc2517cb-9543-4d7b-98f4-bcd5f3c013e7`.
- Version-scoped source SHA-256: `76b6517b4179e780da1dad4d062d6404f5f433cf302cdf2a75501999ce8b60ec`.
- The v175 source contains no email-verification route or relay environment-variable references. Its version metadata lists relay URL/secret bindings, but the source doesn't consume them; don't treat those bindings as proof that production email confirmation is working.
- The same decoded main-module hash is present on versions 173 and 174. Their bindings vary, but their source bytes are identical to v175.

## Latest uploaded public Worker version — not active traffic

- **v176**, ID `6a5e8b7e-35b3-4e13-9dfa-edc71cc651b7`.
- Annotation: `Preview only: email verification integration using staging D1`.
- D1 binding: preview D1 `51d814c8-a3fc-4481-a5f1-60bc67617f3c`.
- Source SHA-256: `82c2ae53c7bdbead601a2cb9af08754746f18d4c20f4104f60dfe4401a112e1e`.
- This older candidate includes `email_verification_required` and `/api/community/verify`; its D1 contains the extra column, unlike production D1. **Do not deploy v176 to production.**

The generic script-settings/source endpoint showed data associated with this latest uploaded version, not necessarily the active v175 deployment. Earlier reporting that attributed v176's verification logic to live v175 was incorrect; see [version-scoped source audit](VERSION_SCOPED_WORKER_SOURCE_AUDIT_2026-10-26.md).

## Dedicated staging Worker

- Worker: `ai-thuc-chien-blog-auth-app-preview`.
- Current active deployment: `c19ded53-7168-4ef6-b745-d0ae7d0e7359`, assigning 100% to version 29 `0695529e-7f18-4dce-b595-26cb5944ffea`.
- Source length: 85,872 characters; SHA-256 `5d68d5076bedd4ab3934b53b83423f367ac9d390b75757e7e672d5e5aedef485`, matching the reviewed branch candidate.
- D1 binding remains isolated staging database `c8b301f0-afcf-4f36-9b8e-8194c01bbbc8`; AI, relay-secret and relay-URL binding names/types remain present. Secret values were not exposed or changed.
- The read-only staging SEO diagnostic confirms homepage Organization and sample article publisher logo JSON-LD and validates the shared SVG response factory's 200/MIME/body properties. It does not claim an independent raw HTTP header capture.
- Production remains on version 175 at 100%; no production resource was changed. See [staging logo asset verification](SEO_LOGO_ASSET_STAGING_VERIFICATION_2026-10-26.md).
## Route observations

Requests to public `/login` and `/register` previously returned to the homepage without the matching `mode` query. The route fix is in current staging version 29 (carried forward from earlier staging candidates), not active production v175.

## Observability and verification tokens

The previous `GET /workers/scripts/ai-thuc-chien-blog/settings` response's `redact_query_string=false` was associated with the latest uploaded v176 configuration and is **not evidence about v175's active redaction setting**. The version-specific payload does not expose a definitive v175 query-redaction setting in this read. Therefore treat production query-token redaction as **unknown/open**, not as confirmed true or false. The staging settings check before the earlier staging deployment reported `redact_query_string=true`; no production observability settings were changed by the version-29 staging update.

Do not update production observability settings through a partial version upload until it is proven how bindings and deployment state are affected. Never expose a raw verification token in logs, traces, screenshots, or reports.

## Safety conclusion

- Production source v175 does not currently implement mandatory email confirmation.
- v176 is preview-only, bound to a different D1, and must not be deployed unchanged.
- Do not change database bindings or production traffic until a reviewed candidate, production relay, token-log protection, backup/restore, and rollback gates are satisfied.
- No Worker version/deployment, binding, D1, DNS, secret, observability setting, relay config, or traffic allocation was changed by this read-only reconciliation.
