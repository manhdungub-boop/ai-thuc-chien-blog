import { DurableObject } from "cloudflare:workers";
import { verifyGoogleReviewerIdToken } from "./google-oidc-reviewer-verifier.mjs";

const TX_COOKIE = "__Host-ai_reviewer_tx";
const SESSION_COOKIE = "__Host-ai_reviewer_session";
const TX_TTL_SECONDS = 300;
const SESSION_TTL_SECONDS = 1800;
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-frame-options": "DENY" }
  });
}
function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromB64url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError("invalid_base64url");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}
function cookieValue(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return "";
}
function cookie(name, value, maxAge) {
  return name + "=" + value + "; Path=/; Max-Age=" + maxAge + "; Secure; HttpOnly; SameSite=Lax";
}
function clearCookie(name) {
  return name + "=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax";
}
function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return b64url(value);
}
async function digest(value) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}
async function signPayload(secret, payload) {
  const encoded = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return encoded + "." + b64url(await hmac(secret, encoded));
}
async function verifyPayload(secret, value) {
  if (typeof value !== "string" || value.length > 4096) return null;
  const parts = value.split(".");
  if (parts.length !== 2) return null;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("HMAC", key, fromB64url(parts[1]), new TextEncoder().encode(parts[0]));
    if (!valid) return null;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fromB64url(parts[0])));
  } catch { return null; }
}
function config(env) {
  const allowedEmails = typeof env.GOOGLE_REVIEWER_ALLOWED_EMAILS === "string"
    ? env.GOOGLE_REVIEWER_ALLOWED_EMAILS.split(",").map(x => x.trim().toLowerCase()).filter(Boolean)
    : [];
  const values = [env.GOOGLE_REVIEWER_CLIENT_ID, env.GOOGLE_REVIEWER_CLIENT_SECRET, env.GOOGLE_REVIEWER_REDIRECT_URI, env.GOOGLE_REVIEWER_STATE_SECRET, env.GOOGLE_REVIEWER_SESSION_SECRET];
  if (env.AGENT_REVIEWER_AUTH_ENABLED !== "true" || values.some(x => typeof x !== "string" || x.length < 32) ||
      !env.GOOGLE_REVIEWER_REDIRECT_URI.startsWith("https://") ||
      env.GOOGLE_REVIEWER_REDIRECT_URI.length > 512 ||
      env.GOOGLE_REVIEWER_CLIENT_ID.length > 512 ||
      allowedEmails.length !== 1 || allowedEmails[0].length > 254) return null;
  try {
    const uri = new URL(env.GOOGLE_REVIEWER_REDIRECT_URI);
    if (uri.protocol !== "https:" || uri.pathname !== "/auth/google/callback" || uri.search || uri.hash || uri.username || uri.password) return null;
    return { allowedEmails, redirectUri: uri.href, redirectOrigin: uri.origin };
  } catch { return null; }
}
function storeFrom(env) {
  return env.AGENT_REVIEWER_AUTH_STORE?.getByName("primary") || null;
}

export class AgentReviewerAuthStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS reviewer_auth_transactions (state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, nonce TEXT NOT NULL, code_verifier TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)");
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS reviewer_auth_transactions_expiry ON reviewer_auth_transactions(expires_at)");
  }
  createTransaction(stateHash, browserHash, nonce, codeVerifier, nowSeconds) {
    if (![stateHash, browserHash, nonce, codeVerifier].every(x => typeof x === "string" && x.length >= 32 && x.length <= 128) || !Number.isInteger(nowSeconds)) return { created: false };
    this.ctx.storage.sql.exec("DELETE FROM reviewer_auth_transactions WHERE expires_at <= ?", nowSeconds);
    const result = this.ctx.storage.sql.exec("INSERT OR IGNORE INTO reviewer_auth_transactions (state_hash,browser_hash,nonce,code_verifier,created_at,expires_at) VALUES (?,?,?,?,?,?)", stateHash, browserHash, nonce, codeVerifier, nowSeconds, nowSeconds + TX_TTL_SECONDS);
    return { created: result.rowsWritten === 1 };
  }
  consumeTransaction(stateHash, browserHash, nowSeconds) {
    const row = this.ctx.storage.sql.exec("SELECT * FROM reviewer_auth_transactions WHERE state_hash = ? AND browser_hash = ? AND expires_at > ?", stateHash, browserHash, nowSeconds).toArray()[0];
    this.ctx.storage.sql.exec("DELETE FROM reviewer_auth_transactions WHERE state_hash = ?", stateHash);
    if (!row) return null;
    return { nonce: row.nonce, code_verifier: row.code_verifier, created_at: row.created_at, expires_at: row.expires_at };
  }
}

