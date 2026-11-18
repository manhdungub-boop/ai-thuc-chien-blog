import { DurableObject } from "cloudflare:workers";
import { reviewArticleDraft } from "./article-quality-gate.mjs";

const MAX_ARTIFACT_BYTES = 48 * 1024;
const MAX_SOURCES = 20;
const ID_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/;
const DRAFT_KEYS = new Set(["title","slug","meta_description","author","language","body_markdown","sources","copyright_notice"]);
const SOURCE_KEYS = new Set(["title","publisher","url","accessed_at"]);

function validateDraft(draft) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return { ok: false, reason: "draft_must_be_object" };
  if (Object.keys(draft).some(key => !DRAFT_KEYS.has(key)) || [...DRAFT_KEYS].some(key => !(key in draft))) {
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
  const json = JSON.stringify(draft);
  if (new TextEncoder().encode(json).byteLength > MAX_ARTIFACT_BYTES) return { ok: false, reason: "artifact_too_large" };
  return { ok: true, json };
}

function safeArtifact(row) {
  return {
    id: row.id, artifact_type: "article", status: row.status, version: row.version,
    draft: JSON.parse(row.draft_json), quality_review: JSON.parse(row.quality_review_json),
    created_at: row.created_at, updated_at: row.updated_at
  };
}

function queueItem(row) {
  const review = JSON.parse(row.quality_review_json);
  const draft = JSON.parse(row.draft_json);
  return {
    id: row.id, status: row.status, version: row.version, title: draft.title, slug: draft.slug,
    issue_count: review.issues.length, word_count: review.metrics?.word_count ?? 0,
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
      "version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    );
    this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS draft_artifacts_status_updated ON draft_artifacts(status, updated_at)");
  }

  createDraft(id, draft) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return { accepted: false, reason: "invalid_artifact_id" };
    const validated = validateDraft(draft);
    if (!validated.ok) return { accepted: false, reason: validated.reason };
    const existing = this.ctx.storage.sql.exec("SELECT * FROM draft_artifacts WHERE id = ?", id).toArray()[0];
    if (existing) {
      if (existing.draft_json !== validated.json) return { accepted: false, reason: "artifact_id_conflict" };
      return { accepted: true, duplicate: true, artifact: safeArtifact(existing) };
    }
    const review = reviewArticleDraft(draft);
    const status = review.ok ? "pending_human_review" : "needs_revision";
    const now = new Date().toISOString();
    const inserted = this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO draft_artifacts (id, draft_json, quality_review_json, status, version, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, 1, ?, ?) RETURNING *",
      id, validated.json, JSON.stringify(review), status, now, now
    ).toArray();
    if (inserted.length !== 1) return { accepted: false, reason: "artifact_create_race" };
    return { accepted: true, duplicate: false, artifact: safeArtifact(inserted[0]) };
  }

  reviseDraft(id, expectedVersion, draft) {
    if (typeof id !== "string" || !ID_PATTERN.test(id) || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return { updated: false, reason: "invalid_revision_request" };
    }
    const current = this.ctx.storage.sql.exec("SELECT * FROM draft_artifacts WHERE id = ?", id).toArray()[0];
    if (!current) return { updated: false, reason: "artifact_not_found" };
    if (current.version !== expectedVersion) return { updated: false, reason: "version_conflict", current_version: current.version };
    const validated = validateDraft(draft);
    if (!validated.ok) return { updated: false, reason: validated.reason };
    const review = reviewArticleDraft(draft);
    const status = review.ok ? "pending_human_review" : "needs_revision";
    const now = new Date().toISOString();
    const updated = this.ctx.storage.sql.exec(
      "UPDATE draft_artifacts SET draft_json = ?, quality_review_json = ?, status = ?, version = version + 1, updated_at = ? " +
      "WHERE id = ? AND version = ? RETURNING *",
      validated.json, JSON.stringify(review), status, now, id, expectedVersion
    ).toArray();
    if (updated.length !== 1) return { updated: false, reason: "version_conflict" };
    return { updated: true, artifact: safeArtifact(updated[0]) };
  }

  getDraft(id) {
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return null;
    const row = this.ctx.storage.sql.exec("SELECT * FROM draft_artifacts WHERE id = ?", id).toArray()[0];
    return row ? safeArtifact(row) : null;
  }

  listPendingReviews(limit = 20) {
    const boundedLimit = Number.isInteger(limit) ? Math.min(20, Math.max(1, limit)) : 20;
    const rows = this.ctx.storage.sql.exec(
      "SELECT * FROM draft_artifacts WHERE status = 'pending_human_review' ORDER BY updated_at DESC LIMIT ?",
      boundedLimit
    ).toArray();
    return rows.map(queueItem);
  }

  stats() {
    const rows = this.ctx.storage.sql.exec("SELECT status, COUNT(*) AS count FROM draft_artifacts GROUP BY status").toArray();
    return Object.fromEntries(rows.map(row => [row.status, row.count]));
  }
}
