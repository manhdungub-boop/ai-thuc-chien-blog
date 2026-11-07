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
  const state = findCookie(cookies, "__Host-ai_oauth_google_state");
  const verifier = findCookie(cookies, "__Host-ai_oauth_google_verifier");
  const nonce = findCookie(cookies, "__Host-ai_oauth_google_nonce");
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
  for (const name of ["__Host-ai_oauth_google_state", "__Host-ai_oauth_google_verifier", "__Host-ai_oauth_google_nonce"]) {
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
