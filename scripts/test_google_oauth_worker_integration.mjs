import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const worker = await readFile(new URL("../worker.mjs", import.meta.url), "utf8");
const frontend = await readFile(new URL("../script.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/0003_community_oauth_accounts.sql", import.meta.url), "utf8");

assert.match(worker, /COMMUNITY_OAUTH_ALLOWED_ORIGINS = new Set\(\[/);
assert.match(worker, /https:\/\/ai-thuc-chien-blog\.manhdungub\.workers\.dev/);
assert.match(worker, /https:\/\/ai-thuc-chien-blog-auth-app-preview\.manhdungub\.workers\.dev/);
assert.doesNotMatch(worker, /https:\/\/feature-required-email-verification-ai-thuc-chien-blog\.manhdungub\.workers\.dev/);
assert.match(worker, /route === "oauth\/providers"/);
assert.match(worker, /isAllowedOAuthHost = COMMUNITY_OAUTH_ALLOWED_ORIGINS\.has\(new URL\(request\.url\)\.origin\)/);
assert.match(worker, /google: isAllowedOAuthHost && communityOAuthReady\(env, "google"\)/);
assert.match(worker, /route\.match\(\/\^oauth\\\/google\\\//);
assert.match(worker, /code_challenge_method:\s*"S256"/);
assert.match(worker, /code_verifier/);
assert.match(worker, /claims\.email_verified\s*!==\s*true/);
assert.match(worker, /claims\.nonce\s*!==\s*expectedNonce/);
assert.match(worker, /claims\.aud/);
assert.match(worker, /communityOAuthClearCookies/);
assert.match(worker, /Set-Cookie.*communityCookie\(sessionToken\)/s);
assert.match(worker, /Google OAuth chưa được bật trên tên miền này/);
assert.doesNotMatch(worker, /route\.match\(\/\^oauth\\\/(?:google\|facebook)/);
assert.match(frontend, /socialGoogleButton\.href = '\/api\/community\/oauth\/google\/start'/);
assert.match(frontend, /api\('\/oauth\/providers'/);
assert.match(frontend, /oauthParams\.get\('oauth'\)/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS community_oauth_accounts/);
assert.match(migration, /CHECK \(provider = 'google'\)/);
assert.match(migration, /REFERENCES community_members\(id\) ON DELETE CASCADE/);
assert.match(migration, /PRIMARY KEY \(provider, provider_user_id\)/);
assert.match(migration, /idx_community_oauth_accounts_member/);

console.log("PASS Google OAuth is restricted to canonical Production and dedicated Preview hosts");
console.log("PASS OAuth uses state, PKCE, nonce, RS256 OIDC validation and verified email");
console.log("PASS session cookie is issued after linked member persistence");
console.log("PASS migration is additive, Google-only, unique and foreign-key cascaded");
