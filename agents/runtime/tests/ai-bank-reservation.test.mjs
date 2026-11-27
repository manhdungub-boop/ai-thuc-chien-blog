import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";

const audience = "ai-thuc-chien-agent-runtime-preview";
const repository = "manhdungub-boop/ai-thuc-chien-blog";
const workflowRef = "manhdungub-boop/ai-thuc-chien-blog/.github/workflows/ai-bank-official-feed-discovery.yml@refs/heads/main";
const owner = "manhdungub-boop";
const repositoryId = "1423636651";
const ownerId = "342528485";
const actorId = "342528485";
const ref = "refs/heads/main";
const issuer = "https://token.actions.githubusercontent.com";
const discoveryUrl = issuer + "/.well-known/openid-configuration";
const jwksUrl = issuer + "/.well-known/jwks";

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
}
function encodeJson(value) {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}
async function makeSignedToken(privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: "ai-bank-test-key" };
  const claims = {
    iss: issuer,
    aud: audience,
    sub: "repo:manhdungub-boop@342528485/ai-thuc-chien-blog@1423636651:ref:refs/heads/main",
    repository,
    repository_owner: owner,
    repository_id: repositoryId,
    repository_owner_id: ownerId,
    ref,
    workflow_ref: workflowRef,
    event_name: "schedule",
    actor_id: actorId,
    jti: "ai.bank.schedule.jti.00000001",
    run_id: "987654321",
    run_attempt: "1",
    iat: now - 5,
    nbf: now - 5,
    exp: now + 300,
  };
  const encodedHeader = encodeJson(header);
  const encodedClaims = encodeJson(claims);
  const input = new TextEncoder().encode(encodedHeader + "." + encodedClaims);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, input);
  return encodedHeader + "." + encodedClaims + "." + encodeBase64Url(new Uint8Array(signature));
}
async function fixture({ quotaAllowed = true, replayStatus = 200, failBudget = false } = {}) {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const jwks = { keys: [{ kty: "RSA", use: "sig", alg: "RS256", kid: "ai-bank-test-key", n: publicKey.n, e: publicKey.e }] };
  const token = await makeSignedToken(pair.privateKey);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === discoveryUrl) return Response.json({ issuer, jwks_uri: jwksUrl });
    if (url === jwksUrl) return Response.json(jwks);
    throw new Error("unexpected_outbound_request");
  };
  const stateCalls = [];
  let reservationBody = null;
  const env = {
    AGENT_RATE_LIMIT_REQUIRED: "false",
    AGENT_AI_BANK_INGESTION_ENABLED: "true",
    AGENT_OIDC_ENABLED: "true",
    AGENT_OIDC_AUDIENCE: audience,
    AGENT_OIDC_REPOSITORY: repository,
    AGENT_OIDC_REPOSITORY_OWNER: owner,
    AGENT_OIDC_REPOSITORY_ID: repositoryId,
    AGENT_OIDC_REPOSITORY_OWNER_ID: ownerId,
    AGENT_OIDC_REF: ref,
    AGENT_AI_BANK_OIDC_WORKFLOW_REF: workflowRef,
    AGENT_AI_BANK_SCHEDULE_ACTOR_ID: actorId,
    AGENT_STATE_STORE_TOKEN: "ai-bank-test-state-store-token-0123456789",
    AGENT_STATE_STORE: {
      idFromName(name) { assert.equal(name, "agent-runtime-global"); return "fixed-id"; },
      get(id) {
        assert.equal(id, "fixed-id");
        return {
          async fetch(request) {
            const url = new URL(request.url);
            const body = request.method === "POST" ? await request.json() : null;
            stateCalls.push({ path: url.pathname, body });
            if (url.pathname === "/oidc/replay/consume") {
              return new Response(JSON.stringify({ ok: true, consumed: true }), {
                status: replayStatus,
                headers: { "Content-Type": "application/json" },
              });
            }
            if (url.pathname === "/external-budget/consume") {
              reservationBody = body;
              if (failBudget) throw new Error("simulated_store_unavailable");
              return Response.json({ ok: true, budget: {
                ok: true,
                allowed: quotaAllowed,
                day: body.day,
                scope: "ai_bank_discovery",
                used: quotaAllowed ? 5 : 10,
                limit: 10,
                remaining: quotaAllowed ? 5 : 0,
              } });
            }
            throw new Error("unexpected_state_store_operation");
          },
        };
      },
    },
  };
  return { env, token, stateCalls, get reservationBody() { return reservationBody; }, restore() { globalThis.fetch = originalFetch; } };
}
function request(token, body = "{}") {
  return new Request("https://ai-thuc-chien-agent-runtime-preview.manhdungub.workers.dev/internal/oidc/ai-bank-reserve", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body,
  });
}

test("AI Bank scheduled reservation consumes the OIDC jti and atomically reserves exactly five feed requests", async () => {
  const f = await fixture();
  try {
    const response = await worker.fetch(request(f.token), f.env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.scope, "ai_bank_discovery");
    assert.equal(body.reserved, 5);
    assert.equal(body.limit, 10);
    assert.equal(f.reservationBody.count, 5);
    assert.equal(f.reservationBody.scope, "ai_bank_discovery");
    assert.equal(f.stateCalls.map(call => call.path).join(","), "/oidc/replay/consume,/external-budget/consume");
  } finally { f.restore(); }
});

test("AI Bank scheduled reservation stops before feeds when the daily budget is exhausted", async () => {
  const f = await fixture({ quotaAllowed: false });
  try {
    const response = await worker.fetch(request(f.token), f.env);
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error, "daily_external_request_budget_exhausted");
    assert.equal(f.stateCalls.at(-1).path, "/external-budget/consume");
    assert.equal(f.reservationBody.count, 5);
  } finally { f.restore(); }
});

test("AI Bank scheduled reservation fails closed when State Store reservation is unavailable", async () => {
  const f = await fixture({ failBudget: true });
  try {
    const response = await worker.fetch(request(f.token), f.env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "ai_bank_quota_reservation_unavailable");
    assert.equal(f.stateCalls.at(-1).path, "/external-budget/consume");
  } finally { f.restore(); }
});

test("AI Bank scheduled reservation rejects replay before consuming quota", async () => {
  const f = await fixture({ replayStatus: 409 });
  try {
    const response = await worker.fetch(request(f.token), f.env);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "github_oidc_token_replayed");
    assert.equal(f.stateCalls.length, 1);
    assert.equal(f.stateCalls[0].path, "/oidc/replay/consume");
  } finally { f.restore(); }
});

test("AI Bank scheduled reservation is disabled by default and never contacts State Store", async () => {
  const f = await fixture();
  try {
    const env = { ...f.env, AGENT_AI_BANK_INGESTION_ENABLED: "false" };
    const response = await worker.fetch(request(f.token), env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "ai_bank_ingestion_disabled");
    assert.equal(f.stateCalls.length, 0);
  } finally { f.restore(); }
});
