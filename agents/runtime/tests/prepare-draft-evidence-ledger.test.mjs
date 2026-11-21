import { describe, it } from "node:test";\nimport { expect } from "./test-compat.mjs";
import { prepareDraftEvidenceLedger } from "../src/prepare-draft-evidence-ledger.mjs";

const sources = [
  { publisher: "OpenAI News", title: "Research update", url: "https://openai.com/index/research-update" },
  { publisher: "Google DeepMind", title: "Research report", url: "https://deepmind.google/blog/research-report" }
];
const excerpt = "This retrieved article passage describes the research scope, reported method, limitations, and relevant findings in enough detail for a human reviewer to inspect.";
const html = "<html><main><article><p>" + excerpt + "</p></article></main></html>";
const artifact = {
  id: "draft-prepare-0001",
  version: 4,
  status: "pending_human_review",
  draft: {
    sources,
    claims: [{
      claim_id: "claim-01",
      claim: "A human-authored claim is mapped to two exact source URLs.",
      evidence_urls: sources.map(item => item.url),
      citation_indices: [1, 2]
    }]
  },
  evidence_review: null
};

function fakeStore({ draft = artifact, stored = true, storeReason = "version_conflict" } = {}) {
  const calls = [];
  return {
    calls,
    async getDraft(id) { calls.push({ method: "getDraft", id }); return draft; },
    async storeEvidenceLedger(id, version, evidence) {
      calls.push({ method: "storeEvidenceLedger", id, version, evidence });
      return stored
        ? { stored: true, artifact: { ...draft, version: version + 1, evidence_review: { ledger: { claims: [] } } } }
        : { stored: false, reason: storeReason };
    }
  };
}

describe("Research-to-draft evidence preparation", () => {
  it("retrieves only the draft's exact claim sources and persists excerpts against its version", async () => {
    const store = fakeStore();
    const requests = [];
    const result = await prepareDraftEvidenceLedger({
      draftStore: store,
      artifactId: artifact.id,
      now: Date.parse("2026-11-19T00:00:00.000Z"),
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }
    });
    expect(result).toMatchObject({
      prepared: true,
      status: "traceable_evidence_pending_human_review",
      attempts: 2,
      retrieved: 2,
      publication_authorized: false,
      content_published: false
    });
    expect(requests.map(item => item.url)).toEqual(sources.map(item => item.url));
    expect(requests.every(item => item.init.method === "GET" && item.init.redirect === "error")).toBe(true);
    const write = store.calls.find(item => item.method === "storeEvidenceLedger");
    expect(write.version).toBe(4);
    expect(write.evidence).toHaveLength(2);
    expect(write.evidence.every(item => item.status === "source_retrieved_not_fact_checked")).toBe(true);
  });

  it("requires a budget-enforcing fetch implementation and a valid internal store", async () => {
    const store = fakeStore();
    expect(await prepareDraftEvidenceLedger({ draftStore: store, artifactId: artifact.id }))
      .toMatchObject({ prepared: false, reason: "invalid_preparation_request" });
  });

  it("does not fetch when the draft has no human-authored claim manifest", async () => {
    const store = fakeStore({ draft: { ...artifact, draft: { ...artifact.draft, claims: undefined } } });
    let calls = 0;
    const result = await prepareDraftEvidenceLedger({
      draftStore: store, artifactId: artifact.id, fetchImpl: async () => { calls++; return new Response(html); }
    });
    expect(result).toMatchObject({ prepared: false, reason: "claim_manifest_required" });
    expect(calls).toBe(0);
  });

  it("rejects claim URLs absent from the exact draft source manifest before fetching", async () => {
    const bad = {
      ...artifact,
      draft: { ...artifact.draft, claims: [{ ...artifact.draft.claims[0], evidence_urls: [sources[0].url, "https://evil.example/article"] }] }
    };
    const store = fakeStore({ draft: bad });
    let calls = 0;
    const result = await prepareDraftEvidenceLedger({
      draftStore: store, artifactId: artifact.id, fetchImpl: async () => { calls++; return new Response(html); }
    });
    expect(result).toMatchObject({ prepared: false, reason: "claim_source_not_in_draft_manifest" });
    expect(calls).toBe(0);
  });

  it("rejects more than four unique source URLs instead of silently truncating evidence", async () => {
    const extra = [
      { publisher: "Hugging Face", title: "Platform note", url: "https://huggingface.co/blog/platform-note" },
      { publisher: "arXiv cs.AI", title: "Preprint", url: "https://arxiv.org/abs/2611.00001" },
      { publisher: "OpenAI News", title: "Another note", url: "https://openai.com/index/another-note" }
    ];
    const all = [...sources, ...extra];
    const tooMany = {
      ...artifact,
      draft: { sources: all, claims: [{ ...artifact.draft.claims[0], evidence_urls: all.map(item => item.url) }] }
    };
    const store = fakeStore({ draft: tooMany });
    let calls = 0;
    const result = await prepareDraftEvidenceLedger({
      draftStore: store, artifactId: artifact.id, fetchImpl: async () => { calls++; return new Response(html); }
    });
    expect(result).toMatchObject({ prepared: false, reason: "invalid_claim_evidence_mapping" });
    expect(calls).toBe(0);
  });

  it("does not persist a partial ledger when any source retrieval fails", async () => {
    const store = fakeStore();
    let calls = 0;
    const result = await prepareDraftEvidenceLedger({
      draftStore: store,
      artifactId: artifact.id,
      fetchImpl: async () => {
        calls++;
        if (calls === 1) return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
        return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
      }
    });
    expect(result).toMatchObject({ prepared: false, reason: "source_retrieval_incomplete", retrieved: 1, failed: 1 });
    expect(store.calls.some(item => item.method === "storeEvidenceLedger")).toBe(false);
  });

  it("does not hide stale-version or duplicate-ledger persistence failures", async () => {
    const store = fakeStore({ stored: false, storeReason: "version_conflict" });
    const result = await prepareDraftEvidenceLedger({
      draftStore: store,
      artifactId: artifact.id,
      fetchImpl: async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } })
    });
    expect(result).toMatchObject({ prepared: false, reason: "version_conflict" });
  });

  it("does not retrieve or overwrite an existing ledger", async () => {
    const store = fakeStore({ draft: { ...artifact, evidence_review: { ledger: { claims: [] } } } });
    let calls = 0;
    const result = await prepareDraftEvidenceLedger({
      draftStore: store, artifactId: artifact.id, fetchImpl: async () => { calls++; return new Response(html); }
    });
    expect(result).toMatchObject({ prepared: false, reason: "evidence_ledger_already_exists" });
    expect(calls).toBe(0);
  });
});
