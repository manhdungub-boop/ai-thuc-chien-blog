import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import worker from "../recovery-snapshots/worker-email-verification-candidate.mjs";

const frontend = await readFile(new URL("../site-snapshot/script.js", import.meta.url), "utf8");
assert.match(frontend, /socialGoogleButton\.href = '\/api\/community\/oauth\/google\/start'/, "Google sign-in must keep its active OAuth route.");
assert.match(frontend, /socialAppleButton\.disabled = true/, "Apple must be a disabled coming-soon control.");
assert.match(frontend, /Facebook — Đang phát triển/, "Facebook must show the Vietnamese coming-soon notice.");
assert.match(frontend, /Apple — Đang phát triển/, "Apple must show the Vietnamese coming-soon notice.");
assert.ok(frontend.includes("socialFacebookButton.disabled = true"), "Facebook must remain permanently disabled.");
const facebookStartPath = "/api/community/oauth/" + "facebook/start";
assert.equal(frontend.includes(facebookStartPath), false, "Facebook must not expose an OAuth start route.");
assert.doesNotMatch(frontend, /socialAppleButton\.href\s*=/, "Apple must not expose an active OAuth route.");
console.log("PASS frontend keeps Google OAuth active, displays Facebook coming-soon notice without an action, and keeps Apple disabled.");

const origin = "https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev";

class MockD1 {
  constructor() {
    this.members = new Map();
    this.identities = new Map();
    this.sessions = new Map();
    this.rates = new Map();
  }
  prepare(sql) {
    const db = this;
    return {
      args: [],
      bind(...args) { this.args = args; return this; },
      async run() {
        const q = sql.trim().toLowerCase();
        const a = this.args;
        if (q.startsWith("insert into community_rate_limits")) {
          const old = db.rates.get(a[0]) || 0; db.rates.set(a[0], old + 1); return { meta: { changes: 1 } };
        }
        if (q.startsWith("insert into community_members")) {
          const [id, username, email, display_name, password_salt, password_hash, created_at, email_verified_at] = a;
          if ([...db.members.values()].some(m => m.email.toLowerCase() === email.toLowerCase() || m.username.toLowerCase() === username.toLowerCase())) {
            throw new Error("UNIQUE constraint failed: community_members.email");
          }
          db.members.set(id, { id, username, email, display_name, password_salt, password_hash, created_at, email_verified_at });
          return { meta: { changes: 1 } };
        }
        if (q.startsWith("update community_members set email_verified_at")) {
          const [verified, id] = a; const member = db.members.get(id);
          if (member && !member.email_verified_at) member.email_verified_at = verified;
          return { meta: { changes: member ? 1 : 0 } };
        }
        if (q.startsWith("insert into community_oauth_accounts")) {
          const [provider, provider_user_id, member_id, email, created_at] = a;
          const key = provider + ":" + provider_user_id;
          if (!db.identities.has(key)) db.identities.set(key, { provider, provider_user_id, member_id, email, created_at });
          return { meta: { changes: 1 } };
        }
        if (q.startsWith("delete from community_topic_presence where member_id = ?")) return { meta: { changes: 0 } };
        if (q.startsWith("delete from community_sessions where expires_at")) return { meta: { changes: 0 } };
        if (q.startsWith("insert into community_sessions")) {
          const [id, member_id, token_hash, created_at, expires_at] = a;
          db.sessions.set(token_hash, { id, member_id, token_hash, created_at, expires_at });
          return { meta: { changes: 1 } };
        }
        throw new Error("Unexpected SQL run: " + sql);
      },
      async all() {
        const q = sql.trim().toLowerCase();
        const a = this.args;
        if (q.startsWith("select provider from community_oauth_accounts")) {
          return { results: [...db.identities.values()].filter(identity => identity.member_id === a[0]).map(identity => ({ provider: identity.provider })) };
        }
        throw new Error("Unexpected SQL all: " + sql);
      },
      async first() {
        const q = sql.trim().toLowerCase();
        const a = this.args;
        if (q.startsWith("select count from community_rate_limits")) return { count: db.rates.get(a[0]) || 0 };
        if (q.includes("from community_sessions s join community_members m")) {
          const session = db.sessions.get(a[0]);
          if (!session || session.expires_at <= a[1]) return null;
          const member = db.members.get(session.member_id);
          return member ? { id: member.id, username: member.username, display_name: member.display_name, created_at: member.created_at } : null;
        }
        if (q.includes("from community_oauth_accounts a") && q.includes("join community_members")) {
          const identity = db.identities.get(a[0] + ":" + a[1]);
          if (!identity) return null;
          const m = db.members.get(identity.member_id);
          return m ? { id: m.id, username: m.username, email: m.email, display_name: m.display_name, created_at: m.created_at } : null;
        }
        if (q.startsWith("select id, username, email, display_name, email_verified_at, created_at from community_members where email")) {
          return [...db.members.values()].find(m => m.email.toLowerCase() === String(a[0]).toLowerCase()) || null;
        }
        if (q.startsWith("select id, username, email, display_name, created_at, email_verified_at from community_members where id")) {
          const m = db.members.get(a[0]);
          return m ? { id: m.id, username: m.username, email: m.email, display_name: m.display_name, created_at: m.created_at, email_verified_at: m.email_verified_at } : null;
        }
        throw new Error("Unexpected SQL first: " + sql);
      },
    };
  }
}

