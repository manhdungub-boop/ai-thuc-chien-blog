import assert from "node:assert/strict";
import worker from "../recovery-snapshots/worker-email-verification-candidate.mjs";

const origin = "https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev";
const forbiddenOrigin = "https://attacker.example";
let databaseCalls = 0;
const db = {
  prepare() {
    databaseCalls += 1;
    throw new Error("Unexpected database access in boundary test");
  },
};

async function request(path, { method = "POST", requestOrigin = origin, body, env = { DB: db } } = {}) {
  const headers = {};
  if (requestOrigin !== null) headers.Origin = requestOrigin;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return worker.fetch(new Request(origin + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
}

const denied = await request("/api/community/verify-email", {
  requestOrigin: forbiddenOrigin,
  body: { token: "A".repeat(43) },
});
assert.equal(denied.status, 403, "disallowed Origin must be rejected");
assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null, "disallowed Origin must not receive CORS permission");
assert.equal(databaseCalls, 0, "disallowed Origin must be rejected before database access");
console.log("PASS disallowed Origin rejected before database access");

const preflight = await request("/api/community/register", {
  method: "OPTIONS",
});
assert.equal(preflight.status, 200, "allowed preflight should succeed");
assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);
assert.match(preflight.headers.get("Access-Control-Allow-Methods") || "", /POST/);
assert.match(preflight.headers.get("Cache-Control") || "", /no-store/);
console.log("PASS allowed CORS preflight returns explicit non-cacheable policy");

const malformed = await request("/api/community/verify-email", {
  body: { token: "not-a-valid-token" },
});
assert.equal(malformed.status, 400, "malformed verification token should be rejected");
assert.equal(malformed.headers.get("Access-Control-Allow-Origin"), origin);
assert.equal(malformed.headers.get("X-Content-Type-Options"), "nosniff");
assert.match(malformed.headers.get("Cache-Control") || "", /no-store/);
assert.equal(databaseCalls, 0, "malformed token must be rejected before database lookup");
console.log("PASS malformed token rejected before database lookup with safe headers");

const tokenizedUrl = await request("/api/community/verify-email?verify=" + "A".repeat(43), {
  body: { token: "not-a-valid-token" },
});
assert.equal(tokenizedUrl.status, 400, "malformed verification token remains rejected");
assert.equal(tokenizedUrl.headers.get("Referrer-Policy"), "no-referrer", "verification-token URLs must not propagate a Referer");
assert.equal(databaseCalls, 0, "token-bearing URL header test must not access the database");
console.log("PASS verification-token query suppresses Referer headers");

const stagingHome = await worker.fetch(new Request(origin + "/", { method: "GET" }), { DB: db });
assert.equal(stagingHome.status, 200, "staging homepage should load from the embedded reviewed snapshot");
assert.match(stagingHome.headers.get("Content-Type") || "", /text\/html/);
assert.match(await stagingHome.text(), /community-password-reset-form/, "staging homepage must contain the password-reset form");
assert.equal(databaseCalls, 0, "staging homepage asset must not need database access");
console.log("PASS staging homepage serves the reset form from the reviewed HTML snapshot");

const originalFetch = globalThis.fetch;
let proxiedUrl = null;
globalThis.fetch = async (input) => {
  proxiedUrl = new URL(typeof input === "string" ? input : input.url);
  return new Response("<!doctype html><html><head><title>Proxy test</title></head><body>ok</body></html>", {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};
try {
  const token = "B".repeat(43);
  const landing = await worker.fetch(new Request("https://ai-thuc-chien-blog.manhdungub.workers.dev/?campaign=boundary-test&verify=" + token, {
    method: "GET",
  }), { DB: db });
  assert.equal(landing.status, 200, "token landing should still load the homepage");
  assert.equal(landing.headers.get("Referrer-Policy"), "no-referrer");
  assert.ok(proxiedUrl, "homepage should exercise the Pages proxy");
  assert.equal(proxiedUrl.hostname, "ai-thuc-chien-blog.pages.dev", "homepage proxy should use the backup Pages host");
  assert.equal(proxiedUrl.searchParams.has("verify"), false, "verification bearer token must not be forwarded to the Pages host");
  assert.equal(proxiedUrl.searchParams.get("campaign"), "boundary-test", "unrelated campaign parameters should be preserved");
  console.log("PASS homepage proxy strips verification token before calling Pages and preserves other parameters");
} finally {
  globalThis.fetch = originalFetch;
}

const oversized = await request("/api/community/register", {
  body: { username: "oversized", displayName: "Oversized", email: "oversized@example.invalid", password: "StrongPass123", extra: "x".repeat(7000) },
});
assert.equal(oversized.status, 413, "oversized JSON body should be rejected");
assert.match(oversized.headers.get("Cache-Control") || "", /no-store/);
assert.equal(databaseCalls, 0, "oversized body must be rejected before database access");
console.log("PASS oversized request rejected before database access");

const missingDb = await request("/api/community/register", {
  env: {},
  body: { username: "no_db", displayName: "No DB", email: "nodb@example.invalid", password: "StrongPass123" },
});
assert.equal(missingDb.status, 503, "missing D1 binding must fail closed");
assert.match(missingDb.headers.get("Cache-Control") || "", /no-store/);
console.log("PASS missing D1 binding fails closed without caching");

console.log("All email-verification boundary tests passed. No real email, D1 database, secret, or deployed Worker was used.");
