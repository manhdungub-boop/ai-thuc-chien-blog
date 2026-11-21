const ARTIFACT_ID = /^[a-zA-Z0-9._:-]{8,128}$/;

export async function executeArticleQualityReview({ draftStore, artifactId, artifactType }) {
  if (artifactType !== "article") {
    return {
      ok: false,
      status: "unsupported_quality_review_artifact_type",
      publication_authorized: false,
      external_calls: 0
    };
  }
  if (typeof artifactId !== "string" || !ARTIFACT_ID.test(artifactId) ||
      !draftStore || typeof draftStore.getDraft !== "function" ||
      typeof draftStore.reviewDraft !== "function") {
    return {
      ok: false,
      status: "invalid_quality_review_request",
      publication_authorized: false,
      external_calls: 0
    };
  }

  const current = await draftStore.getDraft(artifactId);
  if (!current) {
    return {
      ok: false,
      status: "quality_review_artifact_not_found",
      publication_authorized: false,
      external_calls: 0
    };
  }
  if (current.artifact_type !== "article" || !Number.isInteger(current.version) || current.version < 1) {
    return {
      ok: false,
      status: "quality_review_artifact_mismatch",
      publication_authorized: false,
      external_calls: 0
    };
  }

  const result = await draftStore.reviewDraft(artifactId, current.version);
  if (!result?.reviewed) {
    return {
      ok: false,
      status: result?.reason || "quality_review_persistence_failed",
      publication_authorized: false,
      external_calls: 0
    };
  }
  const review = result.artifact.quality_review;
  return {
    ok: true,
    status: review.ok ? "eligible_for_human_review" : "needs_revision",
    artifact_id: result.artifact.id,
    artifact_version: result.artifact.version,
    artifact_status: result.artifact.status,
    quality_review: review,
    human_review_required: true,
    publication_authorized: false,
    review_scope: [
      "article structure and metadata",
      "author attribution and copyright notice presence",
      "minimum length and section count",
      "HTTPS source metadata and duplicate URLs",
      "inline citation index consistency",
      "unsafe active markup patterns"
    ],
    not_assessed: [
      "factual accuracy or semantic claim support",
      "source authority or source independence",
      "originality and plagiarism",
      "copyright ownership, license compatibility, or permission to reuse media",
      "image provenance and accessibility",
      "search ranking or real-world SEO performance"
    ],
    external_calls: 0
  };
}
