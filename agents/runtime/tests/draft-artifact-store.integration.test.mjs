import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "./test-compat.mjs";
import { createLegacyStoresRuntime } from "./legacy-stores-test-harness.mjs";
import { recordHumanClaimReview } from "../src/human-claim-review.mjs";
import { buildArticleAuthoringBrief } from "../src/article-authoring-brief.mjs";

const sources = [
  { title: "Official source one", publisher: "OpenAI News", url: "https://openai.com/index/paper", accessed_at: "2026-11-18T00:00:00.000Z" },
  { title: "Official source two", publisher: "Google DeepMind", url: "https://deepmind.google/blog/report", accessed_at: "2026-11-18T00:00:00.000Z" },
  { title: "Official source three", publisher: "Hugging Face", url: "https://huggingface.co/blog/guide", accessed_at: "2026-11-18T00:00:00.000Z" }
];
function validDraft() {
  const p = "Trí tuệ nhân tạo đang thay đổi cách tổ chức nghiên cứu, phát triển phần mềm và tự động hóa quy trình. Các nhóm triển khai cần xác định mục tiêu, giới hạn dữ liệu, đánh giá kết quả và giám sát rủi ro trước khi đưa hệ thống vào sử dụng. ";
  const body = ["## Tổng quan",p.repeat(8)+"[1]","## Kiến trúc hệ thống",p.repeat(8)+"[2]","## Quy trình triển khai",p.repeat(8)+"[3]","## An toàn và quản trị",p.repeat(8),"## Kết luận",p.repeat(4)].join("\n\n");
  return {
    title: "Xây dựng hệ thống AI agent an toàn và hiệu quả",
    slug: "xay-dung-he-thong-ai-agent-an-toan",
    meta_description: "Hướng dẫn xây dựng hệ thống AI agent có kiểm soát, an toàn, minh bạch và hiệu quả cho quy trình tự động hóa trong thực tế triển khai.",
    author: "DUNG - AI", language: "vi", body_markdown: body, sources: sources.map(source => ({ ...source })),
    copyright_notice: "© DUNG - AI. Bản quyền nội dung thuộc về tác giả; các nguồn tham khảo được ghi nhận riêng."
  };
}
describe("AgentDraftStore Durable Object", () => {
  let store; let runtime; let testIndex = 0;
  beforeEach(async () => {
    testIndex += 1;
    runtime = await createLegacyStoresRuntime();
    store = runtime.drafts.get(runtime.drafts.idFromName("agent-draft-store-test-" + testIndex));
  });
  afterEach(async () => {
    await runtime?.mf.dispose();
  });

  it("passes the isolated Google reviewer auth configuration into the Durable Object", async () => {
    expect(await store.getTestAuthConfig()).toMatchObject({
      enabled: "true",
      clientIdLength: 76,
      clientSecretLength: 68,
      redirectUri: "https://ai-thuc-chien-agent-runtime-preview.manhdungub.workers.dev/auth/google/callback",
      allowedEmails: "reviewer@example.com",
      stateSecretLength: 64,
      sessionSecretLength: 66
    });
  });
  it("stores an eligible article only in the human-review queue", async () => {
    const result = await store.createDraft("draft-review-0001", validDraft());
    expect(result.accepted).toBe(true);
    expect(result.artifact.status).toBe("pending_human_review");
    expect(result.artifact.quality_review.publication_authorized).toBe(false);
    expect(result.artifact.quality_review.provider_id).toBe("article-quality-gate");
    expect(await store.listPendingReviews()).toHaveLength(1);
    expect(await store.stats()).toEqual({ pending_human_review: 1 });
  });
  it("persists a research-backed authoring scaffold only as needs_revision, never in the review queue", async () => {
    const evidence = [
      { source: "OpenAI News", title: "OpenAI research update", url: "https://openai.com/index/research-update", retrieved_at: "2026-11-19T00:00:00.000Z", status: "source_retrieved_not_fact_checked", excerpt: "A retrieved passage containing source context, method descriptions, limitations, and reported research details for later human inspection." },
      { source: "Google DeepMind", title: "DeepMind research report", url: "https://deepmind.google/blog/research-report", retrieved_at: "2026-11-19T00:00:00.000Z", status: "source_retrieved_not_fact_checked", excerpt: "A second retrieved passage describing the research context, stated methodology, limitations, and findings for later human inspection." },
      { source: "Hugging Face", title: "Hugging Face engineering article", url: "https://huggingface.co/blog/engineering-article", retrieved_at: "2026-11-19T00:00:00.000Z", status: "source_retrieved_not_fact_checked", excerpt: "A third retrieved passage outlining platform engineering context, reported implementation details, and limitations for human inspection." }
    ];
    const brief = buildArticleAuthoringBrief({
      topic: "Ứng dụng AI Agent trong tự động hóa công việc và phát triển sản phẩm",
      researchEvidence: evidence
    });
    expect(brief.prepared).toBe(true);
    const result = await store.createDraft("article-brief-scaffold-01", brief.draft);
    expect(result.accepted).toBe(true);
    expect(result.artifact.status).toBe("needs_revision");
    expect(result.artifact.quality_review.ok).toBe(false);
    expect(result.artifact.draft.claims).toBeUndefined();
    expect(result.artifact.quality_review.publication_authorized).toBe(false);
    expect(await store.listPendingReviews()).toHaveLength(0);
    const authoringQueue = await store.listNeedsRevision(20);
    expect(authoringQueue).toHaveLength(1);
    expect(authoringQueue[0]).toMatchObject({
      id: "article-brief-scaffold-01",
      status: "needs_revision",
      title: brief.draft.title
    });
    expect(authoringQueue[0]).not.toHaveProperty("body_markdown");
  });

  it("re-runs quality review against an exact artifact version without authorizing publication", async () => {
    const created = await store.createDraft("draft-review-rerun-01", validDraft());
    const reviewed = await store.reviewDraft("draft-review-rerun-01", created.artifact.version);
    expect(reviewed.reviewed).toBe(true);
    expect(reviewed.artifact.version).toBe(created.artifact.version);
    expect(reviewed.artifact.status).toBe("pending_human_review");
    expect(reviewed.artifact.quality_review.ok).toBe(true);
    expect(reviewed.human_review_required).toBe(true);
    expect(reviewed.publication_authorized).toBe(false);

    const stale = await store.reviewDraft("draft-review-rerun-01", 99);
    expect(stale).toMatchObject({ reviewed: false, reason: "version_conflict", current_version: 1 });
    expect(await store.reviewDraft("missing-review-0001", 1))
      .toEqual({ reviewed: false, reason: "artifact_not_found" });
  });

  it("routes failed quality checks to needs_revision", async () => {
    const draft = validDraft(); draft.author = "Unverified Author";
    const result = await store.createDraft("draft-review-0002", draft);
    expect(result.artifact.status).toBe("needs_revision");
    expect(result.artifact.quality_review.publication_authorized).toBe(false);
    expect(await store.listPendingReviews()).toHaveLength(0);
  });
  it("is idempotent and rejects artifact ID collisions", async () => {
    const draft = validDraft();
    expect((await store.createDraft("draft-review-0003", draft)).accepted).toBe(true);
    expect((await store.createDraft("draft-review-0003", draft)).duplicate).toBe(true);
    expect(await store.createDraft("draft-review-0003", { ...draft, title: "Different title" }))
      .toEqual({ accepted: false, reason: "artifact_id_conflict" });
  });
  it("uses optimistic version checks for revisions", async () => {
    await store.createDraft("draft-review-0004", validDraft());
    const revised = validDraft(); revised.title = "Xây dựng hệ thống AI agent an toàn và hiệu quả hơn";
    const result = await store.reviseDraft("draft-review-0004", 1, revised);
    const stale = await store.reviseDraft("draft-review-0004", 1, validDraft());
    expect(result.artifact.version).toBe(2);
    expect(stale).toMatchObject({ updated: false, reason: "version_conflict", current_version: 2 });
  });
  it("rejects unknown fields, malformed sources, and oversized artifacts", async () => {
    expect(await store.createDraft("draft-review-0005", { ...validDraft(), publish: true }))
      .toEqual({ accepted: false, reason: "draft_schema_mismatch" });
    const malformed = validDraft(); malformed.sources[0] = { title: "bad" };
    expect(await store.createDraft("draft-review-0006", malformed))
      .toEqual({ accepted: false, reason: "invalid_source_shape" });
    const oversized = validDraft(); oversized.body_markdown = "x".repeat(50 * 1024);
    expect(await store.createDraft("draft-review-0007", oversized))
      .toEqual({ accepted: false, reason: "invalid_body_markdown" });
  });

  it("persists retrieved source excerpts as a pending ledger bound to the exact draft version", async () => {
    const draft = validDraft();
    draft.claims = [{
      claim_id: "claim-ledger-01",
      claim: "The draft store binds evidence to a specific article version.",
      evidence_urls: [sources[0].url, sources[1].url],
      citation_indices: [1, 2]
    }];
    const retrievedEvidence = [
      {
        source: "OpenAI News", title: "Evidence storage", url: sources[0].url,
        retrieved_at: "2026-11-19T00:00:00.000Z", status: "source_retrieved_not_fact_checked",
        excerpt: "This retrieved excerpt describes evidence storage, version binding, review snapshots, and the separation between human review and publication."
      },
      {
        source: "Google DeepMind", title: "Review workflow", url: sources[1].url,
        retrieved_at: "2026-11-19T00:00:00.000Z", status: "source_retrieved_not_fact_checked",
        excerpt: "This second retrieved excerpt describes review workflow controls, evidence traceability, versioned records, and independent human assessment."
      }
    ];
    const created = await store.createDraft("draft-ledger-0001", draft, retrievedEvidence);
    expect(created.artifact.research_evidence).toHaveLength(2);
    const result = await store.storeEvidenceLedger("draft-ledger-0001", created.artifact.version);
    expect(result.stored).toBe(true);
    expect(result.artifact.version).toBe(2);
    expect(result.artifact.evidence_review).toMatchObject({
      ledger: {
        status: "all_claims_traceable_pending_human_review",
        draft_version: 1,
        claims: [{
          claim_id: "claim-ledger-01",
          status: "traceable_evidence_pending_human_review"
        }]
      },
      review_record: null,
      readiness: null
    });
    expect(result.publication_authorized).toBe(false);
  });

  it("requires a verified Google reviewer session before authoring revisions or claim decisions", async () => {
    const created = await store.createDraft("draft-reviewer-auth-01", validDraft());
    const revised = await store.reviseDraftForReviewer(
      "draft-reviewer-auth-01", created.artifact.version, validDraft(), undefined
    );
    expect(revised).toMatchObject({
      authorized: false,
      updated: false,
      reason: "reviewer_auth_not_configured"
    });
    const decision = await store.recordReviewerClaimDecisions(
      "draft-reviewer-auth-01", created.artifact.version, [], undefined
    );
    expect(decision).toMatchObject({
      authorized: false,
      recorded: false,
      reason: "reviewer_auth_not_configured"
    });
    expect((await store.getDraft("draft-reviewer-auth-01")).version).toBe(1);
  });

  it("rejects unverified, duplicate, or oversized research excerpts at artifact creation", async () => {
    const validEvidence = [{
      source: "OpenAI News",
      title: "Research evidence",
      url: "https://openai.com/index/research-evidence",
      retrieved_at: "2026-11-19T00:00:00.000Z",
      status: "source_retrieved_not_fact_checked",
      excerpt: "A sufficiently long retrieved source excerpt describing the research context, method, limitations and reported observations for a human reviewer to inspect."
    }];
    expect(await store.createDraft("draft-evidence-invalid-01", validDraft(), [
      { ...validEvidence[0], status: "http_403" }
    ])).toMatchObject({ accepted: false, reason: "invalid_retrieved_evidence_item" });
    expect(await store.createDraft("draft-evidence-invalid-02", validDraft(), [
      validEvidence[0], validEvidence[0]
    ])).toMatchObject({ accepted: false, reason: "retrieved_evidence_url_or_publisher_rejected" });
  });

  it("rejects stale, duplicate, unverified, or incomplete evidence-ledger writes", async () => {
    const draft = validDraft();
    draft.claims = [{
      claim_id: "claim-ledger-02",
      claim: "The draft store rejects incomplete evidence ledgers.",
      evidence_urls: [sources[0].url, sources[1].url],
      citation_indices: [1, 2]
    }];
    const created = await store.createDraft("draft-ledger-0002", draft);
    const evidence = [
      { source: "OpenAI News", title: "A", url: sources[0].url, status: "source_retrieved_not_fact_checked", excerpt: "A sufficiently long retrieved source excerpt describing the evidence process, its constraints, and the exact technical behavior for a reviewer." },
      { source: "Google DeepMind", title: "B", url: sources[1].url, status: "source_retrieved_not_fact_checked", excerpt: "A second sufficiently long retrieved source excerpt describing the evidence process, its constraints, and the exact technical behavior for a reviewer." }
    ];
    expect(await store.storeEvidenceLedger("draft-ledger-0002", 2, evidence))
      .toMatchObject({ stored: false, reason: "version_conflict", current_version: 1 });
    expect(await store.storeEvidenceLedger("draft-ledger-0002", 1, [evidence[0]]))
      .toMatchObject({ stored: false, reason: "invalid_retrieved_evidence_batch" });
    expect((await store.storeEvidenceLedger("draft-ledger-0002", 1, [{ ...evidence[0], status: "http_404" }, evidence[1]])).stored)
      .toBe(false);
    expect((await store.storeEvidenceLedger("draft-ledger-0002", 1, evidence)).stored).toBe(true);
    expect(await store.storeEvidenceLedger("draft-ledger-0002", 2, evidence))
      .toMatchObject({ stored: false, reason: "evidence_ledger_already_exists" });
  });

  it("invalidates a persisted evidence ledger when the article draft is revised", async () => {
    const draft = validDraft();
    draft.claims = [{
      claim_id: "claim-ledger-03",
      claim: "The ledger is invalidated when article content changes.",
      evidence_urls: [sources[0].url, sources[1].url],
      citation_indices: [1, 2]
    }];
    const created = await store.createDraft("draft-ledger-0003", draft);
    const evidence = [
      { source: "OpenAI News", title: "A", url: sources[0].url, status: "source_retrieved_not_fact_checked", excerpt: "A sufficiently long retrieved source excerpt describing versioned article review and evidence invalidation after a content change." },
      { source: "Google DeepMind", title: "B", url: sources[1].url, status: "source_retrieved_not_fact_checked", excerpt: "A second sufficiently long retrieved source excerpt describing versioned article review and evidence invalidation after a content change." }
    ];
    const stored = await store.storeEvidenceLedger("draft-ledger-0003", created.artifact.version, evidence);
    const revisedDraft = { ...draft, title: "Bản sửa đổi có phiên bản mới" };
    const revised = await store.reviseDraft("draft-ledger-0003", stored.artifact.version, revisedDraft);
    expect(revised.updated).toBe(true);
    expect(revised.artifact.version).toBe(3);
    expect(revised.artifact.evidence_review).toBeNull();
  });

  it("rejects evidence-review writes without a cryptographically verified Google session", async () => {
    const draft = validDraft();
    const claim = "The draft store keeps article evidence reviews isolated.";
    draft.claims = [{
      claim_id: "claim-store-1",
      claim,
      evidence_urls: [sources[0].url, sources[1].url],
      citation_indices: [1, 2]
    }];
    const created = await store.createDraft("draft-review-0009", draft);
    const ledgerSources = [
      { source: "OpenAI News", title: "One", url: sources[0].url, host: "openai.com", excerpt: "This source describes isolated article evidence storage, review snapshots, and the limits of what a persisted record can establish. ".repeat(2).slice(0, 180) },
      { source: "Google DeepMind", title: "Two", url: sources[1].url, host: "deepmind.google", excerpt: "This second source describes controlled review workflows, evidence traceability, and the separation between review and publication. ".repeat(2).slice(0, 180) }
    ];
    const ledger = {
      status: "all_claims_traceable_pending_human_review",
      safety: { human_review_required: true, publication_authorized: false },
      claims: [{
        claim_id: "claim-store-1",
        claim,
        status: "traceable_evidence_pending_human_review",
        sources: ledgerSources
      }]
    };
    const now = Date.now();
    const reviewRecord = await recordHumanClaimReview(
      ledger,
      [{ claim_id: "claim-store-1", decision: "supported", reviewer_note: "Both cited excerpts address the stated storage behavior.", evidence_reviews: [{ source_url: sources[0].url, decision: "supports", reviewer_note: "The first passage directly supports the exact storage behavior described." }, { source_url: sources[1].url, decision: "supports", reviewer_note: "The second passage independently supports the exact storage behavior described." }] }],
      { reviewer_ref: "editor.dung", reviewed_at: new Date(now - 60_000).toISOString() },
      { now }
    );
    const recorded = await store.recordEvidenceReview("draft-review-0009", created.artifact.version, ledger, reviewRecord);
    expect(recorded).toMatchObject({ recorded: false, reason: "reviewer_auth_not_configured" });
    expect((await store.getDraft("draft-review-0009")).evidence_review).toBeNull();
    expect(await store.listOwnerReleaseReviews()).toHaveLength(0);
  });

  it("rejects tampered and valid evidence-review writes when no signed reviewer session is supplied", async () => {
    const draft = validDraft();
    draft.claims = [{
      claim_id: "claim-store-2",
      claim: "The draft store keeps article evidence reviews isolated.",
      evidence_urls: [sources[0].url, sources[1].url],
      citation_indices: [1, 2]
    }];
    const created = await store.createDraft("draft-review-0010", draft);
    const ledgerSources = [
      { source: "OpenAI News", title: "One", url: sources[0].url, host: "openai.com", excerpt: "This source describes isolated article evidence storage, review snapshots, and the limits of what a persisted record can establish. ".repeat(2).slice(0, 180) },
      { source: "Google DeepMind", title: "Two", url: sources[1].url, host: "deepmind.google", excerpt: "This second source describes controlled review workflows, evidence traceability, and the separation between review and publication. ".repeat(2).slice(0, 180) }
    ];
    const ledger = {
      status: "all_claims_traceable_pending_human_review",
      safety: { human_review_required: true, publication_authorized: false },
      claims: [{
        claim_id: "claim-store-2",
        claim: draft.claims[0].claim,
        status: "traceable_evidence_pending_human_review",
        sources: ledgerSources
      }]
    };
    const now = Date.parse("2026-11-18T12:01:00.000Z");
    const reviewRecord = await recordHumanClaimReview(
      ledger,
      [{ claim_id: "claim-store-2", decision: "supported", reviewer_note: "Both cited excerpts address the stated storage behavior.", evidence_reviews: [{ source_url: sources[0].url, decision: "supports", reviewer_note: "The first passage directly supports the exact storage behavior described." }, { source_url: sources[1].url, decision: "supports", reviewer_note: "The second passage independently supports the exact storage behavior described." }] }],
      { reviewer_ref: "editor.dung", reviewed_at: new Date(now - 60_000).toISOString() },
      { now }
    );
    const tampered = {
      ...reviewRecord,
      claims: reviewRecord.claims.map(item => ({ ...item, reviewer_note: "Changed reviewer note after fingerprinting." }))
    };
    const rejected = await store.recordEvidenceReview("draft-review-0010", created.artifact.version, ledger, tampered);
    expect(rejected).toMatchObject({ recorded: false, reason: "reviewer_auth_not_configured" });
    const recorded = await store.recordEvidenceReview("draft-review-0010", created.artifact.version, ledger, reviewRecord);
    expect(recorded).toMatchObject({ recorded: false, reason: "reviewer_auth_not_configured" });
    expect((await store.getDraft("draft-review-0010")).evidence_review).toBeNull();
    expect(await store.listOwnerReleaseReviews()).toHaveLength(0);
  });

  it("rejects malformed claim manifests before storing an article", async () => {
    const draft = validDraft();
    draft.claims = [{
      claim_id: "claim-store-3",
      claim: "A claim",
      evidence_urls: ["http://insecure.example/source", "https://research-two.example/report"],
      citation_indices: [1, 2]
    }];
    expect(await store.createDraft("draft-review-0011", draft))
      .toEqual({ accepted: false, reason: "invalid_claim_evidence_url" });
  });
  it("rejects oversized evidence-review payloads before fingerprint verification or storage", async () => {
    const draft = validDraft();
    draft.claims = [{
      claim_id: "claim-store-oversize",
      claim: "The draft store rejects oversized evidence review payloads.",
      evidence_urls: [sources[0].url, sources[1].url],
      citation_indices: [1, 2]
    }];
    const created = await store.createDraft("draft-review-oversize", draft);
    const oversizedLedger = { padding: "x".repeat(50 * 1024) };
    const result = await store.recordEvidenceReview(
      "draft-review-oversize",
      created.artifact.version,
      oversizedLedger,
      {}
    );
    expect(result).toEqual({ recorded: false, reason: "evidence_review_too_large" });
    expect((await store.getDraft("draft-review-oversize")).evidence_review).toBeNull();
  });

  it("requires a cryptographically verified reviewer session for queue metadata and full draft reads", async () => {
    await store.createDraft("draft-review-auth-01", validDraft());
    const queue = await store.listPendingReviewsForReviewer(20, "forged-session");
    const authoringQueue = await store.listNeedsRevisionForReviewer(20, "forged-session");
    const detail = await store.getDraftForReviewer("draft-review-auth-01", "forged-session");
    expect(queue).toMatchObject({ authorized: false, reason: "reviewer_auth_not_configured" });
    expect(authoringQueue).toMatchObject({ authorized: false, reason: "reviewer_auth_not_configured" });
    expect(detail).toMatchObject({ authorized: false, reason: "reviewer_auth_not_configured" });
  });

  it("returns bounded queue metadata and retrieves full content by ID", async () => {
    const draft = validDraft(); await store.createDraft("draft-review-0008", draft);
    const [item] = await store.listPendingReviews(1000);
  