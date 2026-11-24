import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";

const OPERATOR_TOKEN = "authoring-route-operator-token-0123456789abcdef";
const STATE_TOKEN = "authoring-route-state-token-0123456789abcdef";
const ROUTE = "https://agent-runtime-preview.example.workers.dev/internal/authoring/prepare";

function makeEnv({ paused = false, version = 1 } = {}) {
  let control = { paused, version };
  let draftControl = { paused, version };
  let used = 0;
  const budgetCalls = [];
  const draftCalls = [];
  const artifacts = new Map();
  const stateStub = {
    async fetch(request) {
      const url = new URL(request.url);
      assert.equal(request.headers.get("authorization"), "Bearer " + STATE_TOKEN);
      if (url.pathname === "/control") return Response.json({ ok: true, control: { ...control } });
      if (url.pathname === "/external-budget" && request.method === "GET") {
        return Response.json({ ok: true, budget: { ok: true, day: url.searchParams.get("day"), scope: "content_research", used, limit: 8, remaining: 8 - used } });
      }
      if (url.pathname === "/external-budget/consume" && request.method === "POST") {
        const body = await request.json();
        budgetCalls.push(body);
        if (body.scope !== "content_research" || used >= 8) return Response.json({ ok: false, error: "external_request_budget_exhausted" }, { status: 400 });
        used += 1;
        return Response.json({ ok: true, budget: { ok: true, day: body.day, scope: "content_research", used, limit: 8, remaining: 8 - used } });
      }
      throw new Error("unexpected_state_store_route");
    },
  };
  const draftStub = {
    async setRuntimePaused(nextPaused, nextVersion) {
      if (nextVersion < draftControl.version) return { updated: false, reason: "runtime_control_version_stale" };
      if (nextVersion === draftControl.version && nextPaused !== draftControl.paused) return { updated: false, reason: "runtime_control_version_conflict" };
      draftControl = { paused: nextPaused, version: nextVersion };
      return { updated: true, paused: nextPaused, version: nextVersion };
    },
    async getDraft(id) { return artifacts.get(id) || null; },
    async createDraftFromAgent(id, draft, evidence, expectedVersion) {
      if (draftControl.paused) return { accepted: false, reason: "runtime_paused" };
      if (draftControl.version !== expectedVersion) return { accepted: false, reason: "runtime_control_version_conflict" };
      draftCalls.push({ id, draft, evidence });
      if (artifacts.has(id)) return { accepted: false, reason: "artifact_id_conflict" };
      const artifact = { id, status: "needs_revision", version: 1, draft, quality_review: { ok: false, status: "needs_revision", publication_authorized: false } };
      artifacts.set(id, artifact);
      return { accepted: true, duplicate: false, artifact };
    },
  };
  const env = {
    AGENT_ENABLED: "true", AGENT_PAUSED: "false",
    AGENT_OPERATOR_TOKEN: OPERATOR_TOKEN, AGENT_STATE_STORE_TOKEN: STATE_TOKEN,
    AGENT_STATE_STORE: { idFromName() { return "fixed-state-store"; }, get() { return stateStub; } },
    AGENT_DRAFT_STORE: { idFromName() { return "fixed-draft-store"; }, get() { return draftStub; } },
  };
  return { env, budgetCalls, draftCalls, artifacts, setControl(next) { control = { ...next }; }, get used() { return used; } };
}

function makeRequest({ topic = "Ứng dụng AI Agent trong tự động hóa", key = "authoring-idempotency-0001", token = OPERATOR_TOKEN } = {}) {
  return new Request(ROUTE, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ topic, idempotencyKey: key }),
  });
}

function rssItem(title, url) {
  return `<rss><channel><item><title>${title}</title><link>${url}</link><pubDate>${new Date().toUTCString()}</pubDate><description>Official research update and engineering context.</description></item></channel></rss>`;
}

function mockOfficialFetch() {
  const feeds = new Map([
    ["https://openai.com/news/rss.xml", rssItem("OpenAI research", "https://openai.com/index/research-brief")],
    ["https://deepmind.google/blog/rss.xml", rssItem("DeepMind research", "https://deepmind.google/blog/research-brief")],
    ["https://huggingface.co/blog/feed.xml", rssItem("Hugging Face research", "https://huggingface.co/blog/research-brief")],
    ["https://rss.arxiv.org/rss/cs.AI", rssItem("arXiv AI research", "https://arxiv.org/abs/2611.12345")],
  ]);
  const pages = new Set([
    "https://openai.com/index/research-brief", "https://deepmind.google/blog/research-brief",
    "https://huggingface.co/blog/research-brief", "https://arxiv.org/abs/2611.12345",
  ]);
  return async (input, options = {}) => {
    const url = String(input);
    if (options.signal?.aborted) throw new Error("aborted");
    if (feeds.has(url)) return new Response(feeds.get(url), { status: 200, headers: { "content-type": "application/rss+xml" } });
    if (pages.has(url)) return new Response(`<html><body><main><p>${"Official source evidence with research method, limitations and implementation details. ".repeat(3)}</p></main></body></html>`, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    throw new Error("unexpected_external_url");
  };
}

test("authoring route creates a human-review scaffold with bounded free research only", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockOfficialFetch();
  const runtime = makeEnv();
  try {
    const response = await worker.fetch(makeRequest(), runtime.env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
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
    assert.equal(runtime.used, 8);
    assert.equal(runtime.budgetCalls.length, 8);
    assert.equal(runtime.draftCalls.length, 1);
    assert.equal(runtime.draftCalls[0].draft.author, "DUNG - AI");
  } finally { globalThis.fetch = originalFetch; }
});

test("authoring route rejects a changed control generation before draft persistence", async () => {
  const originalFetch = globalThis.fetch;
  const runtime = makeEnv();
  const network = mockOfficialFetch();
  globalThis.fetch = async (input, options) => {
    const result = await network(input, options);
    if (String(input) === "https://openai.com/news/rss.xml") runtime.setControl({ paused: true, version: 2 });
    return result;
  };
  try {
    const response = await worker.fetch(makeRequest(), runtime.env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "agent_disabled_or_paused");
    assert.equal(runtime.draftCalls.length, 0);
    assert.equal(runtime.artifacts.size, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("authoring route aborts in-flight research after durable Pause", async () => {
  const originalFetch = globalThis.fetch;
  const runtime = makeEnv();
  globalThis.fetch = async (_input, options = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => runtime.setControl({ paused: true, version: 2 }), 100);
    options.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("aborted")); }, { once: true });
  });
  try {
    const response = await worker.fetch(makeRequest(), runtime.env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "agent_disabled_or_paused");
    assert.equal(runtime.draftCalls.length, 0);
    assert.equal(runtime.artifacts.size, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test("authoring route stays closed when the durable control is paused", async () => {
  const runtime = makeEnv({ paused: true });
  const response = await worker.fetch(makeRequest(), runtime.env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "agent_disabled_or_paused");
  assert.equal(runtime.budgetCalls.length, 0);
  assert.equal(runtime.draftCalls.length, 0);
});

test("authoring route rejects missing operator authentication before State Store access", async () => {
  const runtime = makeEnv();
  const response = await worker.fetch(makeRequest({ token: "" }), runtime.env);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "operator_auth_required");
  assert.equal(runtime.budgetCalls.length, 0);
  assert.equal(runtime.draftCalls.length, 0);
});
