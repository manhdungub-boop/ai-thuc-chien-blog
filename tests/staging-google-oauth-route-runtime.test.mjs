import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker from "../worker.mjs";

const STAGING = "https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev";
const CLIENT_ID = "test-client.apps.googleusercontent.com";
const CLIENT_SECRET = "test-client-secret-not-real";
const originalFetch = globalThis.fetch;
const b64url = (value) => Buffer.from(value).toString("base64url");
const jsonPart = (value) => b64url(JSON.stringify(value));
let keyPair;
let publicJwk;
let db;
let networkCalls;
let lastTokenBody;
let nonceOverride;

class FakeD1 {
  constructor() {
    this.members = new Map();
    this.oauthAccounts = new Map();
    this.sessions = new Map();
    this.rateLimits = new Map();
  }

  prepare(sql) {
    const database = this;
    return {
      bind(...values) {
        return {
          async first() {
            if (sql.includes("SELECT count FROM community_rate_limits")) {
              return { count: database.rateLimits.get(values[0]) || 0 };
            }
            if (sql.includes("FROM community_oauth_accounts a JOIN community_members m")) {
              const linked = database.oauthAccounts.get(values[0] + ":" + values[1]);
              return linked ? database.members.get(linked.memberId) || null : null;
            }
            if (sql.includes("FROM community_members WHERE email = ?")) {
              return [...database.members.values()].find((member) => member.email === values[0]) || null;
            }
            if (sql.includes("FROM community_sessions s JOIN community_members m")) {
              const session = [...database.sessions.values()].find((item) =>
                item.token_hash === values[0] && item.expires_at > values[1]);
              const member = session && database.members.get(session.member_id);
              return member && member.email_verified_at
                ? { id: member.id, username: member.username, display_name: member.display_name, created_at: member.created_at }
                : null;
            }
            throw new Error("Unexpected FakeD1 first() SQL: " + sql);
          },
          async run() {
            if (sql.includes("INSERT INTO community_rate_limits")) {
              const bucket = values[0];
              database.rateLimits.set(bucket, (database.rateLimits.get(bucket) || 0) + 1);
              return { success: true, meta: { changes: 1 } };
            }
            if (sql.includes("INSERT INTO community_members")) {
              const [id, username, email, display_name, password_salt, password_hash, created_at, email_verified_at] = values;
              if ([...database.members.values()].some((member) => member.email === email || member.username === username)) {
                throw new Error("UNIQUE constraint failed: community_members.email");
              }
              database.members.set(id, { id, username, email, display_name, password_salt, password_hash, created_at, email_verified_at });
              return { success: true, meta: { changes: 1 } };
            }
            if (sql.includes("UPDATE community_members SET email_verified_at")) {
              const member = database.members.get(values[1]);
              if (member && !member.email_verified_at) member.email_verified_at = values[0];
              return { success: true, meta: { changes: 1 } };
            }
            if (sql.includes("INSERT INTO community_oauth_accounts")) {
              const [provider, providerUserId, memberId, email, createdAt] = values;
              const key = provider + ":" + providerUserId;
              if (!database.oauthAccounts.has(key)) database.oauthAccounts.set(key, { provider, providerUser_id: providerUserId, memberId, email, createdAt });
              return { success: true, meta: { changes: 1 } };
            }
            if (sql.includes("DELETE FROM community_sessions WHERE expires_at")) {
              for (const [id, session] of database.sessions) if (session.expires_at <= values[0]) database.sessions.delete(id);
              return { success: true, meta: { changes: 0 } };
            }
            if (sql.includes("INSERT INTO community_sessions")) {
              const [id, member_id, token_hash, created_at, expires_at] = values;
              database.sessions.set(id, { id, member_id, token_hash, created_at, expires_at });
              return { success: true, meta: { changes: 1 } };
            }
            if (sql.includes("DELETE FROM community_sessions WHERE token_hash")) {
              for (const [id, session] of database.sessions) if (session.token_hash === values[0]) database.sessions.delete(id);
              return { success: true, meta: { changes: 1 } };
            }
            throw new Error("Unexpected FakeD1 run() SQL: " + sql);
          },
        };
      },
    };
  }
}

