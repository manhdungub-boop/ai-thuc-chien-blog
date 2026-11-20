import { fetchGitHubActionsJwks } from "./github-oidc-jwks.mjs";
import { verifyGitHubActionsOidcToken } from "./github-oidc-verify.mjs";

/**
 * End-to-end GitHub Actions OIDC verification.
 *
 * Callers cannot inject a JWKS document or key URL: keys are fetched only
 * from the fixed GitHub issuer by github-oidc-jwks.mjs. This function verifies
 * the JWT signature and the repository/workflow claims but deliberately does
 * not authorize an action or consume jti. A caller must atomically consume
 * identity.jti in the State Store before any state-changing operation.
 */
export async function verifyGitHubActionsOidcTokenWithTrustedJwks(token, {
  expected,
  nowSeconds = Math.floor(Date.now() / 1000),
  clockSkewSeconds = 30,
  fetchImpl = fetch,
} = {}) {
  let jwks;
  try {
    jwks = await fetchGitHubActionsJwks({ fetchImpl });
  } catch (error) {
    const code = typeof error?.message === "string" &&
      /^oidc_(?:discovery|jwks)_[a-z_]+$/.test(error.message)
      ? error.message
      : "oidc_jwks_unavailable";
    return { ok: false, error: code };
  }

  return verifyGitHubActionsOidcToken(token, {
    jwks,
    expected,
    nowSeconds,
    clockSkewSeconds,
  });
}
