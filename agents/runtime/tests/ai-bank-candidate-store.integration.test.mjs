import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "./test-compat.mjs";
import { createLegacyStoresRuntime } from "./legacy-stores-test-harness.mjs";

const sources = [
  { vendor: "Ollama", product: "Ollama", repo: "ollama/ollama" },
  { vendor: "ComfyUI", product: "ComfyUI", repo: "Comfy-Org/ComfyUI" }
];

function candidate(source = sources[0], release = "v1.2.3", publishedAt = "2026-11-19T08:00:00.000Z") {
  return {
    candidate_id: "github:" + source.repo,
    name: source.product,
    provider: source.vendor,
    repository: source.repo,
    latest_release: {
      title: source.product + " Release " + release,
      source_url: "https://github.com/" + source.repo + "/releases/tag/" + release,
      published_at: publishedAt
    },
    discovered_at: "2026-11-19T08:05:00.000Z",
    evidence_type: "github_release_activity_only",
    review_status: "needs_official_source_review",
    pricing_status: "unverified",
    free_limits_status: "unverified",
    license_status: "unverified",
    privacy_status: "unverified",
    platform_support_status: "unverified",
    regional_availability_status: "unverified",
    required_checks: [
      "official_product_domain",
      "pricing_and_free_limits",
      "license_scope",
      "privacy_and_data_handling",
      "platform_support",
      "regional_availability"
    ],
    catalog_write_authorized: false,
    public_publication_authorized: false
  };
}

