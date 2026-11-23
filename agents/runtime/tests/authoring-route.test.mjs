import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";

const OPERATOR_TOKEN = "authoring-route-operator-token-0123456789abcdef";
const STATE_TOKEN = "authoring-route-state-token-0123456789abcdef";
const ROUTE = "https://agent-runtime-preview.example.workers.dev/internal/authoring/prepare";

function makeEnv({ remaining = 8, limit = 8 } = {}) {
  let used = limit - remaining;
  const budgetCalls = [];
  const draftCalls = [];
  const artifacts = new Map();
  const stateStub = {
    async fetch(request) {
      const url = new URL(request.url);
      assert.equal(request.headers.get("authorization"), "Bearer " + STATE_TOKEN);
      if (url.pathname === "/external-budget" && request.method === "GET") {
        return Response.json({ ok: true, budget: { ok: true, day: url.searchParams.get("day"), scope: "content_research", used, limit, remaining: limit - used } });
      }
      if (url.pathname === "/external-budget/consume" && request.method === "POST") {
        const body = await request.json();
        budgetCalls.push(body);
        if (body.scope !== "content_research" || used >= limit) return Response.json({ ok: false, error: "external_request_budget_exhausted" }, { status: 400 });
        used += 1;
        const day = new Date().toISOString().slice(0, 10);
        return Response.json({ ok: true, budget: { ok: true, day: body.day, scope: body.scope, used, limit, remaining: limit - used } });
      }
      throw new Error("unexpected_state_store_route");
    },
  };
  const draftStub = {
    async getDraft(id) { return artifacts.get(id) || null; },
    async createDraft(id, draft, evidence) {
      draftCalls.push({ id, draft, evidence });
      if (artifacts.has(id)) {
        const existing = artifacts.get(id);
        return { accepted: existing.draft.title === draft.title, duplicate: true, artifact: existing, reason: existing.draft.title === draft.title ? undefined : "artifact_id_conflict" };
      }
      const artifact = {
        id, status: "needs_revision", version: 1, draft,
        quality_review: { ok: false, status: "needs_revision", publication_authorized: false },
      };
      artifacts.set(id, artifact);
      return { accepted: true, duplicate: false, artifact };
    },
  };
  const env = {
    AGENT_ENABLED: "true",
    AGENT_PAUSED: "false",
    AGENT_OPERATOR_TOKEN: OPERATOR_TOKEN,
    AGENT_STATE_STORE_TOKEN: STATE_TOKEN,
    AGENT_STATE_STORE: {
      idFromName(name) { assert.equal(name, "agent-runtime-global"); return "fixed-state-store"; },
      get(id) { assert.equal(id, "fixed-state-store"); return stateStub; },
    },
    AGENT_DRAFT_STORE: {
      idFromName(name) { assert.equal(name, "agent-authoring-global"); return "fixed-draft-store"; },
      get(id) { assert.equal(id, "fixed-draft-store"); return draftStub; },
    },
  };
  return { env, budgetCalls, draftCalls, artifacts, get used() { return used; } };
}

function makeRequest({ topic = "Ứng dụng AI Agent trong tự động hóa", key = "authoring-idempotency-0001", query = "", body = null, token = OPERATOR_TOKEN, contentType = "application/json" } = {}) {
  return new Request(ROUTE + query, {
    method: "POST",
    headers: { ...(token ? { Authorization: "Bearer " + token } : {}), "Content-Type": contentType },
    body: JSON.stringify(body ?? { topic, idempotencyKey: key }),
  });
}

function rssItem(title, url) {
  return `<rss><channel><item><title>${title}</title><link>${url}</link><pubDate>${new Date().toUTCString()}</pubDate><description>Official research update and engineering context.</description></item></channel></rss>`;
}

