const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const DISCOVERY_URL = GITHUB_OIDC_ISSUER + "/.well-known/openid-configuration";
const TRUSTED_JWKS_URL = GITHUB_OIDC_ISSUER + "/.well-known/jwks";
const MAX_DISCOVERY_BYTES = 16 * 1024;
const MAX_JWKS_BYTES = 64 * 1024;
const MAX_SIGNING_KEYS = 10;
const FETCH_TIMEOUT_MS = 5_000;

async function readBoundedJson(response, maxBytes, errorCode) {
  if (!response || response.status !== 200 || response.ok !== true) {
    throw new Error(errorCode);
  }
  const contentType = response.headers?.get("content-type") || "";
  if (!/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
    throw new Error(errorCode);
  }
  const declaredLength = response.headers?.get("content-length");
  if (declaredLength !== null && declaredLength !== undefined) {
    if (!/^(0|[1-9][0-9]*)$/.test(declaredLength) || Number(declaredLength) > maxBytes) {
      throw new Error(errorCode);
    }
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new Error(errorCode);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch {}
        throw new Error(errorCode);
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(errorCode);
  }
}

function validateJwks(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Array.isArray(value.keys) || value.keys.length < 1 ||
      value.keys.length > MAX_SIGNING_KEYS) {
    throw new Error("oidc_jwks_invalid");
  }

  const seenKids = new Set();
  const keys = [];
  for (const key of value.keys) {
    if (!key || typeof key !== "object" || Array.isArray(key) ||
        key.kty !== "RSA" || key.use !== "sig" || key.alg !== "RS256" ||
        typeof key.kid !== "string" || key.kid.length < 1 || key.kid.length > 256 ||
        typeof key.n !== "string" || !/^[A-Za-z0-9_-]+$/.test(key.n) ||
        typeof key.e !== "string" || !/^[A-Za-z0-9_-]+$/.test(key.e) ||
        seenKids.has(key.kid)) {
      throw new Error("oidc_jwks_invalid");
    }
    seenKids.add(key.kid);
    keys.push({
      kty: "RSA",
      use: "sig",
      alg: "RS256",
      kid: key.kid,
      n: key.n,
      e: key.e,
    });
  }
  return { keys };
}

/**
 * Fetches GitHub Actions signing keys only through GitHub's fixed issuer.
 * Discovery metadata is checked against the pinned issuer and JWKS URL;
 * redirects, caller-provided URLs, oversized responses and unknown key
 * shapes are rejected. No token or credential is sent to either endpoint.
 */
export async function fetchGitHubActionsJwks({ fetchImpl = fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("oidc_jwks_unavailable");

  const request = async (url, errorCode) => {
    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "manual",
        cache: "no-store",
        credentials: "omit",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new Error(errorCode);
    }
    return response;
  };

  const discoveryResponse = await request(DISCOVERY_URL, "oidc_discovery_unavailable");
  const discovery = await readBoundedJson(
    discoveryResponse,
    MAX_DISCOVERY_BYTES,
    "oidc_discovery_invalid",
  );
  if (!discovery || typeof discovery !== "object" || Array.isArray(discovery) ||
      discovery.issuer !== GITHUB_OIDC_ISSUER ||
      discovery.jwks_uri !== TRUSTED_JWKS_URL) {
    throw new Error("oidc_discovery_untrusted");
  }

  const jwksResponse = await request(TRUSTED_JWKS_URL, "oidc_jwks_unavailable");
  const jwks = await readBoundedJson(jwksResponse, MAX_JWKS_BYTES, "oidc_jwks_invalid");
  return validateJwks(jwks);
}
