# Social login staging setup — Google and Facebook

Status: code candidate for staging only. Do not configure production from this document.

## Callback URLs

Register these exact HTTPS redirect URIs with each provider:

- Google: `https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev/api/community/oauth/google/callback`
- Facebook: `https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev/api/community/oauth/facebook/callback`

The scheme, hostname, path and trailing slash must match exactly. The Worker uses the same URL in the authorization request and the token exchange.

## Google

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Select or create the project for AI Thực Chiến and configure the OAuth consent screen.
3. Create an OAuth Client ID of type **Web application**.
4. Add the Google callback URL above to **Authorized redirect URIs**.
5. Configure the app audience/test users as appropriate while in testing.
6. Store the values only in the staging Worker:
   - `GOOGLE_OAUTH_CLIENT_ID`
   - `GOOGLE_OAUTH_CLIENT_SECRET`

The implementation requests only `openid email profile`, uses Authorization Code + PKCE (S256), checks the returned `email_verified` claim and does not persist the provider access token.

## Facebook

1. Open [Meta for Developers](https://developers.facebook.com/).
2. Create or select the app and add the Facebook Login use case/product for the web.
3. Enable Client OAuth Login and Web OAuth Login.
4. Add the Facebook callback URL above to **Valid OAuth Redirect URIs**.
5. Request only `email` and `public_profile`. The app may remain in Development mode for testing with app roles/testers; Meta review and Live mode may be required before general public access.
6. Store the values only in the staging Worker:
   - `FACEBOOK_OAUTH_CLIENT_ID` (Meta App ID)
   - `FACEBOOK_OAUTH_CLIENT_SECRET` (Meta App Secret)

Facebook sign-in requires Meta to return an email address. Some Facebook accounts do not supply one; those users should use email/password or another provider.

## Cloudflare staging secrets

Use the Cloudflare Dashboard for Worker `ai-thuc-chien-blog-auth-app-preview` → Settings → Variables and Secrets. Add all four values above; mark each secret value as **Secret**, never Plain text. Do not paste any secret into GitLab, code, screenshots, or this chat. Keep the production Worker untouched.

## Data and account matching

The additive migration `migrations/0002_community_oauth_accounts.sql` stores provider subject IDs and the linked member ID. Provider credentials/tokens are not stored in D1. **Google** account linking uses the returned `email_verified` claim; a verified Google email can match an existing community member or create a new verified member. **Facebook** email is stored only as provider metadata and is never used to look up, verify, or take over an existing email/password account. A Facebook identity gets a separate provider-bound member with an internal `@social.invalid` address and an unverified email state until a separate verified account-link flow is implemented. A Facebook-only member must continue signing in with Facebook; the synthetic address cannot receive email or recover a password. The application generates an inaccessible random password for provider-created accounts. Existing member data and email/password login remain intact.

## Verification sequence

1. Apply migration 0002 to the staging D1 database only.
2. Add the four staging credentials in Cloudflare.
3. Confirm `GET /api/community/oauth/providers` returns the expected readiness flags (never returns credentials).
4. Test Google and Facebook from the staging homepage on iPhone and desktop.
5. Verify first and repeat login, Google account linking by its verified email claim, Facebook provider-bound login without email auto-linking, logout, `/api/community/me`, and community room access.
6. Verify invalid state, provider cancellation, missing Facebook email, and missing credentials fail safely.
7. Keep this change in a Draft MR until all live provider tests pass. No production deployment is included.
