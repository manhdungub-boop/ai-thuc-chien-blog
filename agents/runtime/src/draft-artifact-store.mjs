import { DurableObject } from "cloudflare:workers";
import { reviewArticleDraft } from "./article-quality-gate.mjs";
import { selectProvider } from "./provider-policy.mjs";
import { assessArticleEvidenceReadiness } from "./article-evidence-readiness.mjs";
import { verifyGoogleReviewerSessionToken } from "./google-reviewer-oauth.mjs";
import { buildHumanClaimReviewLedger } from "./human-claim-ledger-builder.mjs";
import { recordHumanClaimReview } from "./human-claim-review.mjs";
import { classifyResearchPublisher } from "./research-publisher-policy.mjs";

const MAX_ARTIFACT_BYTES = 48 * 1024;
const MAX_EVIDENCE_REVIEW_BYTES = 48 * 1024;
const MAX_RESEARCH_EVIDENCE_BYTES = 12 * 1024;
const MAX_SOURCES = 20;
const MAX_CLAIMS = 40;
const ID_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/;
const CLAIM_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,63}$/;
const DRAFT_KEYS = new Set(["title","slug","meta_description","author","language","body_markdown","sources","copyright_notice","claims"]);
const REQUIRED_DRAFT_KEYS = ["title","slug","meta_description","author","language","body_markdown","sources","copyright_notice"];
const SOURCE_KEYS = new Set(["title","publisher","url","accessed_at"]);
const CLAIM_KEYS = new Set(["claim_id","claim","evidence_urls","citation_indices"]);

function runPolicyGatedQualityReview(draft) {
  const admission = selectProvider("quality_review", [{
    id: "article-quality-gate",
    status: "ready",
    execution_surface: "agent_runtime",
    cost_class: "no_external_execution",
    capabilities: ["quality_review"]
  }]);
  if (admission.action !== "execute" || admission.provider !== "article-quality-gate") {
    return {
      ok: false,
      status: "quality_review_deferred",
      provider_id: null,
      issues: [{ code: "quality_review_provider_deferred", detail: admission.reason }],
      publication_authorized: false
    };
  }
  return { ...reviewArticleDraft(draft), provider_id: admission.provider };
}

function validateClaimManifest(claims) {
  if (claims === undefined) return { ok: true };
  if (!Array.isArray(claims) || claims.length < 1 || claims.length > MAX_CLAIMS) {
    return { ok: false, reason: "invalid_claim_manifest" };
  }
  const seen = new Set();
  for (const claim of claims) {
    if (!claim || typeof claim !== "object" || Array.isArray(claim) ||
        Object.keys(claim).some(key => !CLAIM_KEYS.has(key)) ||
        Object.keys(claim).length !== CLAIM_KEYS.size ||
        typeof claim.claim_id !== "string" || !CLAIM_ID_PATTERN.test(claim.claim_id) ||
        seen.has(claim.claim_id) ||
        typeof claim.claim !== "string" || !claim.claim.trim() || claim.claim.length > 500 ||
        !Array.isArray(claim.evidence_urls) || claim.evidence_urls.length < 2 ||
        claim.evidence_urls.length > 4 ||
        !Array.isArray(claim.citation_indices) ||
        claim.citation_indices.length !== claim.evidence_urls.length ||
        claim.citation_indices.some(index => !Number.isInteger(index) || index < 1) ||
        new Set(claim.citation_indices).size !== claim.citation_indices.length) {
      return { ok: false, reason: "invalid_claim_manifest_entry" };
    }
    const urls = new Set();
    for (const value of claim.evidence_urls) {
      if (typeof value !== "string" || value.length > 2048) return { ok: false, reason: "invalid_claim_evidence_url" };
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
            url.hash || url.href !== value || urls.has(url.href)) {
          return { ok: false, reason: "invalid_claim_evidence_url" };
        }
        urls.add(url.href);
      } catch {
        return { ok: false, reason: "invalid_claim_evidence_url" };
      }
    }
    seen.add(claim.claim_id);
  }
  return { ok: true };
}