function cookiesFrom(response) {
  const all = response.headers.getSetCookie?.() || [response.headers.get("set-cookie") || ""];
  return all.filter(Boolean).map(value => value.split(";")[0]);
}
function cookieValue(response, name) {
  const line = cookiesFrom(response).find(value => value.startsWith(name + "="));
  return line ? line.slice(name.length + 1) : "";
}
async function assertLiveSessionCookie(response, expectedMemberId, env) {
  const token = cookieValue(response, "__Host-ai_community");
  assert.ok(token.length >= 40, "OAuth callback must issue a session cookie");
  const me = await worker.fetch(new Request(origin + "/api/community/me", {
    headers: { Cookie: "__Host-ai_community=" + token },
  }), env);
  assert.equal(me.status, 200);
  const payload = await me.json();
  assert.equal(payload.member?.id, expectedMemberId, "GET /me must resolve the callback-issued cookie");
  assert.equal(payload.member?.username?.length > 0, true);
  return token;
}

const db = new MockD1();
const originalFetch = globalThis.fetch;
const calls = [];
let googleEmailVerified = true;
let googleNonce = "";
const googleKeyPair = await webcrypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"],
);
const googleJwk = await webcrypto.subtle.exportKey("jwk", googleKeyPair.publicKey);
Object.assign(googleJwk, { kid: "staging-test-key", alg: "RS256", use: "sig" });
const b64url = value => Buffer.from(value).toString("base64url");
async function makeGoogleIdToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "staging-test-key" }));
  const claims = b64url(JSON.stringify({
    iss: "https://accounts.google.com",
    aud: "google-client-id.apps.googleusercontent.com",
    sub: "google-user-1",
    email: "google@example.test",
    email_verified: googleEmailVerified,
    name: "Google Tester",
    iat: now,
    exp: now + 300,
    nonce: googleNonce,
  }));
  const input = header + "." + claims;
  const signature = await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", googleKeyPair.privateKey, new TextEncoder().encode(input));
  return input + "." + b64url(new Uint8Array(signature));
}
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  calls.push({ url: url.toString(), method: init.method || "GET" });
  if (url.hostname === "oauth2.googleapis.com") {
    const body = new URLSearchParams(init.body || "");
    assert.ok(body.get("code_verifier")?.length >= 43, "Google token exchange must send the PKCE verifier");
    return Response.json({ access_token: "google-test-access-token", id_token: await makeGoogleIdToken(), token_type: "Bearer" });
  }
  if (url.hostname === "accounts.google.com" && url.pathname === "/.well-known/openid-configuration") {
    return Response.json({ issuer: "https://accounts.google.com", jwks_uri: "https://www.googleapis.com/oauth2/v3/certs" });
  }
  if (url.hostname === "www.googleapis.com" && url.pathname === "/oauth2/v3/certs") {
    return Response.json({ keys: [googleJwk] });
  }
  throw new Error("Unexpected external request: " + url.hostname);
};