describe("AgentAIBankCandidateStore Durable Object", () => {
  let store;
  let runtime;
  let testIndex = 0;
  beforeEach(async () => {
    testIndex += 1;
    runtime = await createLegacyStoresRuntime();
    store = runtime.aiBank.get(runtime.aiBank.idFromName("agent-ai-bank-candidates-" + testIndex));
  });
  afterEach(async () => {
    await runtime?.mf.dispose();
  });

  it("persists allowlisted candidates as review-only records", async () => {
    const result = await store.upsertCandidates([candidate()], Date.parse("2026-11-19T08:06:00.000Z"));
    expect(result).toMatchObject({
      accepted: true, inserted: 1, updated: 0, unchanged: 0, total: 1,
      catalog_write_authorized: false
    });
    const [stored] = await store.listCandidates();
    expect(stored.candidate.candidate_id).toBe("github:ollama/ollama");
    expect(stored.candidate.review_status).toBe("needs_official_source_review");
    expect(stored.candidate.catalog_write_authorized).toBe(false);
    expect(stored.candidate.public_publication_authorized).toBe(false);
    expect(await store.stats()).toMatchObject({
      total: 1, awaiting_official_review: 1,
      catalog_write_authorized: false, public_publication_authorized: false
    });
  });

  it("deduplicates repeat scans and only replaces a record with a newer release", async () => {
    await store.upsertCandidates([candidate()], Date.parse("2026-11-19T08:06:00.000Z"));
    const repeated = await store.upsertCandidates([candidate()], Date.parse("2026-11-19T09:00:00.000Z"));
    expect(repeated).toMatchObject({ inserted: 0, updated: 0, unchanged: 1, total: 1 });
    const newer = candidate(sources[0], "v1.2.4", "2026-11-19T09:00:00.000Z");
    newer.discovered_at = "2026-11-19T09:05:00.000Z";
    const updated = await store.upsertCandidates([newer], Date.parse("2026-11-19T09:06:00.000Z"));
    expect(updated).toMatchObject({ inserted: 0, updated: 1, unchanged: 0, total: 1 });
    expect((await store.getCandidate("github:ollama/ollama")).candidate.latest_release.title).toContain("v1.2.4");
  });

  it("rejects unknown repositories and forged review or publication permissions", async () => {
    const unknown = candidate({ vendor: "Unknown", product: "Unknown", repo: "attacker/tool" });
    expect(await store.upsertCandidates([unknown])).toEqual({
      accepted: false, reason: "repository_not_allowlisted"
    });
    const forged = candidate();
    forged.catalog_write_authorized = true;
    expect(await store.upsertCandidates([forged])).toEqual({
      accepted: false, reason: "candidate_review_state_invalid"
    });
    expect(await store.stats()).toMatchObject({ total: 0 });
  });

  it("rejects malformed URLs, mismatched product identity, and invalid timestamps", async () => {
    const badUrl = candidate();
    badUrl.latest_release.source_url = "https://evil.example/ollama/ollama/releases/latest";
    expect(await store.upsertCandidates([badUrl])).toEqual({ accepted: false, reason: "invalid_release_url" });
    const badIdentity = candidate();
    badIdentity.provider = "Impersonated provider";
    expect(await store.upsertCandidates([badIdentity])).toEqual({ accepted: false, reason: "product_identity_mismatch" });
    const badDate = candidate();
    badDate.latest_release.published_at = "not-a-date";
    expect(await store.upsertCandidates([badDate])).toEqual({ accepted: false, reason: "invalid_candidate_timestamps" });
    expect(await store.stats()).toMatchObject({ total: 0 });
  });

  it("validates the complete batch before writing any candidate", async () => {
    const forged = candidate(sources[1]);
    forged.license_status = "verified_free";
    expect(await store.upsertCandidates([candidate(), forged])).toEqual({
      accepted: false, reason: "candidate_review_state_invalid"
    });
    expect(await store.stats()).toMatchObject({ total: 0 });
  });

  it("rejects duplicate IDs within a batch and oversized batches", async () => {
    expect(await store.upsertCandidates([candidate(), candidate()])).toEqual({
      accepted: false, reason: "duplicate_candidate_in_batch"
    });
    expect(await store.upsertCandidates(Array.from({ length: 11 }, () => candidate()))).toEqual({
      accepted: false, reason: "invalid_candidate_batch"
    });
  });

  it("bounds list operations and safely returns missing candidates", async () => {
    await expect(Promise.resolve().then(() => store.listCandidates(51))).rejects.toThrow("invalid_candidate_list_limit");
    expect(await store.getCandidate("github:ollama/ollama")).toBeNull();
    expect(await store.listCandidates()).toEqual([]);
  });
  it("stores submitted evidence as unverified and pending human review", async () => {
    await store.upsertCandidates([candidate()], Date.parse("2026-11-19T08:06:00.000Z"));
    const result = await store.submitReviewEvidence("github:ollama/ollama", {
      check_type: "pricing_and_free_limits",
      source_title: "Official pricing page",
      source_url: "https://ollama.com/pricing",
      excerpt: "Pricing details require human confirmation."
    }, Date.parse("2026-11-19T10:00:00.000Z"));
    expect(result).toMatchObject({
      accepted: true,
      source_status: "submitted_source_not_verified",
      review_status: "pending_human_review",
      verification_authorized: false,
      catalog_write_authorized: false,
      public_publication_authorized: false
    });
    const [evidence] = await store.listReviewEvidence("github:ollama/ollama");
    expect(evidence).toMatchObject({
      check_type: "pricing_and_free_limits",
      source_url: "https://ollama.com/pricing",
      source_status: "submitted_source_not_verified",
      review_status: "pending_human_review"
    });
  });

  it("rejects evidence for unknown candidates, unsupported checks, and unsafe URLs", async () => {
    const evidence = {
      check_type: "pricing_and_free_limits",
      source_title: "Pricing",
      source_url: "https://example.com/pricing",
      excerpt: "Evidence excerpt."
    };
    expect(await store.submitReviewEvidence("github:missing/tool", evidence)).toEqual({
      accepted: false, reason: "candidate_not_found"
    });
    await store.upsertCandidates([candidate()]);
    expect(await store.submitReviewEvidence("github:ollama/ollama", {
      ...evidence, check_type: "make_it_free"
    })).toEqual({ accepted: false, reason: "unsupported_check_type" });
    for (const source_url of [
      "http://example.com/pricing",
      "https://user:pass@example.com/pricing",
      "https://localhost/pricing",
      "https://127.0.0.1/pricing",
      "https://example.com/pricing?tracking=1",
      "https://example.com/pricing#fragment"
    ]) {
      expect(await store.submitReviewEvidence("github:ollama/ollama", {
        ...evidence, source_url
      })).toEqual({ accepted: false, reason: "invalid_evidence_url" });
    }
    expect(await store.listReviewEvidence("github:ollama/ollama")).toEqual([]);
  });

  it("deduplicates evidence URLs and enforces a bounded per-check evidence limit", async () => {
    await store.upsertCandidates([candidate()]);
    const makeEvidence = index => ({
      check_type: "license_scope",
      source_title: "License reference " + index,
      source_url: "https://example.com/license/" + index,
      excerpt: "License scope needs human review."
    });
    for (let index = 0; index < 5; index += 1) {
      expect((await store.submitReviewEvidence(
        "github:ollama/ollama", makeEvidence(index)
      )).accepted).toBe(true);
    }
    expect(await store.submitReviewEvidence(
      "github:ollama/ollama", makeEvidence(0)
    )).toEqual({ accepted: false, reason: "duplicate_evidence" });
    expect(await store.submitReviewEvidence(
      "github:ollama/ollama", makeEvidence(5)
    )).toEqual({ accepted: false, reason: "evidence_limit_reached" });
    expect(await store.listReviewEvidence("github:ollama/ollama", 30)).toHaveLength(5);
    await expect(Promise.resolve().then(() =>
      store.listReviewEvidence("github:ollama/ollama", 31)
    )).rejects.toThrow("invalid_evidence_list_limit");
  });

  it("builds an explicit six-part review packet without treating submitted evidence as verified", async () => {
    await store.upsertCandidates([candidate()]);
    await store.submitReviewEvidence("github:ollama/ollama", {
      check_type: "pricing_and_free_limits",
      source_title: "Pricing reference",
      source_url: "https://ollama.com/pricing",
      excerpt: "Pricing excerpt awaiting review."
    });
    await store.submitReviewEvidence("github:ollama/ollama", {
      check_type: "license_scope",
      source_title: "License reference",
      source_url: "https://github.com/ollama/ollama/blob/main/LICENSE",
      excerpt: "License excerpt awaiting review."
    });
    const packet = await store.getReviewPacket("github:ollama/ollama");
    expect(packet).toMatchObject({
      total_evidence: 2,
      checks_with_evidence: 2,
      checks_missing_evidence: 4,
      verification_status: "not_verified",
      human_review_required: true,
      catalog_write_authorized: false,
      public_publication_authorized: false
    });
    expect(packet.checklist).toHaveLength(6);
    expect(packet.evidence).toHaveLength(2);
    expect(packet.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        check_type: "pricing_and_free_limits",
        source_title: "Pricing reference",
        source_url: "https://ollama.com/pricing",
        source_status: "submitted_source_not_verified",
        review_status: "pending_human_review",
        verified: false,
        verification_authorized: false
      }),
      expect.objectContaining({
        check_type: "license_scope",
        source_title: "License reference",
        verified: false,
        verification_authorized: false
      })
    ]));
    expect(packet.checklist.find(item => item.check_type === "pricing_and_free_limits")).toMatchObject({
      evidence_count: 1,
      status: "evidence_pending_human_review",
      verified: false
    });
    expect(packet.checklist.find(item => item.check_type === "privacy_and_data_handling")).toMatchObject({
      evidence_count: 0,
      status: "evidence_missing",
      verified: false
    });
    expect(await store.getReviewPacket("github:missing/tool")).toBeNull();
  });


  it("does not carry evidence from an older release into a newer release review packet", async () => {
    await store.upsertCandidates([candidate()], Date.parse("2026-11-19T08:06:00.000Z"));
    await store.submitReviewEvidence("github:ollama/ollama", {
      check_type: "license_scope",
      source_title: "License for prior release",
      source_url: "https://github.com/ollama/ollama/blob/v1.2.3/LICENSE",
      excerpt: "This evidence belongs to release v1.2.3."
    }, Date.parse("2026-11-19T08:10:00.000Z"));

    const newer = candidate(sources[0], "v1.2.4", "2026-11-19T11:00:00.000Z");
    newer.discovered_at = "2026-11-19T11:05:00.000Z";
    await store.upsertCandidates([newer], Date.parse("2026-11-19T11:06:00.000Z"));

    const packet = await store.getReviewPacket("github:ollama/ollama");
    expect(packet.total_evidence).toBe(0);
    expect(packet.evidence).toEqual([]);
    expect(packet.checks_missing_evidence).toBe(6);
    const history = await store.listReviewEvidence("github:ollama/ollama");
    expect(history).toHaveLength(1);
    expect(history[0].candidate_release_url).toBe("https://github.com/ollama/ollama/releases/tag/v1.2.3");
    expect(packet.verification_status).toBe("not_verified");
  });

  it("reuses the same source as pending evidence for a newer release without losing its history", async () => {
    await store.upsertCandidates([candidate()], Date.parse("2026-11-19T08:06:00.000Z"));
    const evidence = {
      check_type: "license_scope",
      source_title: "Official license",
      source_url: "https://github.com/ollama/ollama/blob/main/LICENSE",
      excerpt: "License source must be reviewed for this release."
    };
    const first = await store.submitReviewEvidence(
      "github:ollama/ollama", evidence, Date.parse("2026-11-19T08:10:00.000Z")
    );
    expect(first.accepted).toBe(true);

    const newer = candidate(sources[0], "v1.2.4", "2026-11-19T11:00:00.000Z");
    newer.discovered_at = "2026-11-19T11:05:00.000Z";
    await store.upsertCandidates([newer], Date.parse("2026-11-19T11:06:00.000Z"));

    const second = await store.submitReviewEvidence(
      "github:ollama/ollama", evidence, Date.parse("2026-11-19T11:10:00.000Z")
    );
    expect(second).toMatchObject({ accepted: true, evidence_id: first.evidence_id });
    const packet = await store.getReviewPacket("github:ollama/ollama");
    expect(packet.total_evidence).toBe(1);
    const history = await store.listReviewEvidence("github:ollama/ollama");
    expect(history).toHaveLength(2);
    expect(new Set(history.map(item => item.candidate_release_url))).toEqual(new Set([
      "https://github.com/ollama/ollama/releases/tag/v1.2.3",
      "https://github.com/ollama/ollama/releases/tag/v1.2.4"
    ]));
    expect(await store.submitReviewEvidence(
      "github:ollama/ollama", evidence, Date.parse("2026-11-19T11:11:00.000Z")
    )).toEqual({ accepted: false, reason: "duplicate_evidence" });
  });

  it("applies the per-check evidence cap independently to each release version", async () => {
    await store.upsertCandidates([candidate()], Date.parse("2026-11-19T08:06:00.000Z"));
    const makeEvidence = (version, index) => ({
      check_type: "license_scope",
      source_title: "License reference " + version + " " + index,
      source_url: "https://example.com/license/" + version + "/" + index,
      excerpt: "License evidence awaiting human review."
    });
    for (let index = 0; index < 5; index += 1) {
      expect((await store.submitReviewEvidence(
        "github:ollama/ollama", makeEvidence("old", index)
      )).accepted).toBe(true);
    }

    const newer = candidate(sources[0], "v1.2.4", "2026-11-19T11:00:00.000Z");
    newer.discovered_at = "2026-11-19T11:05:00.000Z";
    await store.upsertCandidates([newer], Date.parse("2026-11-19T11:06:00.000Z"));

    for (let index = 0; index < 5; index += 1) {
      expect((await store.submitReviewEvidence(
        "github:ollama/ollama", makeEvidence("new", index)
      )).accepted).toBe(true);
    }
    expect(await store.submitReviewEvidence(
      "github:ollama/ollama", makeEvidence("new", 5)
    )).toEqual({ accepted: false, reason: "evidence_limit_reached" });
    const packet = await store.getReviewPacket("github:ollama/ollama");
    expect(packet.total_evidence).toBe(5);
    expect(packet.checklist.find(item => item.check_type === "license_scope").evidence_count).toBe(5);
  });


});