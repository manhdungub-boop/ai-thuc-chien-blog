import { readBoundedJsonResponse } from "./bounded-json-response.mjs";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const MAX_TOKEN_CHARS = 12_000;
const MAX_JWKS_KEYS = 20;
const ALLOWED_ALGORITHMS = new Set(["RS256"]);
const ACCEPTED_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError("invalid_base64url");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function decodeJsonSegment(value) {
  const bytes = decodeBase64Url(value);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function validString(value, max = 512) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function failure(status) {
  return { ok: false, status, reviewer_identity_authenticated: false };
}

/**
 * Verify a Google OpenID Connect ID token for one explicitly allowlisted reviewer.
 * The caller must supply the OAuth client ID, expected per-login nonce, and the
 * server-side allowlist. Never pass any of these values from an untrusted request body.
 *
 * This function verifies identity only. It does not create a session, record a review,
 * authorize publication, or grant deployment permissions.
 */
export async function verifyGoogleReviewerIdToken(token, {
  audience,
  nonce,
  allowedEmails,
  now = Date.now(),
  clockSkewSeconds = 60,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!validString(audience, 512) ||
      !validString(nonce, 256) ||
      !Array.isArray(allowedEmails) ||
      allowedEmails.length < 1 ||
      allowedEmails.length > 20 ||
      typeof fetchImpl !== "function" ||
      !Number.isFinite(now) ||
      !Number.isInteger(clockSkewSeconds) ||
      clockSkewSeconds < 0 ||
      clockSkewSeconds > 120) {
    return failure("google_oidc_configuration_invalid");
  }

  const allowlist = new Set(allowedEmails
    .filter(email => validString(email, 254))
    .map(email => email.trim().toLowerCase()));
  // Google is authoritative for Gmail mailbox ownership; a verified third-party address can later change owners.
  if (allowlist.size === 0 || [...allowlist].some(email => !/^[^@\s]+@gmail\.com$/.test(email))) {
    return failure("google_oidc_allowlist_invalid");
  }

  if (!validString(token, MAX_TOKEN_CHARS)) return failure("google_id_token_invalid");
  const parts = token.split(".");
  if (parts.length !== 3) return failure("google_id_token_invalid");

  let header;
  let claims;
  let signature;
  try {
    header = decodeJsonSegment(parts[0]);
    claims = decodeJsonSegment(parts[1]);
    signature = decodeBase64Url(parts[2]);
  } catch {
    return failure("google_id_token_malformed");
  }

  if (header?.alg !== "RS256" || !ALLOWED_ALGORITHMS.has(header.alg) ||
      !validString(header.kid, 256) || header.crit !== undefined) {
    return failure("google_id_token_header_rejected");
  }

  const nowSeconds = Math.floor(now / 1000);
  const skew = clockSkewSeconds;
  if (!ACCEPTED_ISSUERS.has(claims?.iss) ||
      !(claims?.aud === audience ||
        (Array.isArray(claims?.aud) && claims.aud.includes(audience))) ||
      (claims?.azp !== undefined && claims.azp !== audience) ||
      (Array.isArray(claims?.aud) && claims.aud.length > 1 && claims?.azp !== audience)) {
    return failure("google_id_token_issuer_or_audience_rejected");
  }

  if (!validString(claims?.sub, 255) ||
      !Number.isInteger(claims?.exp) ||
      !Number.isInteger(claims?.iat) ||
      claims.exp <= nowSeconds - skew ||
      claims.iat > nowSeconds + skew ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 3600 ||
      (claims.nbf !== undefined &&
        (!Number.isInteger(claims.nbf) || claims.nbf > nowSeconds + skew)) ||
      claims.nonce !== nonce) {
    return failure("google_id_token_time_or_nonce_rejected");
  }

  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (claims.email_verified !== true || !allowlist.has(email)) {
    return failure("google_reviewer_not_allowlisted");
  }

  let jwks;
  try {
    const response = await fetchImpl(GOOGLE_JWKS_URL, {
      method: "GET",
      signal: AbortSignal.timeout(8000),
      redirect: "error",
      headers: { accept: "application/json" }
    });
    if (!response?.ok) return failure("google_jwks_unavailable");
    jwks = await readBoundedJsonResponse(response, 64 * 1024);
  } catch {
    return failure("google_jwks_unavailable");
  }

  if (!Array.isArray(jwks?.keys) || jwks.keys.length < 1 ||
      jwks.keys.length > MAX_JWKS_KEYS) {
    return failure("google_jwks_invalid");
  }

  const jwk = jwks.keys.find(key =>
    key?.kid === header.kid &&
    key?.kty === "RSA" &&
    key?.use === "sig" &&
    (key?.alg === undefined || key.alg === "RS256")
  );
  if (!jwk) return failure("google_signing_key_not_found");

  try {
    if (!globalThis.crypto?.subtle) return failure("webcrypto_unavailable");
    const publicKey = await globalThis.crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const signingInput = new TextEncoder().encode(parts[0] + "." + parts[1]);
    const validSignature = await globalThis.crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      publicKey,
      signature,
      signingInput
    );
    if (!validSignature) return failure("google_id_token_signature_invalid");
  } catch {
    return failure("google_id_token_signature_invalid");
  }

  return {
    ok: true,
    status: "google_reviewer_identity_authenticated",
    reviewer_identity_authenticated: true,
    reviewer: {
      provider: "google",
      subject: claims.sub,
      email,
      reviewer_ref: "google:" + claims.sub
    },
    token_issuer: claims.iss,
    token_audience: audience,
    verified_at: new Date(now).toISOString(),
    publication_authorized: false,
    content_published: false,
    social_post_published: false
  };
}
