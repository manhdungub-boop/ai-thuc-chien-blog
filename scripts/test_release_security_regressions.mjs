import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = async path => readFile(new URL("../" + path, import.meta.url), "utf8");
const worker = await read("worker.mjs");
const relay = await read("email-relay/Code.gs");
const linkChecker = await read("scripts/check-ai-tools-links.mjs");
const authPreview = await read(".github/workflows/deploy-auth-app-preview.yml");
const emailPreview = await read(".github/workflows/test-email-verification-preview-http.yml");
const oauthWorkflow = await read(".github/workflows/staging-google-oauth-integration.yml");

assert.match(worker, /else\s*\{\s*\/\/ Match the expensive PBKDF2 work for unknown accounts[\s\S]*?hashCommunityPassword\(password, new Uint8Array\(16\)\)/,
  "Unknown-account login must perform dummy PBKDF2 work.");
assert.match(relay, /COMMUNITY_EMAIL_ALLOWED_HOSTS'\) \|\| ''/,
  "Email relay must fail closed when the host allowlist is missing.");
assert.doesNotMatch(relay, /COMMUNITY_EMAIL_ALLOWED_HOSTS'\) \|\| 'ai-thuc-chien-blog\.manhdungub\.workers\.dev'/,
  "Email relay must not silently fall back to a Production hostname.");
assert.match(linkChecker, /lookup: \(_hostname, opts, callback\)/);
assert.match(linkChecker, /transport\.request\(options/);
assert.match(linkChecker, /dns\.lookup\(host, \{ all: true, verbatim: true \}\)/,
  "Catalog link checker must pin the validated DNS address to the HTTP socket.");
assert.doesNotMatch(authPreview, /CLOUDFLARE_API_TOKEN|COMMUNITY_EMAIL_RELAY_SECRET|GOOGLE_OAUTH_CLIENT_SECRET|wrangler deploy/,
  "Auth Preview static validation must not expose credentials or deploy.");
assert.match(emailPreview, /workflow_dispatch:/);
assert.doesNotMatch(emailPreview, /(^|\n)  push:|secrets\.|CLOUDFLARE_API_TOKEN|wrangler (?:preview|deploy|secret)/,
  "Email Preview smoke workflow must be manual-only, GET-only and credential-free.");
assert.match(emailPreview, /test_community_preview_frontend\.mjs/);
assert.doesNotMatch(oauthWorkflow, /gitlab/i, "OAuth workflow must use GitHub-only branch filters.");
assert.doesNotMatch(oauthWorkflow, /secrets\.|CLOUDFLARE_API_TOKEN|wrangler (?:preview|deploy)/,
  "OAuth integration tests must remain offline and credential-free.");
console.log("PASS: login timing, relay allowlist, DNS rebinding, and credential-free Preview regression guards.");