try {
  const env = {
    DB: db,
    GOOGLE_OAUTH_CLIENT_ID: "google-client-id.apps.googleusercontent.com",
    GOOGLE_OAUTH_CLIENT_SECRET: "google-client-secret-test",
  };

  const ready = await worker.fetch(new Request(origin + "/api/community/oauth/providers"), env);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { google: true, facebook: false });
  console.log("PASS provider readiness exposes booleans only");

  const anonymousProfile = await worker.fetch(new Request(origin + "/api/community/account"), env);
  assert.equal(anonymousProfile.status, 401);
  console.log("PASS account profile endpoint requires an authenticated session");

  const missingCredentialsEnv = { DB: db };
  const missingProviders = await worker.fetch(new Request(origin + "/api/community/oauth/providers"), missingCredentialsEnv);
  assert.deepEqual(await missingProviders.json(), { google: false, facebook: false });
  const unavailableStart = await worker.fetch(new Request(origin + "/api/community/oauth/google/start"), missingCredentialsEnv);
  assert.equal(unavailableStart.status, 503);
  console.log("PASS missing OAuth credentials fail closed and expose no provider buttons");

  const googleStart = await worker.fetch(new Request(origin + "/api/community/oauth/google/start"), env);
  assert.equal(googleStart.status, 302);
  const googleAuthorize = new URL(googleStart.headers.get("Location"));
  assert.equal(googleAuthorize.hostname, "accounts.google.com");
  assert.equal(googleAuthorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(googleAuthorize.searchParams.get("scope"), "openid email profile");
  const googleState = cookieValue(googleStart, "__Host-ai_oauth_google_state");
  const googleVerifier = cookieValue(googleStart, "__Host-ai_oauth_google_verifier");
  googleNonce = cookieValue(googleStart, "__Host-ai_oauth_google_nonce");
  assert.ok(googleState && googleVerifier.length >= 43 && googleNonce.length >= 32);
  assert.equal(googleAuthorize.searchParams.get("nonce"), googleNonce);
  console.log("PASS Google authorization uses state and PKCE S256");

  const badGoogleState = await worker.fetch(new Request(origin + "/api/community/oauth/google/callback?code=test-code&state=wrong", {
    headers: { Cookie: "__Host-ai_oauth_google_state=" + googleState + "; __Host-ai_oauth_google_verifier=" + googleVerifier + "; __Host-ai_oauth_google_nonce=" + googleNonce },
  }), env);
  assert.equal(badGoogleState.status, 302);
  assert.match(badGoogleState.headers.get("Location"), /oauth=OAUTH_STATE_INVALID/);
  assert.equal(calls.length, 0);
  console.log("PASS invalid Google state is rejected before token exchange");

  const cancelledGoogle = await worker.fetch(new Request(origin + "/api/community/oauth/google/callback?error=access_denied&state=" + encodeURIComponent(googleState), {
    headers: { Cookie: "__Host-ai_oauth_google_state=" + googleState + "; __Host-ai_oauth_google_verifier=" + googleVerifier },
  }), env);
  assert.match(cancelledGoogle.headers.get("Location"), /oauth=cancelled/);
  assert.equal(calls.length, 0);
  console.log("PASS Google provider cancellation returns safely without token exchange");

  // A Google email with the explicit email_verified claim may link to an existing member.
  const existingGoogleMember = {
    id: "existing-google-email-member",
    username: "existing_google",
    email: "google@example.test",
    display_name: "Existing Google member",
    password_salt: "existing-salt",
    password_hash: "existing-google-hash",
    created_at: "2026-01-01T00:00:00.000Z",
    email_verified_at: null,
  };
  db.members.set(existingGoogleMember.id, { ...existingGoogleMember });

  const googleCallback = await worker.fetch(new Request(origin + "/api/community/oauth/google/callback?code=google-test-code&state=" + encodeURIComponent(googleState), {
    headers: { Cookie: "__Host-ai_oauth_google_state=" + googleState + "; __Host-ai_oauth_google_verifier=" + googleVerifier + "; __Host-ai_oauth_google_nonce=" + googleNonce },
  }), env);
  assert.equal(googleCallback.status, 302);
  assert.match(googleCallback.headers.get("Location"), /oauth=success/);
  assert.match(googleCallback.headers.get("Location"), /provider=google/);
  assert.equal(db.members.size, 1);
  assert.equal(db.identities.size, 1);
  const googleIdentity = db.identities.get("google:google-user-1");
  assert.ok(googleIdentity);
  assert.equal(googleIdentity.member_id, existingGoogleMember.id);
  assert.ok(db.members.get(existingGoogleMember.id).email_verified_at);
  assert.equal(db.members.get(existingGoogleMember.id).password_hash, "existing-google-hash");
  assert.ok(cookiesFrom(googleCallback).some(value => value.startsWith("__Host-ai_community=")));
  const googleSessionToken = await assertLiveSessionCookie(googleCallback, existingGoogleMember.id, env);
  console.log("PASS Google callback cookie is accepted by GET /me and resolves the expected member");

  const profileResponse = await worker.fetch(new Request(origin + "/api/community/account", {
    headers: { Cookie: "__Host-ai_community=" + googleSessionToken },
  }), env);
  assert.equal(profileResponse.status, 200);
  const profilePayload = await profileResponse.json();
  assert.equal(profilePayload.account?.id, existingGoogleMember.id);
  assert.equal(profilePayload.account?.email, "google@example.test");
  assert.equal(profilePayload.account?.emailVerified, true);
  assert.deepEqual(profilePayload.account?.linkedProviders, ["google"]);
  assert.equal(Object.hasOwn(profilePayload.account || {}, "passwordHash"), false);
  assert.equal(Object.hasOwn(profilePayload.account || {}, "password_hash"), false);
  console.log("PASS authenticated profile returns one member, verified email and linked Google provider without credentials");

  const repeatGoogleStart = await worker.fetch(new Request(origin + "/api/community/oauth/google/start"), env);
  const repeatGoogleState = cookieValue(repeatGoogleStart, "__Host-ai_oauth_google_state");
  const repeatGoogleVerifier = cookieValue(repeatGoogleStart, "__Host-ai_oauth_google_verifier");
  googleNonce = cookieValue(repeatGoogleStart, "__Host-ai_oauth_google_nonce");
  const repeatGoogleCallback = await worker.fetch(new Request(origin + "/api/community/oauth/google/callback?code=google-repeat-code&state=" + encodeURIComponent(repeatGoogleState), {
    headers: { Cookie: "__Host-ai_oauth_google_state=" + repeatGoogleState + "; __Host-ai_oauth_google_verifier=" + repeatGoogleVerifier + "; __Host-ai_oauth_google_nonce=" + googleNonce },
  }), env);
  assert.match(repeatGoogleCallback.headers.get("Location"), /oauth=success/);
  assert.equal(db.members.size, 1);
  assert.equal(db.identities.size, 1);
  assert.equal(db.identities.get("google:google-user-1").member_id, existingGoogleMember.id);
  console.log("PASS repeat Google login reuses the existing provider-linked member");

  googleEmailVerified = false;
  const unverifiedGoogleStart = await worker.fetch(new Request(origin + "/api/community/oauth/google/start"), env);
  const unverifiedGoogleState = cookieValue(unverifiedGoogleStart, "__Host-ai_oauth_google_state");
  const unverifiedGoogleVerifier = cookieValue(unverifiedGoogleStart, "__Host-ai_oauth_google_verifier");
  googleNonce = cookieValue(unverifiedGoogleStart, "__Host-ai_oauth_google_nonce");
  const unverifiedGoogleCallback = await worker.fetch(new Request(origin + "/api/community/oauth/google/callback?code=google-unverified-code&state=" + encodeURIComponent(unverifiedGoogleState), {
    headers: { Cookie: "__Host-ai_oauth_google_state=" + unverifiedGoogleState + "; __Host-ai_oauth_google_verifier=" + unverifiedGoogleVerifier + "; __Host-ai_oauth_google_nonce=" + googleNonce },
  }), env);
  assert.match(unverifiedGoogleCallback.headers.get("Location"), /oauth=OAUTH_USERINFO_FAILED/);
  assert.equal(db.members.size, 1);
  assert.equal(db.identities.size, 1);
  googleEmailVerified = true;
  console.log("PASS Google email without email_verified=true is rejected without linking or creating a member");

  // Network exceptions at Google's token endpoint must be converted to a safe,
  // stable error code without leaking exception details into the redirect.
  for (const [label, error, expectedCode] of [
    ["connection failure", new TypeError("simulated network failure with private detail"), "OAUTH_GOOGLE_ENDPOINT_UNREACHABLE"],
    ["timeout", Object.assign(new Error("simulated timeout with private detail"), { name: "TimeoutError" }), "OAUTH_TOKEN_TIMEOUT"],
  ]) {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.hostname === "oauth2.googleapis.com") throw error;
      throw new Error("Unexpected request after token exchange failure");
    };
    const start = await worker.fetch(new Request(origin + "/api/community/oauth/google/start"), env);
    const state = cookieValue(start, "__Host-ai_oauth_google_state");
    const verifier = cookieValue(start, "__Host-ai_oauth_google_verifier");
    const callback = await worker.fetch(new Request(origin + "/api/community/oauth/google/callback?code=network-test&state=" + encodeURIComponent(state), {
      headers: { Cookie: "__Host-ai_oauth_google_state=" + state + "; __Host-ai_oauth_google_verifier=" + verifier },
    }), env);
    const location = callback.headers.get("Location");
    assert.match(location, new RegExp("oauth=" + expectedCode));
    assert.equal(location.includes("private"), false);
    console.log("PASS Google token endpoint " + label + " maps to sanitized " + expectedCode);
  }

  // A credential-free GET returning any HTTP status proves the endpoint is reachable.
  let probeCalls = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname !== "oauth2.googleapis.com") throw new Error("Unexpected probe host");
    probeCalls++;
    if (init.method === "POST") throw new TypeError("simulated primary request failure");
    assert.equal(init.method, "GET");
    return new Response(null, { status: 405 });
  };
  const probeStart = await worker.fetch(new Request(origin + "/api/community/oauth/google/start"), env);
  const probeState = cookieValue(probeStart, "__Host-ai_oauth_google_state");
  const probeVerifier = cookieValue(probeStart, "__Host-ai_oauth_google_verifier");
  const probeCallback = await worker.fetch(new Request(origin + "/api/community/oauth/google/callback?code=probe-test&state=" + encodeURIComponent(probeState), {
    headers: { Cookie: "__Host-ai_oauth_google_state=" + probeState + "; __Host-ai_oauth_google_verifier=" + probeVerifier },
  }), env);
  assert.match(probeCallback.headers.get("Location"), /oauth=OAUTH_TOKEN_REQUEST_FAILED/);
  assert.equal(probeCalls, 2);
  console.log("PASS Google endpoint HTTP response distinguishes reachable endpoint from network failure");

  // Provider HTTP errors are distinct from transport failures.
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ error: "invalid_client", error_description: "must never be exposed" }, { status: 401 });
    throw new Error("Unexpected request after provider rejection");
  };
  const invalidClientStart = await worker.fetch(new Request(origin + "/api/community/oauth/google/start"), env);
  const invalidClientState = cookieValue(invalidClientStart, "__Host-ai_oauth_google_state");
  const invalidClientVerifier = cookieValue(invalidClientStart, "__Host-ai_oauth_google_verifier");
  const invalidClientCallback = await worker.fetch(new Request(origin + "/api/community/oauth/google/callback?code=invalid-client-test&state=" + encodeURIComponent(invalidClientState), {
    headers: { Cookie: "__Host-ai_oauth_google_state=" + invalidClientState + "; __Host-ai_oauth_google_verifier=" + invalidClientVerifier },
  }), env);
  assert.match(invalidClientCallback.headers.get("Location"), /oauth=OAUTH_GOOGLE_INVALID_CLIENT/);
  assert.equal(invalidClientCallback.headers.get("Location").includes("must%20never"), false);
  console.log("PASS Google invalid_client HTTP response remains distinct and sanitized");

  // A missing PKCE verifier is rejected before any provider request.
  let unexpectedProviderCalls = 0;
  globalThis.fetch = async () => {
    unexpectedProviderCalls += 1;
    throw new Error("Provider must not be called without a verifier");
  };
  const missingVerifierStart = await worker.fetch(new Request(origin + "/api/community/oauth/google/start"), env);
  const missingVerifierState = cookieValue(missingVerifierStart, "__Host-ai_oauth_google_state");
  const missingVerifierCallback = await worker.fetch(new Request(origin + "/api/community/oauth/google/callback?code=missing-verifier-test&state=" + encodeURIComponent(missingVerifierState), {
    headers: { Cookie: "__Host-ai_oauth_google_state=" + missingVerifierState },
  }), env);
  assert.match(missingVerifierCallback.headers.get("Location"), /oauth=OAUTH_VERIFIER_MISSING/);
  assert.equal(unexpectedProviderCalls, 0);
  console.log("PASS missing Google PKCE verifier is rejected before token exchange");
} finally {
  globalThis.fetch = originalFetch;
}

console.log("All social-auth tests passed. Tests use mocked providers and an in-memory D1 adapter; no real OAuth accounts, secrets or live database are used.");
