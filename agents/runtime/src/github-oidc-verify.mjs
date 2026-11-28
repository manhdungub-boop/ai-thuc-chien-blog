const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const MAX_TOKEN_LENGTH = 16 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 60;
const MAX_TOKEN_LIFETIME_SECONDS = 660;

function decodeBase64Url(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("jwt_encoding_invalid");
  }
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeJsonSegment(value) {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64Url(value)));
}

function isNonEmptyString(value, maximum = 512) {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function immutableRepositorySubject(expected) {
  const separator = expected.repository.indexOf("/");
  if (separator <= 0 || expected.repository.indexOf("/", separator + 1) !== -1 ||
      expected.repository.slice(0, separator) !== expected.repositoryOwner) return null;
  const repositoryName = expected.repository.slice(separator + 1);
  const repositorySubject = "repo:" + expected.repositoryOwner + "@" + expected.repositoryOwnerId + "/" +
    repositoryName + "@" + expected.repositoryId;
  if (expected.environment !== undefined) {
    return repositorySubject + ":environment:" + expected.environment;
  }
  return repositorySubject + ":ref:" + expected.ref;
}

function expectedConfigurationIsValid(expected) {
  return expected !== null && typeof expected === "object" &&
    isNonEmptyString(expected.audience, 256) &&
    isNonEmptyString(expected.repository, 256) &&
    isNonEmptyString(expected.repositoryOwner, 128) &&
    isNonEmptyString(expected.repositoryId, 32) &&
    isNonEmptyString(expected.repositoryOwnerId, 32) &&
    isNonEmptyString(expected.ref, 256) &&
    isNonEmptyString(expected.workflowRef, 512) &&
    isNonEmptyString(expected.actorId, 32) &&
    ((expected.eventName === "workflow_dispatch" &&
      (expected.environment === undefined || isNonEmptyString(expected.environment, 128))) ||
      (expected.eventName === "pull_request" && isNonEmptyString(expected.environment, 128)));
}

/**
 * Offline verifier for GitHub Actions OIDC JWTs.
 *
 * The caller must obtain a trusted JWKS document from GitHub's fixed issuer
 * endpoint and must atomically consume the returned jti before authorizing
 * any state-changing action. This function deliberately does neither network
 * access nor replay storage and is not an operator endpoint.
 */
export async function verifyGitHubActionsOidcToken(token, {
  jwks,
  expected,
  nowSeconds = Math.floor(Date.now() / 1000),
  clockSkewSeconds = 30,
} = {}) {
  if (!isNonEmptyString(token, MAX_TOKEN_LENGTH) ||
      !expectedConfigurationIsValid(expected) ||
      !Number.isSafeInteger(nowSeconds) ||
      !Number.isSafeInteger(clockSkewSeconds) ||
      clockSkewSeconds < 0 || clockSkewSeconds > MAX_CLOCK_SKEW_SECONDS ||
      !jwks || !Array.isArray(jwks.keys)) {
    return { ok: false, error: "oidc_configuration_invalid" };
  }

  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((part) => part.length === 0)) {
    return { ok: false, error: "oidc_token_invalid" };
  }

  let header;
  let claims;
  let signature;
  let signingInput;
  try {
    header = decodeJsonSegment(segments[0]);
    claims = decodeJsonSegment(segments[1]);
    signature = decodeBase64Url(segments[2]);
    signingInput = new TextEncoder().encode(segments[0] + "." + segments[1]);
  } catch {
    return { ok: false, error: "oidc_token_invalid" };
  }

  if (!header || typeof header !== "object" || Array.isArray(header) ||
      header.alg !== "RS256" || header.typ !== "JWT" ||
      !isNonEmptyString(header.kid, 256) ||
      Object.hasOwn(header, "jku") || Object.hasOwn(header, "x5u") ||
      Object.hasOwn(header, "crit") || Object.hasOwn(header, "b64")) {
    return { ok: false, error: "oidc_header_invalid" };
  }

  const matchingKeys = jwks.keys.filter((key) =>
    key && key.kid === header.kid && key.kty === "RSA" &&
    key.use === "sig" && (key.alg === undefined || key.alg === "RS256") &&
    typeof key.n === "string" && typeof key.e === "string"
  );
  if (matchingKeys.length !== 1) {
    return { ok: false, error: "oidc_signing_key_unavailable" };
  }

  let signatureValid = false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      matchingKeys[0],
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    signatureValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      signature,
      signingInput,
    );
  } catch {
    return { ok: false, error: "oidc_signature_invalid" };
  }
  if (!signatureValid) return { ok: false, error: "oidc_signature_invalid" };

  const now = nowSeconds;
  const skew = clockSkewSeconds;
  const expectedSubject = immutableRepositorySubject(expected);
  if (!claims || typeof claims !== "object" || Array.isArray(claims) ||
      claims.iss !== GITHUB_OIDC_ISSUER ||
      !(claims.aud === expected.audience ||
        (Array.isArray(claims.aud) && claims.aud.length === 1 && claims.aud[0] === expected.audience)) ||
      claims.repository !== expected.repository ||
      claims.repository_owner !== expected.repositoryOwner ||
      String(claims.repository_id ?? "") !== expected.repositoryId ||
      String(claims.repository_owner_id ?? "") !== expected.repositoryOwnerId ||
      claims.ref !== expected.ref ||
      claims.workflow_ref !== expected.workflowRef ||
      claims.event_name !== expected.eventName ||
      String(claims.actor_id ?? "") !== expected.actorId ||
      expectedSubject === null ||
      claims.sub !== expectedSubject ||
      !isNonEmptyString(claims.jti, 128) ||
      !/^\d+$/.test(String(claims.run_id ?? "")) ||
      !/^\d+$/.test(String(claims.run_attempt ?? "")) ||
      !Number.isSafeInteger(claims.iat) ||
      !Number.isSafeInteger(claims.exp) ||
      (claims.nbf !== undefined && !Number.isSafeInteger(claims.nbf)) ||
      claims.iat > now + skew ||
      claims.exp <= now ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > MAX_TOKEN_LIFETIME_SECONDS ||
      (claims.nbf !== undefined && claims.nbf > now + skew)) {
    return { ok: false, error: "oidc_claims_invalid" };
  }

  return {
    ok: true,
    identity: {
      actorId: expected.actorId,
      repository: expected.repository,
      repositoryId: expected.repositoryId,
      repositoryOwnerId: expected.repositoryOwnerId,
      ref: expected.ref,
      workflowRef: expected.workflowRef,
      eventName: expected.eventName,
      runId: String(claims.run_id),
      runAttempt: String(claims.run_attempt),
      jti: claims.jti,
      issuedAt: claims.iat,
      expiresAt: claims.exp,
    },
  };
}