async function makeIdToken(nonce, overrides = {}) {
  const header = { alg: "RS256", typ: "JWT", kid: "runtime-test-key" };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    sub: "google-subject-runtime-001",
    email: "runtime.user@example.com",
    email_verified: true,
    name: "Runtime Test User",
    iat: now,
    exp: now + 300,
    nonce,
    ...overrides,
  };
  const input = jsonPart(header) + "." + jsonPart(claims);
  const signature = await webcrypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(input),
  );
  return input + "." + b64url(new Uint8Array(signature));
}

function cookiesFrom(response) {
  return response.headers.getSetCookie();
}
function cookieValue(cookie) {
  return cookie.slice(cookie.indexOf("=") + 1).split(";")[0];
}
function cookieName(cookie) {
  return cookie.slice(0, cookie.indexOf("="));
}
function findCookie(cookies, name) {
  const cookie = cookies.find((value) => cookieName(value) === name);
  assert.ok(cookie, "Expected cookie " + name);
  return cookieValue(cookie);
}
function cookieHeader(cookies) {
  return cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

async function makeFixture({ tokenOverrides = {} } = {}) {
  db = new FakeD1();
  networkCalls = [];
  lastTokenBody = null;
  nonceOverride = tokenOverrides;
  keyPair = await webcrypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  publicJwk = await webcrypto.subtle.exportKey("jwk", keyPair.publicKey);
  Object.assign(publicJwk, { kid: "runtime-test-key", alg: "RS256", use: "sig" });

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    networkCalls.push({ url, method: init.method || "GET" });
    if (url === "https://oauth2.googleapis.com/token") {
      assert.equal(init.method, "POST");
      lastTokenBody = new URLSearchParams(init.body);
      const nonce = nonceOverride.nonce || nonceOverride.expectedNonce;
      const idToken = await makeIdToken(nonce, nonceOverride);
      return new Response(JSON.stringify({ access_token: "mock-access-token", token_type: "Bearer", expires_in: 3600, id_token: idToken }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "https://accounts.google.com/.well-known/openid-configuration") {
      return new Response(JSON.stringify({
        issuer: "https://accounts.google.com",
        jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "https://www.googleapis.com/oauth2/v3/certs") {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error("Unexpected outbound request: " + url);
  };

  return { DB: db, GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: CLIENT_SECRET };
}

async function startOAuth(env) {
  const response = await worker.fetch(new Request(STAGING + "/api/community/oauth/google/start", {
    method: "GET",
    headers: { "CF-Connecting-IP": "192.0.2.10" },
  }), env);
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("Location"));
  const cookies = cookiesFrom(response);
  const state = location.searchParams.get("state");
  assert.ok(state, "Expected transaction state in the authorization URL");
  const verifier = findCookie(cookies, "__Host-ai_oauth_google_verifier_" + state);
  const nonce = findCookie(cookies, "__Host-ai_oauth_google_nonce_" + state);
  assert.equal(findCookie(cookies, "__Host-ai_oauth_google_state_" + state), state);
  nonceOverride.expectedNonce = nonce;
  assert.equal(location.searchParams.get("state"), state);
  assert.equal(location.searchParams.get("nonce"), nonce);
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  const challenge = b64url(new Uint8Array(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  assert.equal(location.searchParams.get("code_challenge"), challenge);
  for (const cookie of cookies) {
    assert.match(cookie, /; Path=\//);
    assert.match(cookie, /; HttpOnly/);
    assert.match(cookie, /; Secure/);
    assert.match(cookie, /; SameSite=Lax/);
  }
  return { cookies, state, verifier, nonce };
}

test.before(async () => {
  // Ensure the test uses a real cryptographic key pair but never a Google credential.
  await webcrypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
});


test("links a verified Google identity to an existing email account without replacing its password", async () => {
  const env = await makeFixture();
  const originalPasswordHash = "pre-existing-password-hash";
  db.members.set("existing-member-001", {
    id: "existing-member-001",
    username: "existing_member",
    email: "runtime.user@example.com",
    display_name: "Existing Member",
    password_salt: "existing-salt",
    password_hash: originalPasswordHash,
    created_at: "2026-01-01T00:00:00.000Z",
    email_verified_at: null,
  });
  const started = await startOAuth(env);
  const callback = new URL(STAGING + "/api/community/oauth/google/callback");
  callback.searchParams.set("code", "mock-link-existing-account");
  callback.searchParams.set("state", started.state);
  const response = await worker.fetch(new Request(callback, {
    headers: {
      Cookie: cookieHeader(started.cookies),
      "CF-Connecting-IP": "192.0.2.13",
    },
  }), env);

  assert.equal(response.status, 302);
  assert.match(response.headers.get("Location"), /oauth=success/);
  assert.equal(db.members.size, 1);
  const member = db.members.get("existing-member-001");
  assert.ok(member.email_verified_at, "verified Google email should verify the existing account");
  assert.equal(member.password_hash, originalPasswordHash, "OAuth linking must not replace password credentials");
  assert.equal(db.oauthAccounts.size, 1);
  assert.equal([...db.oauthAccounts.values()][0].memberId, "existing-member-001");
  assert.equal(db.sessions.size, 1);
});

test.after(() => {
  globalThis.fetch = originalFetch;
});

test("runs Google OAuth start -> callback -> D1 identity/session -> authenticated /me", async () => {
  const env = await makeFixture();
  const started = await startOAuth(env);
  const callback = new URL(STAGING + "/api/community/oauth/google/callback");
  callback.searchParams.set("code", "mock-one-time-authorization-code");
  callback.searchParams.set("state", started.state);
  const response = await worker.fetch(new Request(callback, {
    headers: {
      Cookie: cookieHeader(started.cookies),
      "CF-Connecting-IP": "192.0.2.10",
    },
  }), env);

  assert.equal(response.status, 302);
  assert.match(response.headers.get("Location"), /oauth=success/);
  assert.equal(lastTokenBody.get("code_verifier"), started.verifier);
  assert.equal(lastTokenBody.get("code"), "mock-one-time-authorization-code");
  assert.equal(db.members.size, 1);
  assert.equal(db.oauthAccounts.size, 1);
  assert.equal(db.sessions.size, 1);

  const responseCookies = cookiesFrom(response);
  for (const part of ["state", "verifier", "nonce"]) {
    const name = "__Host-ai_oauth_google_" + part + "_" + started.state;
    const cleared = responseCookies.find((cookie) => cookieName(cookie) === name);
    assert.ok(cleared, "Expected cleared cookie " + name);
    assert.match(cleared, /Max-Age=0/);
  }
  const sessionCookie = responseCookies.find((cookie) => !cookie.startsWith("__Host-ai_oauth_"));
  assert.ok(sessionCookie, "Expected authenticated session cookie");
  assert.match(sessionCookie, /; HttpOnly/);
  assert.match(sessionCookie, /; Secure/);
  assert.match(sessionCookie, /; SameSite=Lax/);

  const me = await worker.fetch(new Request(STAGING + "/api/community/me", {
    headers: { Cookie: sessionCookie.split(";")[0] },
  }), env);
  assert.equal(me.status, 200);
  const payload = await me.json();
  assert.equal(payload.member.email, undefined);
  assert.equal(payload.member.username.startsWith("runtime_user"), true);
  assert.equal(payload.member.displayName, "Runtime Test User");
  assert.equal(networkCalls.filter((call) => call.url === "https://oauth2.googleapis.com/token").length, 1);
});

test("keeps overlapping Google OAuth transactions independent when the first callback fails or completes", async () => {
  const env = await makeFixture();
  const first = await startOAuth(env);
  const second = await startOAuth(env);
  assert.notEqual(first.state, second.state);
  assert.notEqual(cookieName(first.cookies[0]), cookieName(second.cookies[0]));

  // A mismatched callback must not clear either active transaction's cookies.
  const invalidCallback = new URL(STAGING + "/api/community/oauth/google/callback");
  invalidCallback.searchParams.set("code", "must-not-be-exchanged");
  invalidCallback.searchParams.set("state", "attacker-controlled-state");
  const invalidResponse = await worker.fetch(new Request(invalidCallback, {
    headers: {
      Cookie: cookieHeader([...first.cookies, ...second.cookies]),
      "CF-Connecting-IP": "192.0.2.16",
    },
  }), env);
  assert.equal(invalidResponse.status, 302);
  assert.match(invalidResponse.headers.get("Location"), /OAUTH_STATE_INVALID/);
  assert.equal(cookiesFrom(invalidResponse).filter((cookie) => /Max-Age=0/.test(cookie)).length, 0);
  assert.equal(networkCalls.filter((call) => call.url === "https://oauth2.googleapis.com/token").length, 0);

  // Complete the first transaction while both transactions' cookies are present.
  nonceOverride.expectedNonce = first.nonce;
  const firstCallback = new URL(STAGING + "/api/community/oauth/google/callback");
  firstCallback.searchParams.set("code", "mock-first-overlapping-code");
  firstCallback.searchParams.set("state", first.state);
  const firstResponse = await worker.fetch(new Request(firstCallback, {
    headers: {
      Cookie: cookieHeader([...first.cookies, ...second.cookies]),
      "CF-Connecting-IP": "192.0.2.14",
    },
  }), env);
  assert.equal(firstResponse.status, 302);
  assert.match(firstResponse.headers.get("Location"), /oauth=success/);
  assert.equal(lastTokenBody.get("code_verifier"), first.verifier);
  assert.equal(lastTokenBody.get("code"), "mock-first-overlapping-code");

  const firstCleared = cookiesFrom(firstResponse).filter((cookie) => /Max-Age=0/.test(cookie));
  assert.equal(firstCleared.length, 3);
  const firstClearedNames = new Set(firstCleared.map(cookieName));
  for (const part of ["state", "verifier", "nonce"]) {
    assert.ok(firstClearedNames.has("__Host-ai_oauth_google_" + part + "_" + first.state));
    assert.ok(!firstClearedNames.has("__Host-ai_oauth_google_" + part + "_" + second.state));
  }

  // Applying the first response's Set-Cookie headers leaves the second flow intact.
  const remainingCookies = [...first.cookies, ...second.cookies]
    .filter((cookie) => !firstClearedNames.has(cookieName(cookie)));
  nonceOverride.expectedNonce = second.nonce;
  const secondCallback = new URL(STAGING + "/api/community/oauth/google/callback");
  secondCallback.searchParams.set("code", "mock-second-overlapping-code");
  secondCallback.searchParams.set("state", second.state);
  const secondResponse = await worker.fetch(new Request(secondCallback, {
    headers: {
      Cookie: cookieHeader(remainingCookies),
      "CF-Connecting-IP": "192.0.2.15",
    },
  }), env);
  assert.equal(secondResponse.status, 302);
  assert.match(secondResponse.headers.get("Location"), /oauth=success/);
  assert.equal(lastTokenBody.get("code_verifier"), second.verifier);
  assert.equal(lastTokenBody.get("code"), "mock-second-overlapping-code");
  assert.equal(db.sessions.size, 2);
  assert.equal(db.oauthAccounts.size, 1);
});

test("rejects a callback with mismatched state before contacting Google or creating data", async () => {
  const env = await makeFixture();
  const started = await startOAuth(env);
  const callback = new URL(STAGING + "/api/community/oauth/google/callback");
  callback.searchParams.set("code", "must-not-be-exchanged");
  callback.searchParams.set("state", "attacker-controlled-state");
  const response = await worker.fetch(new Request(callback, {
    headers: {
      Cookie: cookieHeader(started.cookies),
      "CF-Connecting-IP": "192.0.2.11",
    },
  }), env);

  assert.equal(response.status, 302);
  assert.match(response.headers.get("Location"), /OAUTH_STATE_INVALID/);
  assert.equal(cookiesFrom(response).filter((cookie) => /Max-Age=0/.test(cookie)).length, 0,
    "A callback without its matching transaction cookie must not clear an active flow");
  assert.equal(networkCalls.filter((call) => call.url === "https://oauth2.googleapis.com/token").length, 0);
  assert.equal(db.members.size, 0);
  assert.equal(db.oauthAccounts.size, 0);
  assert.equal(db.sessions.size, 0);
});

test("rejects a nonce mismatch without persisting an identity or issuing a session", async () => {
  const env = await makeFixture({ tokenOverrides: { nonce: "wrong-nonce" } });
  const started = await startOAuth(env);
  const callback = new URL(STAGING + "/api/community/oauth/google/callback");
  callback.searchParams.set("code", "mock-code-with-wrong-nonce");
  callback.searchParams.set("state", started.state);
  const response = await worker.fetch(new Request(callback, {
    headers: {
      Cookie: cookieHeader(started.cookies),
      "CF-Connecting-IP": "192.0.2.12",
    },
  }), env);

  assert.equal(response.status, 302);
  assert.match(response.headers.get("Location"), /OAUTH_USERINFO_FAILED/);
  assert.equal(db.members.size, 0);
  assert.equal(db.oauthAccounts.size, 0);
  assert.equal(db.sessions.size, 0);
  assert.equal(cookiesFrom(response).filter((cookie) => /Max-Age=0/.test(cookie)).length, 3);
});

test("logout revokes the server-side session and rejects the old cookie", async () => {
  const env = await makeFixture();
  const started = await startOAuth(env);
  const callback = new URL(STAGING + "/api/community/oauth/google/callback");
  callback.searchParams.set("code", "mock-logout-authorization-code");
  callback.searchParams.set("state", started.state);
  const callbackResponse = await worker.fetch(new Request(callback, {
    headers: {
      Cookie: cookieHeader(started.cookies),
      "CF-Connecting-IP": "192.0.2.21",
    },
  }), env);
  assert.equal(callbackResponse.status, 302);

  const sessionCookie = cookiesFrom(callbackResponse).find((cookie) => cookie.startsWith("__Host-ai_community="));
  assert.ok(sessionCookie, "OAuth callback should issue the authenticated session cookie");
  const oldCookieHeader = sessionCookie.split(";")[0];
  assert.equal(db.sessions.size, 1);

  const logout = await worker.fetch(new Request(STAGING + "/api/community/logout", {
    method: "POST",
    headers: {
      Cookie: oldCookieHeader,
      Origin: STAGING,
      "CF-Connecting-IP": "192.0.2.21",
    },
  }), env);
  assert.equal(logout.status, 200);
  assert.deepEqual(await logout.json(), { ok: true });
  const clearedSessionCookie = cookiesFrom(logout).find((cookie) => cookie.startsWith("__Host-ai_community="));
  assert.ok(clearedSessionCookie, "Logout should clear the browser session cookie");
  assert.match(clearedSessionCookie, /Max-Age=0/);
  assert.equal(db.sessions.size, 0, "Logout must revoke the session in D1, not only clear the browser cookie");

  const me = await worker.fetch(new Request(STAGING + "/api/community/me", {
    headers: { Cookie: oldCookieHeader },
  }), env);
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { member: null }, "The revoked cookie must not authenticate another request");
});

test("enforces the 30-day session expiry and rejects an expired session", async () => {
  const env = await makeFixture();
  const started = await startOAuth(env);
  const callback = new URL(STAGING + "/api/community/oauth/google/callback");
  callback.searchParams.set("code", "mock-expiry-authorization-code");
  callback.searchParams.set("state", started.state);
  const callbackResponse = await worker.fetch(new Request(callback, {
    headers: {
      Cookie: cookieHeader(started.cookies),
      "CF-Connecting-IP": "192.0.2.22",
    },
  }), env);
  assert.equal(callbackResponse.status, 302);

  const sessionCookie = cookiesFrom(callbackResponse).find((cookie) => cookie.startsWith("__Host-ai_community="));
  assert.ok(sessionCookie, "OAuth callback should issue the authenticated session cookie");
  const [session] = [...db.sessions.values()];
  assert.ok(session, "Expected a persisted session");
  assert.equal(
    Date.parse(session.expires_at) - Date.parse(session.created_at),
    30 * 24 * 60 * 60 * 1000,
    "Session lifetime must remain exactly 30 days",
  );

  session.expires_at = new Date(Date.now() - 1000).toISOString();
  const me = await worker.fetch(new Request(STAGING + "/api/community/me", {
    headers: { Cookie: sessionCookie.split(";")[0] },
  }), env);
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { member: null }, "An expired session must not authenticate");
});