function validateRetrievedEvidence(evidence) {
  if (!Array.isArray(evidence) || evidence.length > 4) {
    return { ok: false, reason: "invalid_retrieved_evidence_batch" };
  }
  const seen = new Set();
  for (const item of evidence) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        item.status !== "source_retrieved_not_fact_checked" ||
        typeof item.source !== "string" || !item.source.trim() || item.source.length > 80 ||
        typeof item.title !== "string" || !item.title.trim() || item.title.length > 120 ||
        typeof item.url !== "string" || item.url.length > 2048 ||
        typeof item.excerpt !== "string" || item.excerpt.trim().length < 80 || item.excerpt.length > 600 ||
        typeof item.retrieved_at !== "string" || !Number.isFinite(Date.parse(item.retrieved_at))) {
      return { ok: false, reason: "invalid_retrieved_evidence_item" };
    }
    try {
      const url = new URL(item.url);
      if (url.protocol !== "https:" || url.username || url.password ||
          (url.port && url.port !== "443") || url.search || url.hash || url.href !== item.url ||
          !classifyResearchPublisher(item.source, url.href).accepted || seen.has(url.href)) {
        return { ok: false, reason: "retrieved_evidence_url_or_publisher_rejected" };
      }
      seen.add(url.href);
    } catch {
      return { ok: false, reason: "retrieved_evidence_url_or_publisher_rejected" };
    }
  }
  const json = JSON.stringify(evidence);
  if (new TextEncoder().encode(json).byteLength > MAX_RESEARCH_EVIDENCE_BYTES) {
    return { ok: false, reason: "retrieved_evidence_too_large" };
  }
  return { ok: true, json };
}

function validateDraft(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return { ok: false, reason: "draft_must_be_object" };
  if (Object.keys(draft).some(key => !DRAFT_KEYS.has(key)) || REQUIRED_DRAFT_KEYS.some(key => !(key in draft))) {
    return { ok: false, reason: "draft_schema_mismatch" };
  }
  const limits = { title: 200, slug: 120, meta_description: 300, author: 80, language: 8, body_markdown: MAX_ARTIFACT_BYTES, copyright_notice: 500 };
  for (const [key, max] of Object.entries(limits)) {
    if (typeof draft[key] !== "string" || draft[key].length > max) return { ok: false, reason: "invalid_" + key };
  }
  if (!Array.isArray(draft.sources) || draft.sources.length > MAX_SOURCES) return { ok: false, reason: "invalid_sources" };
  for (const source of draft.sources) {
    if (!source || typeof source !== "object" || Array.isArray(source) ||
        Object.keys(source).some(key => !SOURCE_KEYS.has(key)) ||
        [...SOURCE_KEYS].some(key => typeof source[key] !== "string" || source[key].length > 2048)) {
      return { ok: false, reason: "invalid_source_shape" };
    }
  }
  const manifest = validateClaimManifest(draft.claims);
  if (!manifest.ok) return manifest;
  const json = JSON.stringify(draft);
  if (new TextEncoder().encode(json).byteLength > MAX_ARTIFACT_BYTES) return { ok: false, reason: "artifact_too_large" };
  return { ok: true, json };
}

