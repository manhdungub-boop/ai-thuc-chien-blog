import assert from "node:assert/strict";

function containsProductionChatEndpoint(source) {
  const productionOrigin = "https://ai-thuc-chien-blog.manhdungub.workers.dev";
  const urls = source.match(/https?:\/\/[^\s"'<>]+/g) || [];
  return urls.some((value) => {
    try {
      const parsed = new URL(value);
      return parsed.origin === productionOrigin && parsed.pathname === "/api/chat";
    } catch {
      return false;
    }
  });
}

const origin = "https://ai-thuc-chien-blog-auth-isolated-20261104.manhdungub.workers.dev";
async function get(path) {
  const response = await fetch(new URL(path, origin), {
    method: "GET",
    redirect: "manual",
    headers: { Accept: "text/html,application/json,*/*", "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(20000),
  });
  return { response, body: await response.text() };
}

// Read-only checks only: no registration, email send, OAuth callback, session mutation or D1 writes.
const home = await get("/");
assert.equal(home.response.status, 200, "Isolated homepage must return HTTP 200.");
assert.match(home.response.headers.get("content-type") || "", /text\/html/i);
assert.match(home.response.headers.get("x-robots-tag") || "", /noindex/i);
for (const marker of ['id="community-auth-form"', 'src="script.js"', 'href="styles.css"']) {
  assert.ok(home.body.includes(marker), "Homepage missing expected auth/static marker: " + marker);
}
console.log("PASS isolated homepage serves auth form and static asset references.");

const script = await get("/script.js");
assert.equal(script.response.status, 200);
for (const marker of ["oauth/providers", "socialGoogleButton", "ai-thuc-chien-blog-auth-isolated-20261104.manhdungub.workers.dev"]) {
  assert.ok(script.body.includes(marker), "script.js missing marker: " + marker);
}
assert.equal(containsProductionChatEndpoint(script.body), false, "isolated script must not reference the Production chat endpoint");
console.log("PASS isolated frontend contains isolated auth host and no Production chat API URL.");

const styles = await get("/styles.css");
assert.equal(styles.response.status, 200);
assert.ok(styles.body.includes(".community-social-auth"));
console.log("PASS isolated CSS assets are served.");

const providers = await get("/api/community/oauth/providers");
assert.equal(providers.response.status, 200);
const providerState = JSON.parse(providers.body);
assert.equal(providerState.google, false, "Isolated Google OAuth must remain disabled until credentials are deliberately configured.");
assert.equal(providerState.facebook, false);
console.log("PASS isolated OAuth provider status is safely disabled.");

const me = await get("/api/community/me");
assert.equal(me.response.status, 200);
assert.equal(JSON.parse(me.body).member, null);
console.log("PASS isolated unauthenticated session endpoint is read-only and returns no member.");

const status = await get("/__staging/status");
assert.equal(status.response.status, 200);
const health = JSON.parse(status.body);
assert.equal(health.ok, true);
assert.equal(health.database_ready, true);
assert.equal(health.schema_ready, true);
console.log("PASS isolated D1/schema health endpoint.");
console.log("No POST requests, email sends, OAuth attempts, or database writes were performed.");
