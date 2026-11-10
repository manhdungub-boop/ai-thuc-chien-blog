import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");
const worker = await read("worker.mjs");
const frontend = await read("script.js");
const html = await read("index.html");
const relay = await read("email-relay/Code.gs");
const config = JSON.parse(await read("wrangler.jsonc"));

const originBlock = worker.match(/const COMMUNITY_ALLOWED_ORIGINS = new Set\(\[([\s\S]*?)\]\);/);
assert.ok(originBlock, "Worker must declare an explicit CORS origin allowlist.");
const allowedOrigins = [...originBlock[1].matchAll(/["'](https:\/\/[^"']+)["']/g)]
  .map((match) => new URL(match[1]).origin);
assert.ok(allowedOrigins.includes("https://ai-thuc-chien-blog.manhdungub.workers.dev"));
assert.ok(allowedOrigins.includes("https://ai-thuc-chien-blog.pages.dev"));
assert.equal(new Set(allowedOrigins).size, allowedOrigins.length, "CORS origins must be unique.");
assert.match(worker, /origin === new URL\(request\.url\)\.origin/,
  "Same-origin Preview requests must be allowed without wildcard CORS.");

assert.match(worker, /const tokenHash = await sha256Base64Url\(token\)/,
  "Email verification bearer tokens must be hashed before storage.");
assert.match(worker, /const COMMUNITY_VERIFICATION_SECONDS = 30 \* 60/,
  "Email verification tokens must have a bounded lifetime.");
assert.match(worker, /WHERE t\.token_hash = \? AND t\.expires_at > \? LIMIT 1/,
  "Verification must consume a valid token.");
assert.match(worker, /DELETE FROM community_email_verification_tokens\s+WHERE member_id = \?/,
  "Verification tokens must be removed after account verification.");
assert.match(worker, /EMAIL_NOT_VERIFIED/,
  "Unverified accounts must not establish a session.");
assert.match(worker, /hashCommunityPassword\(password, new Uint8Array\(16\)\)/,
  "Unknown-account login must perform dummy PBKDF2 work.");

assert.match(worker, /password-reset\/request/);
assert.match(worker, /password-reset\/complete/);
assert.match(worker, /DELETE FROM community_sessions WHERE member_id = \?/,
  "Password reset must revoke existing sessions.");
assert.match(frontend, /socialGoogleButton\.href = '\/api\/community\/oauth\/google\/start'/);
assert.match(frontend, /community-password-reset-form/);
assert.match(html, /id="community-password-reset-form"/);

assert.match(relay, /COMMUNITY_EMAIL_RELAY_SECRET/);
assert.match(relay, /COMMUNITY_EMAIL_ALLOWED_HOSTS/);
assert.match(relay, /getProperty\('COMMUNITY_EMAIL_ALLOWED_HOSTS'\) \|\| ''/,
  "Email relay must fail closed when no host allowlist is configured.");
assert.doesNotMatch(relay, /COMMUNITY_EMAIL_ALLOWED_HOSTS'\) \|\| 'ai-thuc-chien-blog\.manhdungub\.workers\.dev'/,
  "Email relay must not silently trust a Production host.");

assert.equal(config.account_id, "92cf091bbac8b4879ec65feb30b4715b");
assert.equal(config.d1_databases[0].database_id, "fc2517cb-9543-4d7b-98f4-bcd5f3c013e7");
assert.equal(config.previews.d1_databases[0].database_id, "51d814c8-a3fc-4481-a5f1-60bc67617f3c");
assert.notEqual(config.d1_databases[0].database_id, config.previews.d1_databases[0].database_id);

console.log("PASS current email verification, password reset, Google OAuth entrypoint, CORS and relay safeguards.");
console.log("PASS Preview D1 is pinned to the reviewed isolated database ID.");
