import { readBoundedJsonResponse } from "./bounded-json-response.mjs";
import { verifyGoogleReviewerIdToken } from "./google-oidc-reviewer-verifier.mjs";

const TX_COOKIE = "__Host-ai_reviewer_tx";
const SESSION_COOKIE = "__Host-ai_reviewer_session";
const TX_TTL_SECONDS = 300;
const SESSION_TTL_SECONDS = 1800;
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-frame-options": "DENY", ...extraHeaders }
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
      allowedEmails.length !== 1 || !/^[^@\s]+@gmail\.com$/.test(allowedEmails[0]) || allowedEmails[0].length > 254 || env.GOOGLE_REVIEWER_STATE_SECRET === env.GOOGLE_REVIEWER_SESSION_SECRET) return null;
  try {
    const uri = new URL(env.GOOGLE_REVIEWER_REDIRECT_URI);
    if (uri.protocol !== "https:" || uri.hostname !== "ai-thuc-chien-agent-runtime-preview.manhdungub.workers.dev" || uri.pathname !== "/auth/google/callback" || uri.search || uri.hash || uri.username || uri.password) return null;
    return { allowedEmails, redirectUri: uri.href, redirectOrigin: uri.origin };
  } catch { return null; }
}
function storeFrom(env) {
  return env.AGENT_REVIEWER_AUTH_STORE?.getByName("primary") || null;
}

export function readGoogleReviewerSessionCookie(request) {
  return cookieValue(request, SESSION_COOKIE);
}

export async function verifyGoogleReviewerSessionToken(token, env, now = Date.now()) {
  const cfg = config(env);
  if (!cfg || typeof token !== "string" || !token) return { authenticated: false, status: "reviewer_auth_not_configured" };
  const session = await verifyPayload(env.GOOGLE_REVIEWER_SESSION_SECRET, token);
  const nowSeconds = Math.floor(now / 1000);
  if (!session || session.provider !== "google" || typeof session.sub !== "string" ||
      !cfg.allowedEmails.includes(session.email) || session.reviewer_ref !== "google:" + session.sub ||
      !Number.isInteger(session.exp) || session.exp <= nowSeconds ||
      !Number.isInteger(session.iat) || session.iat > nowSeconds + 60 ||
      session.exp - session.iat > SESSION_TTL_SECONDS) {
    return { authenticated: false, status: "reviewer_session_invalid" };
  }
  return {
    authenticated: true,
    reviewer: { provider: "google", subject: session.sub, email: session.email, reviewer_ref: session.reviewer_ref },
    expires_at: session.exp
  };
}

export async function handleGoogleReviewerAuth(request, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!["/auth/google/start", "/auth/google/callback", "/auth/google/me", "/auth/google/logout"].includes(path)) return null;
  const cfg = config(env);
  if (!cfg) return json({ error: "reviewer_auth_not_configured" }, 503);
  if (path === "/auth/google/logout") {
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { allow: "POST" });
    if (request.headers.get("origin") !== cfg.redirectOrigin) return json({ error: "logout_origin_rejected" }, 403);
    return new Response(null, { status: 204, headers: [
      ["cache-control", "no-store"],
      ["set-cookie", clearCookie(SESSION_COOKIE)],
      ["set-cookie", clearCookie(TX_COOKIE)]
    ] });
  }
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (url.origin !== cfg.redirectOrigin && path !== "/auth/google/start" && path !== "/auth/google/me" && path !== "/auth/google/logout") {
    return json({ error: "redirect_origin_mismatch" }, 400);
  }
  const store = storeFrom(env);
  if (!store) return json({ error: "reviewer_auth_store_unavailable" }, 503);
  const nowSeconds = Math.floor(now / 1000);

  if (path === "/auth/google/start") {
    if (url.origin !== cfg.redirectOrigin) return json({ error: "preview_origin_mismatch" }, 400);
    const fetchSite = request.headers.get("Sec-Fetch-Site");
    if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
      return json({ error: "login_start_cross_site_rejected" }, 403);
    }
    const requestOrigin = request.headers.get("Origin");
    if (requestOrigin && requestOrigin !== cfg.redirectOrigin) {
      return json({ error: "login_start_origin_rejected" }, 403);
    }
    const returnToValues = url.searchParams.getAll("return_to");
    if (returnToValues.length > 1) return json({ error: "login_return_path_rejected" }, 400);
    const returnPath = returnToValues.length === 0 ? "/" : returnToValues[0];
    if (!["/", "/reviewer-console", "/operator-console"].includes(returnPath)) {
      return json({ error: "login_return_path_rejected" }, 400);
    }
    const clientIp = request.headers.get("cf-connecting-ip") || "";
    if (!clientIp || clientIp.length > 45 || /[\s,]/.test(clientIp)) return json({ error: "client_ip_unavailable" }, 503);
    const clientRateLimitKey = await digest("google-reviewer-login-start:" + clientIp);
    const rateLimit = await store.consumeStartRateLimit(clientRateLimitKey, nowSeconds);
    if (!rateLimit.allowed) return json({ error: "login_start_rate_limited" }, 429, { "retry-after": String(rateLimit.retry_after_seconds) });
    const state = randomToken();
    const binding = randomToken();
    const nonce = randomToken();
    const verifier = randomToken(48);
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const stateHash = await digest(state);
    const browserHash = await digest(binding);
    const created = await store.createTransaction(stateHash, browserHash, nonce, verifier, nowSeconds, returnPath);
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
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(state) || !/^[^\x00-\x20\x7f]{1,2048}$/.test(code) || url.searchParams.has("error")) {
      return json({ error: "oauth_callback_rejected" }, 400);
    }
    const txCookie = await verifyPayload(env.GOOGLE_REVIEWER_STATE_SECRET, cookieValue(request, TX_COOKIE));
    if (!txCookie || typeof txCookie.binding !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(txCookie.binding) || !Number.isInteger(txCookie.exp) || txCookie.exp <= nowSeconds) {
      return json({ error: "login_transaction_cookie_invalid" }, 400, { "set-cookie": clearCookie(TX_COOKIE) });
    }
    const transaction = await store.consumeTransaction(await digest(state), await digest(txCookie.binding), nowSeconds);
    if (!transaction) return json({ error: "login_transaction_missing_or_replayed" }, 400);
    let tokenResponse;
    try {
      tokenResponse = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      redirect: "manual",
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
    } catch { return json({ error: "google_code_exchange_unavailable" }, 502); }
    if (!tokenResponse.ok) return json({ error: "google_code_exchange_failed" }, 401);
    let tokenBody;
    try { tokenBody = await readBoundedJsonResponse(tokenResponse, 32 * 1024); } catch { return json({ error: "google_token_response_invalid_or_too_large" }, 502); }
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
    return new Response(null, { status: 302, headers: [
      ["location", cfg.redirectOrigin + (["/reviewer-console", "/operator-console"].includes(transaction.return_path) ? transaction.return_path : "/")],
      ["cache-control", "no-store"],
      ["set-cookie", cookie(SESSION_COOKIE, session, SESSION_TTL_SECONDS)],
      ["set-cookie", clearCookie(TX_COOKIE)],
      ["referrer-policy", "no-referrer"]
    ] });
  }

  if (path === "/auth/google/me") {
    const verified = await verifyGoogleReviewerSessionToken(cookieValue(request, SESSION_COOKIE), env, now);
    if (!verified.authenticated) return json({ authenticated: false }, 401);
    return json({ authenticated: true, reviewer: verified.reviewer, expires_at: new Date(verified.expires_at * 1000).toISOString(), publication_authorized: false });
  }

  return json({ error: "not_found" }, 404);
}
