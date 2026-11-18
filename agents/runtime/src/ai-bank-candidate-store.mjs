import { DurableObject } from "cloudflare:workers";
import { AI_BANK_RELEASE_SOURCES } from "./ai-bank-discovery.mjs";

const ALLOWED_REPOSITORIES = new Set(AI_BANK_RELEASE_SOURCES.map(source => source.repo));
const MAX_CANDIDATES_PER_BATCH = 10;
const MAX_CANDIDATE_BYTES = 8192;
const REQUIRED_CHECKS = [
  "official_product_domain",
  "pricing_and_free_limits",
  "license_scope",
  "privacy_and_data_handling",
  "platform_support",
  "regional_availability"
];

function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, reason: "candidate_must_be_object" };
  }
  const repository = candidate.repository;
  if (typeof repository !== "string" || !ALLOWED_REPOSITORIES.has(repository)) {
    return { ok: false, reason: "repository_not_allowlisted" };
  }
  if (candidate.candidate_id !== "github:" + repository) {
    return { ok: false, reason: "candidate_id_mismatch" };
  }
  const source = AI_BANK_RELEASE_SOURCES.find(item => item.repo === repository);
  if (candidate.name !== source.product || candidate.provider !== source.vendor) {
    return { ok: false, reason: "product_identity_mismatch" };
  }
  if (!candidate.latest_release || typeof candidate.latest_release !== "object" ||
      typeof candidate.latest_release.title !== "string" ||
      candidate.latest_release.title.trim().length < 1 ||
      candidate.latest_release.title.length > 240) {
    return { ok: false, reason: "invalid_release_title" };
  }
  let releaseUrl;
  try {
    releaseUrl = new URL(candidate.latest_release.source_url);
  } catch {
    return { ok: false, reason: "invalid_release_url" };
  }
  if (releaseUrl.protocol !== "https:" || releaseUrl.hostname !== "github.com" ||
      releaseUrl.username || releaseUrl.password || releaseUrl.search || releaseUrl.hash ||
      releaseUrl.port && releaseUrl.port !== "443" ||
      !releaseUrl.pathname.startsWith("/" + repository + "/releases/")) {
    return { ok: false, reason: "invalid_release_url" };
  }
  const releaseAt = Date.parse(candidate.latest_release.published_at);
  const discoveredAt = Date.parse(candidate.discovered_at);
  if (!Number.isFinite(releaseAt) || !Number.isFinite(discoveredAt) ||
      new Date(releaseAt).toISOString() !== candidate.latest_release.published_at ||
      new Date(discoveredAt).toISOString() !== candidate.discovered_at ||
      releaseAt > discoveredAt + 5 * 60 * 1000) {
    return { ok: false, reason: "invalid_candidate_timestamps" };
  }
  if (candidate.evidence_type !== "github_release_activity_only" ||
      candidate.review_status !== "needs_official_source_review" ||
      candidate.pricing_status !== "unverified" ||
      candidate.free_limits_status !== "unverified" ||
      candidate.license_status !== "unverified" ||
      candidate.privacy_status !== "unverified" ||
      candidate.platform_support_status !== "unverified" ||
      candidate.regional_availability_status !== "unverified" ||
      candidate.catalog_write_authorized !== false ||
      candidate.public_publication_authorized !== false ||
      JSON.stringify(candidate.required_checks) !== JSON.stringify(REQUIRED_CHECKS)) {
    return { ok: false, reason: "candidate_review_state_invalid" };
  }
  const json = JSON.stringify(candidate);
  if (new TextEncoder().encode(json).byteLength > MAX_CANDIDATE_BYTES) {
    return { ok: false, reason: "candidate_too_large" };
  }
  return { ok: true, json, releaseAt };
}

function safeCandidate(row) {
  return {
    candidate: JSON.parse(row.candidate_json),
    first_seen_at: row.first_seen_at,
    last_seen_at: row.last_seen_at,
    stored_release_at: row.release_at
  };
}

export class AgentAIBankCandidateStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS ai_bank_candidates (" +
      "candidate_id TEXT PRIMARY KEY, repository TEXT NOT NULL UNIQUE, " +
      "candidate_json TEXT NOT NULL, release_at INTEGER NOT NULL, " +
      "first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)"
    );
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS ai_bank_candidates_last_seen ON ai_bank_candidates(last_seen_at)"
    );
  }

  upsertCandidates(candidates, now = Date.now()) {
    if (!Array.isArray(candidates) || candidates.length > MAX_CANDIDATES_PER_BATCH ||
        !Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) {
      return { accepted: false, reason: "invalid_candidate_batch" };
    }
    const validated = [];
    const seen = new Set();
    for (const candidate of candidates) {
      const result = validateCandidate(candidate);
      if (!result.ok) return { accepted: false, reason: result.reason };
      if (seen.has(candidate.candidate_id)) return { accepted: false, reason: "duplicate_candidate_in_batch" };
      seen.add(candidate.candidate_id);
      validated.push({ candidate, ...result });
    }

    const timestamp = new Date(now).toISOString();
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    for (const item of validated) {
      const existing = this.ctx.storage.sql.exec(
        "SELECT release_at FROM ai_bank_candidates WHERE candidate_id = ?",
        item.candidate.candidate_id
      ).toArray()[0];
      if (!existing) {
        this.ctx.storage.sql.exec(
          "INSERT INTO ai_bank_candidates (candidate_id, repository, candidate_json, release_at, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
          item.candidate.candidate_id, item.candidate.repository, item.json,
          item.releaseAt, timestamp, timestamp
        );
        inserted += 1;
      } else {
        this.ctx.storage.sql.exec(
          "UPDATE ai_bank_candidates SET candidate_json = CASE WHEN release_at < ? THEN ? ELSE candidate_json END, release_at = MAX(release_at, ?), last_seen_at = ? WHERE candidate_id = ?",
          item.releaseAt, item.json, item.releaseAt, timestamp, item.candidate.candidate_id
        );
        if (item.releaseAt > existing.release_at) updated += 1;
        else unchanged += 1;
      }
    }
    const total = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) AS count FROM ai_bank_candidates"
    ).one().count;
    return { accepted: true, inserted, updated, unchanged, total, catalog_write_authorized: false };
  }

  listCandidates(limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new TypeError("invalid_candidate_list_limit");
    }
    return this.ctx.storage.sql.exec(
      "SELECT * FROM ai_bank_candidates ORDER BY last_seen_at DESC, repository ASC LIMIT ?",
      limit
    ).toArray().map(safeCandidate);
  }

  getCandidate(candidateId) {
    if (typeof candidateId !== "string" || !/^github:[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(candidateId)) {
      return null;
    }
    const row = this.ctx.storage.sql.exec(
      "SELECT * FROM ai_bank_candidates WHERE candidate_id = ?",
      candidateId
    ).toArray()[0];
    return row ? safeCandidate(row) : null;
  }

  stats() {
    return {
      total: this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM ai_bank_candidates").one().count,
      awaiting_official_review: this.ctx.storage.sql.exec(
        "SELECT COUNT(*) AS count FROM ai_bank_candidates WHERE json_extract(candidate_json, '$.review_status') = 'needs_official_source_review'"
      ).one().count,
      catalog_write_authorized: false,
      public_publication_authorized: false
    };
  }
}
