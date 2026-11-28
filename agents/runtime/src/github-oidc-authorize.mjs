import { callStateStore } from "./state-store-client.mjs";
import { verifyGitHubActionsOidcTokenWithTrustedJwks } from "./github-oidc-trusted-verify.mjs";

const MAX_REPLAY_RESPONSE_BYTES = 1024;

async function readReplayResponse(response) {
  if (!response || response.status !== 200 ||
      !response.headers?.get("content-type")?.match(/^application\/json(?:\s*;|\s*$)/i)) {
    return null;
  }

  const declared = response.headers.get("content-length");
  if (declared !== null &&
      (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > MAX_REPLAY_RESPONSE_BYTES)) {
    return null;
  }
  if (!response.body || typeof response.body.getReader !== "function") return null;

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REPLAY_RESPONSE_BYTES) {
        try { await reader.cancel(); } catch {}
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
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
    return null;
  }
}

/**
 * Verifies a GitHub Actions token against the pinned GitHub issuer and atomically
 * consumes its jti in the Durable Object State Store. Identity is returned only
 * after replay consumption succeeds. Callers must perform no state change before
 * this function returns ok:true.
 *
 * The Worker uses this primitive for the dedicated OIDC Pause endpoint and the
 * separately pinned one-shot, read-only Preview task endpoint. It does not
 * authorize Resume, recovery, publishing, or arbitrary task execution.
 */
export async function authorizeGitHubActionsOperator(token, {
  env = {},
  expected,
  nowSeconds = Math.floor(Date.now() / 1000),
  clockSkewSeconds = 30,
  fetchImpl = fetch,
  callStateStoreImpl = callStateStore,
} = {}) {
  const verified = await verifyGitHubActionsOidcTokenWithTrustedJwks(token, {
    expected,
    nowSeconds,
    clockSkewSeconds,
    fetchImpl,
  });
  if (!verified.ok) return verified;

  let response;
  try {
    response = await callStateStoreImpl(env, "oidcReplayConsume", {
      jti: verified.identity.jti,
      expiresAt: String(verified.identity.expiresAt),
    });
  } catch {
    return { ok: false, error: "oidc_replay_store_unavailable" };
  }

  if (response?.status === 409) return { ok: false, error: "oidc_token_replayed" };
  if (response?.status !== 200) return { ok: false, error: "oidc_replay_store_unavailable" };

  const replay = await readReplayResponse(response);
  if (!replay || replay.ok !== true || replay.consumed !== true ||
      Object.keys(replay).some((key) => !["ok", "consumed"].includes(key))) {
    return { ok: false, error: "oidc_replay_response_invalid" };
  }

  return { ok: true, identity: verified.identity, replayConsumed: true };
}
