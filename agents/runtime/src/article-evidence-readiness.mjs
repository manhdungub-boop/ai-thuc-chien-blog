import { reviewArticleDraft } from "./article-quality-gate.mjs";
import { verifyHumanClaimReviewRecord } from "./human-review-record-verifier.mjs";

function removeFencedCode(markdown) {
  const kept = [];
  let fence = null;
  for (const line of markdown.split("\n")) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!fence && marker) {
      fence = { character: marker[1][0], length: marker[1].length };
      continue;
    }
    if (fence) {
      const closing = new RegExp("^ {0,3}" + fence.character + "{" + fence.length + ",}[ \\t]*$");
      if (closing.test(line)) fence = null;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

function removeInlineCode(markdown) {
  return markdown.replace(/`+[^\`]*?`+/g, " ");
}

function removeMarkdownLinks(markdown) {
  return markdown.replace(/!?\[[^\]]*\]\([^)]*\)/g, " ");
}

function proseCitationText(markdown) {
  return removeMarkdownLinks(removeInlineCode(markdown));
}

function normalizeClaimText(value) {
  return String(value ?? "")
    .replace(/`+([^`]*?)`+/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\p{P}\p{S}_]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("vi");
}

function findUnmanifestedQuantitativeCandidates(markdown, reviewedClaims) {
  const reviewed = reviewedClaims.map(normalizeClaimText).filter(Boolean);
  const candidates = [];
  const prose = removeFencedCode(markdown);
  const paragraphs = prose.split(/\n{2,}/);
  for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
    const withoutListMarkers = paragraph.split("\n")
      .map(line => line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, ""))
      .join("\n");
    const sentences = withoutListMarkers.split(/(?<=[.!?。！？])\s+|\n+/u);
    for (const sentence of sentences) {
      const candidate = sentence
        .replace(/!?\[[^\]]*\]\([^)]*\)/g, " ")
        .replace(/\[\d+\]/g, " ")
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
        .trim();
      if (!/\d/u.test(candidate)) continue;
      const normalized = normalizeClaimText(candidate);
      if (reviewed.some(claim => normalized === claim)) continue;
      candidates.push({
        paragraph_index: paragraphIndex + 1,
        excerpt: candidate.slice(0, 280),
        detection: "numeric_marker_requires_human_claim_mapping"
      });
    }
  }
  return candidates;
}

/**
 * Evaluate whether an article draft is traceable to claims explicitly reviewed
 * as supported. This is a release-readiness pre-check only; it never publishes.
 */
export async function assessArticleEvidenceReadiness({
  draft,
  ledger,
  reviewRecord,
  authenticatedReviewer = null,
  now = Date.now()
} = {}) {
  const reviewVerification = await verifyHumanClaimReviewRecord(reviewRecord, ledger, { now, authenticatedReviewer });
  if (!reviewVerification.ok) {
    return {
      ok: false,
      status: "human_review_record_not_verified",
      review_status: reviewVerification.status,
      evidence_summary: reviewVerification.evidence_summary,
      publication_authorized: false,
      content_published: false
    };
  }

  if (!draft || typeof draft !== "object" || Array.isArray(draft) ||
      !Array.isArray(draft.claims) || draft.claims.length < 1 ||
      draft.claims.length > 40) {
    return {
      ok: false,
      status: "article_claim_manifest_invalid",
      issues: [{ code: "claim_manifest_required", detail: "Provide 1–40 explicit factual claims with exact reviewed claim IDs, text, evidence URLs, and inline citation indices." }],
      publication_authorized: false,
      content_published: false
    };
  }

  const ledgerById = new Map(ledger.claims.map(claim => [claim.claim_id, claim]));
  const reviewById = new Map(reviewRecord.claims.map(claim => [claim.claim_id, claim]));
  const seen = new Set();
  const claimIssues = [];

  for (const item of draft.claims) {
    const id = item?.claim_id;
    if (typeof id !== "string" || seen.has(id)) {
      claimIssues.push({ code: "invalid_or_duplicate_claim_id", claim_id: typeof id === "string" ? id : null });
      continue;
    }
    seen.add(id);
    const sourceClaim = ledgerById.get(id);
    const reviewed = reviewById.get(id);
    if (!sourceClaim || !reviewed) {
      claimIssues.push({ code: "claim_not_in_reviewed_ledger", claim_id: id });
      continue;
    }
    if (item.claim !== sourceClaim.claim || item.claim !== reviewed.claim) {
      claimIssues.push({ code: "claim_text_mismatch", claim_id: id });
      continue;
    }
    if (reviewed.decision !== "supported") {
      claimIssues.push({ code: "claim_not_reviewed_as_supported", claim_id: id, decision: reviewed.decision });
      continue;
    }
    const expectedUrls = reviewed.evidence_urls;
    if (!Array.isArray(item.evidence_urls) ||
        item.evidence_urls.length !== expectedUrls.length ||
        item.evidence_urls.some((url, index) => url !== expectedUrls[index])) {
      claimIssues.push({ code: "claim_evidence_mapping_mismatch", claim_id: id });
    }
    if (!Array.isArray(item.citation_indices) ||
        item.citation_indices.length !== expectedUrls.length ||
        item.citation_indices.some(index => !Number.isInteger(index) || index < 1) ||
        new Set(item.citation_indices).size !== item.citation_indices.length) {
      claimIssues.push({ code: "claim_inline_citations_invalid", claim_id: id });
    }
  }

  if (claimIssues.length) {
    return {
      ok: false,
      status: "article_claim_evidence_not_ready",
      claims_assessed: draft.claims.length,
      issues: claimIssues,
      review_status: reviewVerification.status,
      evidence_summary: reviewVerification.evidence_summary,
      publication_authorized: false,
      content_published: false
    };
  }

  const articleSourceIndexByUrl = new Map();
  if (Array.isArray(draft.sources)) {
    for (const [index, source] of draft.sources.entries()) {
      try {
        const normalizedUrl = new URL(source?.url).href;
        if (!articleSourceIndexByUrl.has(normalizedUrl)) {
          articleSourceIndexByUrl.set(normalizedUrl, index + 1);
        }
      } catch {
        // The structural article gate reports malformed source records.
      }
    }
  }

  const body = typeof draft.body_markdown === "string" ? draft.body_markdown : "";
  const proseBody = removeFencedCode(body);
  const claimSentences = proseBody.split(/(?<=[.!?。！？])\s+(?!\[\d+\])|\n+/u);
  for (const item of draft.claims) {
    const normalizedClaim = normalizeClaimText(item.claim);
    const claimSentence = normalizedClaim
      ? claimSentences.find(sentence => normalizeClaimText(
          proseCitationText(sentence).replace(/\[\d+\]/g, " ")
        ) === normalizedClaim)
      : null;
    if (!claimSentence) {
      claimIssues.push({
        code: "reviewed_claim_missing_from_article_body",
        claim_id: item.claim_id
      });
      continue;
    }
    const expectedCitationIndices = item.evidence_urls.map(url => {
      try {
        return articleSourceIndexByUrl.get(new URL(url).href) ?? null;
      } catch {
        return null;
      }
    });
    if (expectedCitationIndices.some(index => index === null)) {
      claimIssues.push({
        code: "reviewed_evidence_missing_from_article_sources",
        claim_id: item.claim_id,
        evidence_urls: item.evidence_urls.filter(url => {
          try { return !articleSourceIndexByUrl.has(new URL(url).href); } catch { return true; }
        })
      });
      continue;
    }
    if (item.citation_indices.some((index, position) => index !== expectedCitationIndices[position])) {
      claimIssues.push({
        code: "claim_citation_source_order_mismatch",
        claim_id: item.claim_id,
        expected_citation_indices: expectedCitationIndices
      });
      continue;
    }
    for (const citationIndex of expectedCitationIndices) {
      if (!proseCitationText(claimSentence).includes(`[${citationIndex}]`)) {
        claimIssues.push({
          code: "claim_inline_citation_missing_from_body",
          claim_id: item.claim_id,
          citation_index: citationIndex
        });
      }
    }
  }

  const quantitativeCandidates = findUnmanifestedQuantitativeCandidates(
    body,
    draft.claims.map(item => item.claim)
  );
  for (const candidate of quantitativeCandidates) {
    claimIssues.push({
      code: "unreviewed_quantitative_claim_candidate",
      ...candidate
    });
  }

  if (claimIssues.length) {
    return {
      ok: false,
      status: "article_claim_evidence_not_ready",
      claims_assessed: draft.claims.length,
      issues: claimIssues,
      unreviewed_quantitative_claim_candidates: quantitativeCandidates,
      review_status: reviewVerification.status,
      evidence_summary: reviewVerification.evidence_summary,
      publication_authorized: false,
      content_published: false
    };
  }

  const articleQuality = reviewArticleDraft(draft);
  if (!articleQuality.ok) {
    return {
      ok: false,
      status: "article_quality_gate_failed",
      claims_assessed: draft.claims.length,
      article_quality: articleQuality,
      review_status: reviewVerification.status,
      evidence_summary: reviewVerification.evidence_summary,
      publication_authorized: false,
      content_published: false
    };
  }

  // SHA-256 fingerprints protect record integrity, but reviewer_ref is self-asserted.
  // Never treat a syntactically valid review record as an authenticated human approval.
  if (reviewVerification.safety?.reviewer_identity_authenticated !== true) {
    return {
      ok: false,
      status: "human_reviewer_identity_not_authenticated",
      claims_assessed: draft.claims.length,
      article_quality: articleQuality,
      review_status: reviewVerification.status,
      evidence_summary: reviewVerification.evidence_summary,
      reviewer_identity_authenticated: false,
      limitations: [
        "The review record matches the supplied ledger, but the reviewer identity is not authenticated.",
        "A reviewer reference is user-supplied metadata, not proof of account ownership or authorization.",
        "Configure a trusted identity and authorization mechanism before this gate can mark an article eligible for owner release review."
      ],
      publication_authorized: false,
      content_published: false,
      social_post_published: false
    };
  }

  return {
    ok: true,
    status: "eligible_for_owner_release_review",
    claims_assessed: draft.claims.length,
    article_quality: articleQuality,
    review_status: reviewVerification.status,
    evidence_summary: reviewVerification.evidence_summary,
    quantitative_claim_scan: { status: "heuristic_scan_completed", unreviewed_candidates: 0 },
    limitations: [
      "Only the explicitly supplied claim manifest is checked; this does not discover omitted factual claims in the article body.",
      "Inline citation indices are bound to the exact reviewed evidence URLs and source-list positions, but this does not prove semantic support.",
      "A supported decision is a recorded human judgment, not an independent fact-check or proof of truth.",
      "This gate does not assess originality, source authority, licensing, copyright clearance, or legal compliance.",
      "Owner release approval and separate deployment/publication gates remain mandatory."
    ],
    publication_authorized: false,
    content_published: false,
    social_post_published: false
  };
}
