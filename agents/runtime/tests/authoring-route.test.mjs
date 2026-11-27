import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";

const OPERATOR_TOKEN = "authoring-route-operator-token-0123456789abcdef";
const ROUTE = "https://agent-runtime-preview.example.workers.dev/internal/authoring/prepare";

function makeEnv() {
  const effects = { stateStore: 0, draftRead: 0, draftWrite: 0, outboundFetch: 0 };
  const stateStub = {
    async fetch() {
      effects.stateStore += 1;
      return Response.json({ ok: true, control: { paused: true, version: 7 } });
    },
  };
  const draftStub = {
    async getDraft() { effects.draftRead += 1; return null; },
    async createDraft() { effects.draftWrite += 1; return { accepted: true }; },
  };
  return {
    effects,
    env: {
      AGENT_ENABLED: "true",
      AGENT_PAUSED: "false",
      AGENT_OPERATOR_TOKEN: OPERATOR_TOKEN,
      AGENT_STATE_STORE_TOKEN: "authoring-route-state-token-0123456789abcdef",
      AGENT_STATE_STORE: {
        idFromName() { return "fixed-state-store"; },
        get() { return stateStub; },
      },
      AGENT_DRAFT_STORE: {
        idFromName() { return "fixed-draft-store"; },
        get() { return draftStub; },
      },
    },
  };
}

function makeRequest(method = "POST") {
  return new Request(ROUTE, {
    method,
    headers: {
      Authorization: "Bearer " + OPERATOR_TOKEN,
      "Content-Type": "application/json",
    },
    body: method === "POST" ? JSON.stringify({
      topic: "Ứng dụng AI Agent trong tự động hóa",
      idempotencyKey: "authoring-idempotency-0001",
    }) : undefined,
  });
}

test("authoring preparation remains fail-closed even if deployment flags are accidentally unpaused", async () => {
  const runtime = makeEnv();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    runtime.effects.outboundFetch += 1;
    throw new Error("outbound_fetch_must_not_run");
  };
  try {
    const response = await worker.fetch(makeRequest(), runtime.env);
    assert.equal(response.status, 503);
    assert.equal(
      (await response.json()).error,
      "authoring_route_disabled_pending_durable_pause_fencing",
    );
    assert.deepEqual(runtime.effects, {
      stateStore: 0,
      draftRead: 0,
      draftWrite: 0,
      outboundFetch: 0,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authoring preparation preserves method validation while disabled", async () => {
  const runtime = makeEnv();
  const response = await worker.fetch(makeRequest("GET"), runtime.env);
  assert.equal(response.status, 405);
  assert.equal((await response.json()).error, "method_not_allowed");
  assert.deepEqual(runtime.effects, {
    stateStore: 0,
    draftRead: 0,
    draftWrite: 0,
    outboundFetch: 0,
  });
});