export async function handleGoogleReviewerAuth(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!["/auth/google/start", "/auth/google/callback", "/auth/google/me", "/auth/google/logout"].includes(path)) return null;
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const cfg = config(env);
  if (!cfg) return json({ error: "reviewer_auth_not_configured" }, 503);
  if (url.origin !== cfg.redirectOrigin && path !== "/auth/google/start" && path !== "/auth/google/me" && path !== "/auth/google/logout") {
    return json({ error: "redirect_origin_mismatch" }, 400);
  }
  const store = storeFrom(env);
  if (!store) return json({ error: "reviewer_auth_store_unavailable" }, 503);
  const nowSeconds = Math.floor(now / 1000);

  if (path === "/auth/google/start") {
    if (url.origin !== cfg.redirectOrigin) return json({ error: "preview_origin_mismatch" }, 400);
    const state = randomToken();
    const binding = randomToken();
    const nonce = randomToken();
    const verifier = randomToken(48);
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const stateHash = await digest(state);
    const browserHash = await digest(binding);
    const created = await store.createTransaction(stateHash, browserHash, nonce, verifier, nowSeconds);
    if (!created?.created) return json({ error: "login_transaction_create_failed" }, 503);
    const signedBinding = await signPayload(env.GOOGLE_REVIEWER_STATE_SECRET, { binding, exp: nowSeconds + TX_TTL_SECONDS });
    const auth = new URL(GOOGLE_AUTH_URL);
    auth.search = new URLSearchParams({
      client_id: env.GOOGLE_REVIEWER_CLIENT_ID,
      redirect_uri: cfg.redirectUri,
      response_type: "code",
      scope: "openid email",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account"
    }).toString();
    return new Response(null, { status: 302, headers: { location: auth.href, "cache-control": "no-store", "set-cookie": cookie(TX_COOKIE, signedBinding, TX_TTL_SECONDS), "referrer-policy": "no-referrer" } });
  }

  if (path === "/auth/google/callback") {
    const state = url.searchParams.get("state") || "";
    const code = url.searchParams.get("code") || "";
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(state) || !/^[A-Za-z0-9\/_-]{1,2048}$/.test(code) || url.searchParams.has("error")) {
      return json({ error: "oauth_callback_rejected" }, 400);
    }
    const txCookie = await verifyPayload(env.GOOGLE_REVIEWER_STATE_SECRET, cookieValue(request, TX_COOKIE));
    if (!txCookie || typeof txCookie.binding !== "string" || !Number.isInteger(txCookie.exp) || txCookie.exp <= nowSeconds) {
      return json({ error: "login_transaction_cookie_invalid" }, 400, { "set-cookie": clearCookie(TX_COOKIE) });
    }
    const transaction = await store.consumeTransaction(await digest(state), await digest(txCookie.binding), nowSeconds);
    if (!transaction) return json({ error: "login_transaction_missing_or_replayed" }, 400);
    const tokenResponse = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_REVIEWER_CLIENT_ID,
        client_secret: env.GOOGLE_REVIEWER_CLIENT_SECRET,
        redirect_uri: cfg.redirectUri,
        grant_type: "authorization_code",
        code_verifier: transaction.code_verifier
      })
    });
    if (!tokenResponse.ok) return json({ error: "google_code_exchange_failed" }, 401);
    const tokenBody = await tokenResponse.json();
    const identity = await verifyGoogleReviewerIdToken(tokenBody?.id_token, {
      audience: env.GOOGLE_REVIEWER_CLIENT_ID,
      nonce: transaction.nonce,
      allowedEmails: cfg.allowedEmails,
      now,
      fetchImpl
    });
    if (!identity.ok) return json({ error: "google_identity_verification_failed", status: identity.status }, 401);
    const session = await signPayload(env.GOOGLE_REVIEWER_SESSION_SECRET, {
      provider: "google", sub: identity.reviewer.subject, email: identity.reviewer.email,
      reviewer_ref: identity.reviewer.reviewer_ref, iat: nowSeconds, exp: nowSeconds + SESSION_TTL_SECONDS
    });
    return new Response(null, { status: 302, headers: {
      location: cfg.redirectOrigin + "/",
      "cache-control": "no-store",
      "set-cookie": [cookie(SESSION_COOKIE, session, SESSION_TTL_SECONDS), clearCookie(TX_COOKIE)],
      "referrer-policy": "no-referrer"
    } });
  }

  if (path === "/auth/google/me") {
    const session = await verifyPayload(env.GOOGLE_REVIEWER_SESSION_SECRET, cookieValue(request, SESSION_COOKIE));
    if (!session || session.provider !== "google" || typeof session.sub !== "string" ||
        !cfg.allowedEmails.includes(session.email) || !Number.isInteger(session.exp) || session.exp <= nowSeconds ||
        !Number.isInteger(session.iat) || session.iat > nowSeconds + 60 || session.exp - session.iat > SESSION_TTL_SECONDS) {
      return json({ authenticated: false }, 401);
    }
    return json({ authenticated: true, reviewer: { provider: "google", subject: session.sub, email: session.email, reviewer_ref: session.reviewer_ref }, expires_at: new Date(session.exp * 1000).toISOString(), publication_authorized: false });
  }

  return new Response(null, { status: 204, headers: { "cache-control": "no-store", "set-cookie": [clearCookie(SESSION_COOKIE), clearCookie(TX_COOKIE)] } });
}
