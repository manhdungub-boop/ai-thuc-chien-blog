# Staging release readiness — social authentication

Updated: 2026-11-04

## Verified on the isolated Staging Worker

- Google OAuth provider readiness is true.
- Facebook OAuth backend routes and mocked security tests are present, but live provider readiness is false because Staging does not have the Meta app credentials.
- The frontend must keep Facebook disabled until the provider-readiness endpoint returns `facebook: true`.
- Apple Sign in is not implemented and must remain disabled.

## Required before enabling Facebook

1. Create or select the Meta Developer App owned by the project operator.
2. Register the exact Staging callback URI shown by the Worker OAuth configuration.
3. Configure the Facebook Login product and allowed domains/redirect URI in Meta.
4. Add `FACEBOOK_OAUTH_CLIENT_ID` and `FACEBOOK_OAUTH_CLIENT_SECRET` as Staging Worker secrets through the approved secret-management path. Never commit or paste secret values into Git.
5. Verify provider readiness, then run a real Facebook sign-in and callback test on Staging.

## Required before enabling Apple

- Implement and review the Apple OIDC authorization, token exchange, identity verification, callback, and account-linking protections.
- Obtain the Apple Developer identifiers and private-key material through the secure secret-management path.
- Keep the Apple control disabled until the full live flow is tested.

## Release safety

- Google is the only live social provider at this checkpoint.
- Facebook and Apple controls remain fail-closed.
- No Production Worker, D1, DNS, or Production Pages settings are changed by this checklist.

## Preview validation

- Cloudflare Pages and Vercel preview builds are isolated from Production.
- The staging project branch allowlists include this candidate branch for preview validation.