function parseEvidenceReview(row) {
  if (!row.ledger_json) return null;
  return {
    ledger: JSON.parse(row.ledger_json),
    review_record: row.review_record_json ? JSON.parse(row.review_record_json) : null,
    readiness: row.evidence_readiness_json ? JSON.parse(row.evidence_readiness_json) : null
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function safeArtifact(row) {
  return {
    id: row.id, artifact_type: "article", status: row.status, version: row.version, content_version: row.content_version ?? 1,
    draft: JSON.parse(row.draft_json), quality_review: JSON.parse(row.quality_review_json),
    research_evidence: row.research_evidence_json ? JSON.parse(row.research_evidence_json) : [],
    evidence_review: parseEvidenceReview(row),
    created_at: row.created_at, updated_at: row.updated_at
  };
}

function queueItem(row) {
  const review = JSON.parse(row.quality_review_json);
  const draft = JSON.parse(row.draft_json);
  const evidenceReview = row.evidence_readiness_json ? JSON.parse(row.evidence_readiness_json) : null;
  return {
    id: row.id, status: row.status, version: row.version, title: draft.title, slug: draft.slug,
    issue_count: review.issues.length, word_count: review.metrics?.word_count ?? 0,
    release_review_status: evidenceReview?.status ?? null,
    created_at: row.created_at, updated_at: row.updated_at
  };
}

export class AgentDraftStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS draft_artifacts (" +
      "id TEXT PRIMARY KEY, draft_json TEXT NOT NULL, quality_review_json TEXT NOT NULL, " +
      "status TEXT NOT NULL CHECK(status IN ('pending_human_review','needs_revision')), " +
      "version INTEGER NOT NULL, content_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, " +
      "ledger_json TEXT, review_record_json TEXT, evidence_readiness_json TEXT, research_evidence_json TEXT)"
    );
    const columns = new Set(this.ctx.storage.sql.exec("PRAGMA table_info(draft_artifacts)").toArray().map(column => column.name));
    for (const [name, definition] of [
      ["ledger_json", "TEXT"],
      ["review_record_json", "TEXT"],
      ["evidence_readiness_json", "TEXT"],
      ["research_evidence_json", "TEXT"]
    ]) {
      if (!columns.has(name)) {
        this.ctx.storage.sql.exec("ALTER TABLE draft_artifacts ADD COLUMN " + name + " " + definition);
        columns.add(name);
      }
    }
    if (!columns.has("content_version")) {
      this.ctx.storage.sql.exec("ALTER TABLE draft_artifacts ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1");
      columns.add("content_version");
      const legacyRows = this.ctx.storage.sql.exec(
        "SELECT id, version, ledger_json FROM draft_artifacts"
      ).toArray();
      for (const row of legacyRows) {
        let contentVersion = row.version;
        if (typeof row.ledger_json === "string") {
          try {
            const legacyLedger = JSON.parse(row.ledger_json);
            if (Number.isSafeInteger(legacyLedger.draft_version) && legacyLedger.draft_version > 0) {
              contentVersion = legacyLedger.draft_version;
            }
          } catch {
            // Invalid legacy ledgers remain fail-closed during review validation.
          }
        }
        this.ctx.storage.sql.exec(
          "UPDATE draft_artifacts SET content_version = ? WHERE id = ?",
          contentVersion, row.id
        );
      }
    }
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS draft_artifacts_status_updated ON draft_artifacts(status, updated_at)");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS runtime_authoring_control (singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1), paused INTEGER NOT NULL CHECK(paused IN (0,1)), version INTEGER NOT NULL CHECK(version >= 0))");
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO runtime_authoring_control (singleton_id, paused, version) VALUES (1, 1, 0)");
  }

  async setRuntimePaused(paused, version) {
    if (typeof paused !== "boolean" || !Number.isSafeInteger(version) || version < 0) return { updated: false, reason: "runtime_control_input_invalid" };
    return this.ctx.storage.transactionSync(() => {
      const current = this.ctx.storage.sql.exec("SELECT paused, version FROM runtime_authoring_control WHERE singleton_id = 1").toArray()[0];
      if (!current) return { updated: false, reason: "runtime_control_unavailable" };
      if (version < current.version) {
        // Emergency Pause is monotonic and must close the local authoring latch
        // even when this store's version is ahead of the authoritative State Store.
        // Advance this store's own version rather than lowering it. A stale Resume
        // remains rejected, so version skew can never reopen authoring.
        if (paused && current.paused === 1) {
          return { updated: true, duplicate: true, stale_version: true, paused: true, version: current.version };
        }
        if (paused && current.paused === 0) {
          const nextVersion = current.version + 1;
          if (!Number.isSafeInteger(nextVersion)) return { updated: false, reason: "runtime_control_version_exhausted" };
          const fenced = this.ctx.storage.sql.exec(
            "UPDATE runtime_authoring_control SET paused = 1, version = ? WHERE singleton_id = 1 AND version = ? RETURNING paused, version",
            nextVersion, current.version
          ).toArray();
          if (fenced.length !== 1 || fenced[0].paused !== 1 || fenced[0].version !== nextVersion) {
            return { updated: false, reason: "runtime_control_version_conflict" };
          }
          return { updated: true, stale_version: true, paused: true, version: nextVersion };
        }
        return { updated: false, reason: "runtime_control_version_stale", current_version: current.version };
      }
      if (version === current.version) {
        if (current.paused !== (paused ? 1 : 0)) return { updated: false, reason: "runtime_control_version_conflict" };
        return { updated: true, duplicate: true, paused, version };
      }
      const updated = this.ctx.storage.sql.exec("UPDATE runtime_authoring_control SET paused = ?, version = ? WHERE singleton_id = 1 AND version = ? RETURNING paused, version", paused ? 1 : 0, version, current.version).toArray();
      if (updated.length !== 1 || updated[0].paused !== (paused ? 1 : 0) || updated[0].version !== version) return { updated: false, reason: "runtime_control_version_conflict" };
      return { updated: true, paused, version };
    });
  }

  async createDraft(id, draft, retrievedEvidence = []) { return this.createDraftInternal(id, draft, retrievedEvidence); }

  async createDraftFromAgent(id, draft, retrievedEvidence = [], expectedControlVersion) {
    if (!Number.isSafeInteger(expectedControlVersion) || expectedControlVersion < 0) return { accepted: false, reason: "runtime_control_version_invalid" };
    return this.ctx.storage.transactionSync(() => {
      const control = this.ctx.storage.sql.exec("SELECT paused, version FROM runtime_authoring_control WHERE singleton_id = 1").toArray()[0];
      if (!control) return { accepted: false, reason: "runtime_control_unavailable" };
      if (control.paused === 1) return { accepted: false, reason: "runtime_paused" };
      if (control.version !== expectedControlVersion) return { accepted: false, reason: "runtime_control_version_conflict" };
      return this.createDraftInternal(id, draft, retrievedEvidence);
    });
  }

  createDraftInternal(id, draft, retrievedEvidence = []) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return { accepted: false, reason: "invalid_artifact_id" };
    const validated = validateDraft(draft);
    if (!validated.ok) return { accepted: false, reason: validated.reason };
    const evidence = validateRetrievedEvidence(retrievedEvidence);
    if (!evidence.ok) return { accepted: false, reason: evidence.reason };
    const existing = this.ctx.storage.sql.exec("SELECT * FROM draft_artifacts WHERE id = ?", id).toArray()[0];
    if (existing) {
      if (existing.draft_json !== validated.json) return { accepted: false, reason: "artifact_id_conflict" };
      return { accepted: true, duplicate: true, artifact: safeArtifact(existing) };
    }
    const review = runPolicyGatedQualityReview(draft);
    const status = review.ok ? "pending_human_review" : "needs_revision";
    const now = new Date().toISOString();
    const inserted = this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO draft_artifacts (id, draft_json, quality_review_json, status, version, created_at, updated_at, ledger_json, review_record_json, evidence_readiness_json, research_evidence_json) " +
      "VALUES (?, ?, ?, ?, 1, ?, ?, NULL, NULL, NULL, ?) RETURNING *",
      id, validated.json, JSON.stringify(review), status, now, now, evidence.json
    ).toArray();
    if (inserted.length !== 1) return { accepted: false, reason: "artifact_create_race" };
    return { accepted: true, duplicate: false, artifact: safeArtifact(inserted[0]) };
  }

  async reviseDraft(id, expectedVersion, draft) {
    if (typeof id !== "string" || !ID_PATTERN.test(id) || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return { updated: false, reason: "invalid_revision_request" };
    }
    const current = this.ctx.storage.sql.exec("SELECT * FROM draft_artifacts WHERE id = ?", id).toArray()[0];
    if (!current) return { updated: false, reason: "artifact_not_found" };
    if (current.version !== expectedVersion) return { updated: false, reason: "version_conflict", current_version: current.version };
    const validated = validateDraft(draft);
    if (!validated.ok) return { updated: false, reason: validated.reason };
    const review = runPolicyGatedQualityReview(draft);
    const status = review.ok ? "pending_human_review" : "needs_revision";
    const now = new Date().toISOString();
    const updated = this.ctx.storage.sql.exec(
      "UPDATE draft_artifacts SET draft_json = ?, quality_review_json = ?, status = ?, version = version + 1, content_version = content_version + 1, updated_at = ?, ledger_json = NULL, review_record_json = NULL, evidence_readiness_json = NULL " +
      "WHERE id = ? AND version = ? RETURNING *",
      validated.json, JSON.stringify(review), status, now, id, expectedVersion
    ).toArray();
    if (updated.length !== 1) return { updated: false, reason: "version_conflict" };
    return { updated: true, artifact: safeArtifact(updated[0]) };
  }

  async reviseDraftForReviewer(id, expectedVersion, draft, reviewerSessionToken) {
    const session = await verifyGoogleReviewerSessionToken(reviewerSessionToken, this.env, Date.now());
    if (!session.authenticated) {
      return { authorized: false, updated: false, reason: session.status || "reviewer_session_invalid" };
    }
    const result = await this.reviseDraft(id, expectedVersion, draft);
    return { authorized: true, reviewer_ref: session.reviewer.reviewer_ref, ...result };
  }

  async recordReviewerClaimDecisions(id, expectedVersion, decisions, reviewerSessionToken) {
    const session = await verifyGoogleReviewerSessionToken(reviewerSessionToken, this.env, Date.now());
    if (!session.authenticated) {
      return { authorized: false, recorded: false, reason: session.status || "reviewer_session_invalid" };
    }
    const current = await this.getDraft(id);
    if (!current) return { authorized: true, recorded: false, reason: "artifact_not_found" };
    if (current.version !== expectedVersion) {
      return { authorized: true, recorded: false, reason: "version_conflict", current_version: current.version };
    }
    const ledger = current.evidence_review?.ledger;
    if (!ledger) return { authorized: true, recorded: false, reason: "evidence_ledger_required" };
    const reviewRecord = await recordHumanClaimReview(
      ledger,
      decisions,
      { reviewer_ref: session.reviewer.reviewer_ref, reviewed_at: new Date().toISOString() }
    );
    if (!reviewRecord.ok) {
      return { authorized: true, recorded: false, reason: reviewRecord.status || "review_decisions_invalid" };
    }
    const result = await this.recordEvidenceReview(id, expectedVersion, ledger, reviewRecord, reviewerSessionToken);
    return { authorized: true, ...result };
  }

  /**
   * Persist source excerpts retrieved by the trusted Worker research path.
   * This Durable Object method is intentionally not exposed as a public HTTP route.
   */
  async storeEvidenceLedger(id, expectedVersion, retrievedEvidence = undefined) {
    if (typeof id !== "string" || !ID_PATTERN.test(id) || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return { stored: false, reason: "invalid_evidence_ledger_request" };
    }
    const current = this.ctx.storage.sql.exec("SELECT * FROM draft_artifacts WHERE id = ?", id).toArray()[0];
    if (!current) return { stored: false, reason: "artifact_not_found" };
    if (current.version !== expectedVersion) return { stored: false, reason: "version_conflict", current_version: current.version };
    if (current.status !== "pending_human_review") return { stored: false, reason: "draft_not_quality_eligible" };
    if (current.ledger_json) return { stored: false, reason: "evidence_ledger_already_exists" };
    const draft = JSON.parse(current.draft_json);
    if (!Array.isArray(draft.claims) || draft.claims.length < 1) {
      return { stored: false, reason: "claim_manifest_required" };
    }
    const claims = draft.claims.map(claim => ({
      claim_id: claim.claim_id,
      claim: claim.claim,
      evidence_urls: claim.evidence_urls
    }));
    const evidenceSnapshot = retrievedEvidence === undefined
      ? (current.research_evidence_json ? JSON.parse(current.research_evidence_json) : [])
      : retrievedEvidence;
    const built = buildHumanClaimReviewLedger(claims, evidenceSnapshot);
    if (!built.ok) return { stored: false, reason: built.reason, ledger_status: built.status };
    const ledger = { ...built, draft_version: current.content_version ?? 1 };
    const ledgerJson = JSON.stringify(ledger);
    if (new TextEncoder().encode(ledgerJson).byteLength > MAX_EVIDENCE_REVIEW_BYTES) {
      return { stored: false, reason: "evidence_review_too_large" };
    }
    const updated = this.ctx.storage.sql.exec(
      "UPDATE draft_artifacts SET ledger_json = ?, version = version + 1, updated_at = ? " +
      "WHERE id = ? AND version = ? AND ledger_json IS NULL RETURNING *",
      ledgerJson, new Date().toISOString(), id, expectedVersion
    ).toArray();
    if (updated.length !== 1) return { stored: false, reason: "version_conflict" };
    return { stored: true, artifact: safeArtifact(updated[0]), publication_authorized: false };
  }

  async recordEvidenceReview(id, expectedVersion, ledger, reviewRecord, reviewerSessionToken) {
    if (typeof id !== "string" || !ID_PATTERN.test(id) || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return { recorded: false, reason: "invalid_review_request" };
    }
    const current = this.ctx.storage.sql.exec("SELECT * FROM draft_artifacts WHERE id = ?", id).toArray()[0];
    if (!current) return { recorded: false, reason: "artifact_not_found" };
    if (current.version !== expectedVersion) return { recorded: false, reason: "version_conflict", current_version: current.version };
    if (current.status !== "pending_human_review") return { recorded: false, reason: "draft_not_quality_eligible" };
    const draft = JSON.parse(current.draft_json);
    if (!Array.isArray(draft.claims)) return { recorded: false, reason: "claim_manifest_required" };

    let ledgerJson;
    let reviewRecordJson;
    try {
      ledgerJson = JSON.stringify(ledger);
      reviewRecordJson = JSON.stringify(reviewRecord);
    } catch {
      return { recorded: false, reason: "evidence_review_serialization_failed" };
    }
    if (typeof ledgerJson !== "string" || typeof reviewRecordJson !== "string") {
      return { recorded: false, reason: "evidence_review_serialization_failed" };
    }
    const inputReviewBytes = new TextEncoder().encode(ledgerJson + reviewRecordJson).byteLength;
    if (inputReviewBytes > MAX_EVIDENCE_REVIEW_BYTES) {
      return { recorded: false, reason: "evidence_review_too_large" };
    }

    const reviewerSession = await verifyGoogleReviewerSessionToken(reviewerSessionToken, this.env, Date.now());
    if (!reviewerSession.authenticated) {
      return { recorded: false, reason: reviewerSession.status || "reviewer_session_required" };
    }
    if (!current.ledger_json) return { recorded: false, reason: "evidence_ledger_required" };
    let storedLedger;
    try { storedLedger = JSON.parse(current.ledger_json); }
    catch { return { recorded: false, reason: "stored_evidence_ledger_invalid" }; }
    if (storedLedger.draft_version !== (current.content_version ?? 1) ||
        canonicalJson(ledger) !== canonicalJson(storedLedger)) {
      return { recorded: false, reason: "evidence_ledger_version_or_snapshot_mismatch" };
    }

    let readiness;
    try {
      readiness = await assessArticleEvidenceReadiness({
        draft, ledger, reviewRecord,
        authenticatedReviewer: { authenticated: true, reviewer_ref: reviewerSession.reviewer.reviewer_ref },
        now: Date.now()
      });
    } catch {
      return { recorded: false, reason: "evidence_review_validation_failed" };
    }
    if (readiness.status === "human_review_record_not_verified") {
      return { recorded: false, reason: "review_record_not_verified", readiness };
    }

    const readinessJson = JSON.stringify(readiness);
    const reviewBytes = new TextEncoder().encode(ledgerJson + reviewRecordJson + readinessJson).byteLength;
    if (reviewBytes > MAX_EVIDENCE_REVIEW_BYTES) return { recorded: false, reason: "evidence_review_too_large" };

    const updated = this.ctx.storage.sql.exec(
      "UPDATE draft_artifacts SET ledger_json = ?, review_record_json = ?, evidence_readiness_json = ?, version = version + 1, updated_at = ? " +
      "WHERE id = ? AND version = ? AND status = 'pending_human_review' RETURNING *",
      ledgerJson, reviewRecordJson, readinessJson, new Date().toISOString(), id, expectedVersion
    ).toArray();
    if (updated.length !== 1) return { recorded: false, reason: "version_conflict" };
    return {
      recorded: true,
      owner_release_review_eligible: readiness.status === "eligible_for_owner_release_review",
      artifact: safeArtifact(updated[0]),
      readiness
    };
  }

  async listPendingReviewsForReviewer(limit = 20, reviewerSessionToken) {
    const session = await verifyGoogleReviewerSessionToken(reviewerSessionToken, this.env, Date.now());
    if (!session.authenticated) return { authorized: false, reason: session.status || "reviewer_session_invalid" };
    return {
      authorized: true,
      reviewer_ref: session.reviewer.reviewer_ref,
      items: await this.listPendingReviews(limit)
    };
  }

  async listNeedsRevisionForReviewer(limit = 20, reviewerSessionToken) {
    const session = await verifyGoogleReviewerSessionToken(reviewerSessionToken, this.env, Date.now());
    if (!session.authenticated) return { authorized: false, reason: session.status || "reviewer_session_invalid" };
    return {
      authorized: true,
      reviewer_ref: session.reviewer.reviewer_ref,
      items: await this.listNeedsRevision(limit)
    };
  }

  async getDraftForReviewer(id, reviewerSessionToken) {
    const session = await verifyGoogleReviewerSessionToken(reviewerSessionToken, this.env, Date.now());
    if (!session.authenticated) return { authorized: false, reason: session.status || "reviewer_session_invalid" };
    const artifact = await this.getDraft(id);
    if (!artifact) return { authorized: true, artifact: null };
    return { authorized: true, reviewer_ref: session.reviewer.reviewer_ref, artifact };
  }

  async getDraft(id) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return null;
    const row = this.ctx.storage.sql.exec("SELECT * FROM draft_artifacts WHERE id = ?", id).toArray()[0];
    return row ? safeArtifact(row) : null;
  }

  /**
   * Re-runs the deterministic article structure/safety gate for an exact
   * artifact version. This internal RPC does not authenticate a human reviewer,
   * change article content, create a human decision, or authorize publication.
   */
  async reviewDraft(id, expectedVersion) {
    if (typeof id !== "string" || !ID_PATTERN.test(id) ||
        !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return { reviewed: false, reason: "invalid_quality_review_request" };
    }
    const current = this.ctx.storage.sql.exec(
      "SELECT * FROM draft_artifacts WHERE id = ?", id
    ).toArray()[0];
    if (!current) return { reviewed: false, reason: "artifact_not_found" };
    if (current.version !== expectedVersion) {
      return { reviewed: false, reason: "version_conflict", current_version: current.version };
    }
    const draft = JSON.parse(current.draft_json);
    const review = runPolicyGatedQualityReview(draft);
    const status = review.ok ? "pending_human_review" : "needs_revision";
    const updated = this.ctx.storage.sql.exec(
      "UPDATE draft_artifacts SET quality_review_json = ?, status = ?, updated_at = ? " +
      "WHERE id = ? AND version = ? RETURNING *",
      JSON.stringify(review), status, new Date().toISOString(), id, expectedVersion
    ).toArray();
    if (updated.length !== 1) return { reviewed: false, reason: "version_conflict" };
    return {
      reviewed: true,
      artifact: safeArtifact(updated[0]),
      human_review_required: true,
      publication_authorized: false
    };
  }

  async listPendingReviews(limit = 20) {
    const boundedLimit = Number.isInteger(limit) ? Math.min(20, Math.max(1, limit)) : 20;
    const rows = this.ctx.storage.sql.exec(
      "SELECT * FROM draft_artifacts WHERE status = 'pending_human_review' ORDER BY updated_at DESC LIMIT ?",
      boundedLimit
    ).toArray();
    return rows.map(queueItem);
  }

  async listNeedsRevision(limit = 20) {
    const boundedLimit = Number.isInteger(limit) ? Math.min(20, Math.max(1, limit)) : 20;
    const rows = this.ctx.storage.sql.exec(
      "SELECT * FROM draft_artifacts WHERE status = 'needs_revision' ORDER BY updated_at DESC LIMIT ?",
      boundedLimit
    ).toArray();
    return rows.map(queueItem);
  }

  async listOwnerReleaseReviews(limit = 20) {
    const boundedLimit = Number.isInteger(limit) ? Math.min(20, Math.max(1, limit)) : 20;
    const rows = this.ctx.storage.sql.exec(
      "SELECT * FROM draft_artifacts WHERE status = 'pending_human_review' AND evidence_readiness_json IS NOT NULL ORDER BY updated_at DESC LIMIT ?",
      boundedLimit
    ).toArray();
    return rows.map(queueItem).filter(item => item.release_review_status === "eligible_for_owner_release_review");
  }

  async stats() {
    const rows = this.ctx.storage.sql.exec("SELECT status, COUNT(*) AS count FROM draft_artifacts GROUP BY status").toArray();
    return Object.fromEntries(rows.map(row => [row.status, row.count]));
  }
}
