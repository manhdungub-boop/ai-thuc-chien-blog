# Release-readiness audit — AI Thực Chiến

Date: 2026-10-25
Scope: read-only Cloudflare and Apps Script checks. No production writes.

## Findings

1. The public Worker still redirects `/login` and `/register` to the homepage without a login/register mode parameter.
2. The public Worker named `ai-thuc-chien-blog` is bound to the D1 database named `ai-thuc-chien-community-preview`. The separately named `ai-thuc-chien-community` database does not have the `email_verification_required` member column required by the new candidate. Do not change the binding or run a production migration until a backup and schema compatibility plan are reviewed.
3. The older `ai-thuc-chien-blog-auth-preview` Worker has a misspelled secret binding `COMMUNITY_EMAIL_RELAY_SECR` and lacks the `COMMUNITY_EMAIL_RELAY_URL` binding.
4. The isolated `ai-thuc-chien-blog-auth-app-preview` Worker uses the isolated `ai-thuc-chien-blog-community-preview` database and intentionally has no email relay bindings. Its status endpoint correctly keeps registration disabled.
5. The staging Apps Script code expects a Script Property named `COMMUNITY_EMAIL_RELAY_SECRET`, validates the verification link's allowed host, and uses `MailApp.sendEmail`. Its source and manifest were exported, but a live Web App deployment and configured properties were not verified.
6. A legacy relay URL returned `UNAUTHORIZED` to an invalid test request. No valid request was sent and no email was sent. This is not evidence of successful delivery.

## Required before release

- Configure and deploy the Apps Script staging Web App.
- Generate a strong random secret and configure the same value in Apps Script Script Properties and the isolated staging Worker secret binding; never put the secret in Git.
- Configure the staging Worker relay URL, run a controlled inbox test, verify the link, expiry, replay prevention, resend limits, and fail-closed behavior.
- Review the public Worker/D1 mismatch, take a recoverable backup, and plan a migration for the missing column before considering any production binding change.
- Re-test public `/login` and `/register` and review the release plan before a separately approved production deployment.

## Safety status

No production Worker source, binding, D1 row, DNS record, or deployment was changed by this audit. The repository remains staging-only. Production promotion is blocked pending the gates above.