function mockOfficialFetch() {
  const calls = [];
  const feeds = new Map([
    ["https://openai.com/news/rss.xml", rssItem("OpenAI research", "https://openai.com/index/research-brief")],
    ["https://deepmind.google/blog/rss.xml", rssItem("DeepMind research", "https://deepmind.google/blog/research-brief")],
    ["https://huggingface.co/blog/feed.xml", rssItem("Hugging Face research", "https://huggingface.co/blog/research-brief")],
    ["https://rss.arxiv.org/rss/cs.AI", rssItem("arXiv AI research", "https://arxiv.org/abs/2611.12345")],
  ]);
  const pages = new Set([
    "https://openai.com/index/research-brief",
    "https://deepmind.google/blog/research-brief",
    "https://huggingface.co/blog/research-brief",
    "https://arxiv.org/abs/2611.12345",
  ]);
  return {
    calls,
    fetch: async (input) => {
      const url = String(input);
      calls.push(url);
      if (feeds.has(url)) return new Response(feeds.get(url), { status: 200, headers: { "content-type": "application/rss+xml" } });
      if (pages.has(url)) return new Response(`<html><body><main><p>${"Official source evidence with research method, limitations and implementation details. ".repeat(3)}</p></main></body></html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      throw new Error("unexpected_external_url");
    },
  };
}

test("authoring route is closed when disabled or paused and requires operator authentication", async () => {
  const disabled = makeEnv();
  disabled.env.AGENT_ENABLED = "false";
  const response = await worker.fetch(makeRequest(), disabled.env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "agent_disabled_or_paused");
  assert.equal(disabled.budgetCalls.length, 0);

  const paused = makeEnv();
  paused.env.AGENT_PAUSED = "true";
  const pausedResponse = await worker.fetch(makeRequest(), paused.env);
  assert.equal(pausedResponse.status, 503);
  assert.equal(paused.budgetCalls.length, 0);

  const unauthenticated = makeEnv();
  const unauthResponse = await worker.fetch(makeRequest({ token: null }), unauthenticated.env);
  assert.equal(unauthResponse.status, 401);
  assert.equal(unauthenticated.budgetCalls.length, 0);
});

test("authoring route reserves eight free research requests and stores only a human-authoring scaffold", async () => {
  const originalFetch = globalThis.fetch;
  const network = mockOfficialFetch();
  globalThis.fetch = network.fetch;
  const runtime = makeEnv();
  try {
    const response = await worker.fetch(makeRequest(), runtime.env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.mode, "operator_triggered_research_to_authoring_brief");
    assert.equal(body.execution, "local_deterministic_no_external_ai");
    assert.equal(body.research.sources_checked, 4);
    assert.equal(body.research.sources_succeeded, 4);
    assert.equal(body.research.signals, 4);
    assert.equal(body.research.evidence_retrieved, 4);
    assert.equal(body.artifact.status, "needs_revision");
    assert.equal(body.artifact.human_authoring_required, true);
    assert.equal(body.artifact.publication_authorized, false);
    assert.equal(body.claims_generated, false);
    assert.equal(body.catalog_modified, false);
    assert.equal(body.publication_authorized, false);
    assert.equal("body_markdown" in body.artifact, false);
    assert.equal(runtime.used, 8);
    assert.equal(runtime.budgetCalls.length, 8);
    assert.equal(network.calls.length, 8);
    assert.equal(runtime.draftCalls.length, 1);
    assert.equal(runtime.draftCalls[0].evidence.length, 4);
    assert.equal(runtime.draftCalls[0].draft.author, "DUNG - AI");
    assert.equal(runtime.draftCalls[0].draft.claims, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authoring route returns an existing idempotent artifact without spending quota or fetching sources again", async () => {
  const originalFetch = globalThis.fetch;
  const network = mockOfficialFetch();
  globalThis.fetch = network.fetch;
  const runtime = makeEnv();
  try {
    const first = await worker.fetch(makeRequest(), runtime.env);
    assert.equal(first.status, 200);
    const firstBody = await first.json();
    const beforeCalls = network.calls.length;
    const beforeBudget = runtime.budgetCalls.length;
    const repeated = await worker.fetch(makeRequest(), runtime.env);
    const repeatedBody = await repeated.json();
    assert.equal(repeated.status, 200);
    assert.equal(repeatedBody.duplicate, true);
    assert.equal(repeatedBody.artifact.id, firstBody.artifact.id);
    assert.equal(network.calls.length, beforeCalls);
    assert.equal(runtime.budgetCalls.length, beforeBudget);
    assert.equal(runtime.draftCalls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authoring idempotency binds the full topic, not only its first 70 characters", async () => {
  const originalFetch = globalThis.fetch;
  const network = mockOfficialFetch();
  globalThis.fetch = network.fetch;
  const runtime = makeEnv({ remaining: 16, limit: 16 });
  const prefix = "A".repeat(70);
  try {
    const first = await worker.fetch(makeRequest({ topic: prefix + " first suffix" }), runtime.env);
    const firstBody = await first.json();
    assert.equal(first.status, 200);
    const second = await worker.fetch(makeRequest({ topic: prefix + " second suffix" }), runtime.env);
    const secondBody = await second.json();
    assert.equal(second.status, 200);
    assert.equal(secondBody.duplicate, false);
    assert.notEqual(secondBody.artifact.id, firstBody.artifact.id);
    assert.equal(runtime.draftCalls.length, 2);
    assert.equal(network.calls.length, 16);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authoring route fails closed when fewer than four research request units remain", async () => {
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async () => { fetches += 1; throw new Error("must_not_fetch"); };
  const runtime = makeEnv({ remaining: 3 });
  try {
    const response = await worker.fetch(makeRequest(), runtime.env);
    assert.equal(response.status, 429);
    assert.equal((await response.json()).error, "research_budget_exhausted");
    assert.equal(fetches, 0);
    assert.equal(runtime.draftCalls.length, 0);
    assert.equal(runtime.budgetCalls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authoring route rejects extra fields, query parameters and non-JSON bodies before side effects", async () => {
  const runtime = makeEnv();
  const extra = await worker.fetch(makeRequest({ body: { topic: "AI agents", idempotencyKey: "authoring-idempotency-0001", publish: true } }), runtime.env);
  assert.equal(extra.status, 400);
  const query = await worker.fetch(makeRequest({ query: "?publish=true" }), runtime.env);
  assert.equal(query.status, 400);
  const media = await worker.fetch(makeRequest({ contentType: "text/plain" }), runtime.env);
  assert.equal(media.status, 415);
  assert.equal(runtime.budgetCalls.length, 0);
  assert.equal(runtime.draftCalls.length, 0);
});
