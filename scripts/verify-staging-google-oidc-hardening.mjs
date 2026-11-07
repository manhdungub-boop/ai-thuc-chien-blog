import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../recovery-snapshots/worker-email-verification-candidate.mjs", import.meta.url), "utf8");
const checks = [
  ["staging callback origin is pinned", source.includes('const COMMUNITY_OAUTH_STAGING_ORIGIN = "https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev";')],
  ["Google OIDC ID token validator is present", source.includes("async function validateGoogleOidcIdToken")],
  ["RS256 signature is verified", source.includes('header.alg !== "RS256"') && source.includes('crypto.subtle.verify("RSASSA-PKCS1-v1_5"')],
  ["nonce is generated and sent", source.includes('const nonce = bytesToBase64Url') && /\n\s+nonce,/.test(source)],
  ["nonce cookie is cleared", source.includes('communityOAuthCookie(provider, "nonce", "", 0)')],
  ["callback is rate limited", source.includes('"oauth-callback:" + provider + ":" + callbackIpHash')],
  ["verified email claim is mandatory", source.includes("claims.email_verified !== true")],
  ["production origin constant is absent", !source.includes("COMMUNITY_OAUTH_PRODUCTION_ORIGIN")],
];
for (const [label, ok] of checks) {
  assert.ok(ok, label);
  process.stdout.write("PASS " + label + "\n");
}
