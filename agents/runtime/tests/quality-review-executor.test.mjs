import { describe, expect, it, vi } from "vitest";
import { executeArticleQualityReview } from "../src/quality-review-executor.mjs";

const artifact = {
  id: "article-review-0001",
  artifact_type: "article",
  version: 3,
  status: "needs_revision",
  quality_review: {
    ok: false,
    status: "needs_revision",
    metrics: { word_count: 120, section_count: 2, source_count: 3 },
    issues: [{ code: "body_word_count", detail: "Article is too short." }],
    publication_authorized: false
  }
};

describe("article quality review task executor", () => {
  it("re-runs the deterministic gate for the exact current artifact version", async () => {
    const reviewDraft = vi.fn().mockResolvedValue({
      reviewed: true,
      artifact,
      human_review_required: true,
      publication_authorized: false
    });
    const draftStore = {
      getDraft: vi.fn().mockResolvedValue(artifact),
      reviewDraft
    };
    const result = await executeArticleQualityReview({
      draftStore,
      artifactId: artifact.id,
      artifactType: "article"
    });
    expect(draftStore.getDraft).toHaveBeenCalledWith(artifact.id);
    expect(reviewDraft).toHaveBeenCalledWith(artifact.id, 3);
    expect(result).toMatchObject({
      ok: true,
      status: "needs_revision",
      artifact_id: artifact.id,
      artifact_version: 3,
      artifact_status: "needs_revision",
      human_review_required: true,
      publication_authorized: false,
      external_calls: 0
    });
    expect(result.not_assessed).toContain("factual accuracy or semantic claim support");
  });

  it("keeps a passing structure review in the human-review-only state", async () => {
    const eligible = {
      ...artifact,
      status: "pending_human_review",
      quality_review: {
        ok: true,
        status: "eligible_for_human_review",
        metrics: { word_count: 800, section_count: 5, source_count: 3 },
        issues: [],
        publication_authorized: false
      }
    };
    const draftStore = {
      getDraft: vi.fn().mockResolvedValue(eligible),
      reviewDraft: vi.fn().mockResolvedValue({ reviewed: true, artifact: eligible })
    };
    const result = await executeArticleQualityReview({
      draftStore, artifactId: eligible.id, artifactType: "article"
    });
    expect(result.status).toBe("eligible_for_human_review");
    expect(result.publication_authorized).toBe(false);
    expect(result.human_review_required).toBe(true);
  });

  it("rejects unsupported artifact types without touching the store", async () => {
    const draftStore = { getDraft: vi.fn(), reviewDraft: vi.fn() };
    const result = await executeArticleQualityReview({
      draftStore, artifactId: artifact.id, artifactType: "ai_tool"
    });
    expect(result.status).toBe("unsupported_quality_review_artifact_type");
    expect(draftStore.getDraft).not.toHaveBeenCalled();
  });

  it("fails closed for missing artifacts and optimistic version conflicts", async () => {
    const missing = await executeArticleQualityReview({
      draftStore: { getDraft: vi.fn().mockResolvedValue(null), reviewDraft: vi.fn() },
      artifactId: artifact.id, artifactType: "article"
    });
    expect(missing.status).toBe("quality_review_artifact_not_found");

    const conflict = await executeArticleQualityReview({
      draftStore: {
        getDraft: vi.fn().mockResolvedValue(artifact),
        reviewDraft: vi.fn().mockResolvedValue({ reviewed: false, reason: "version_conflict" })
      },
      artifactId: artifact.id, artifactType: "article"
    });
    expect(conflict.status).toBe("version_conflict");
    expect(conflict.publication_authorized).toBe(false);
  });

  it("rejects malformed artifact IDs and incomplete store bindings", async () => {
    const malformed = await executeArticleQualityReview({
      draftStore: {}, artifactId: "bad", artifactType: "article"
    });
    expect(malformed.status).toBe("invalid_quality_review_request");
  });
});
