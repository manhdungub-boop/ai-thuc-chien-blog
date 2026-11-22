import { AI_BANK_RELEASE_SOURCES } from "./ai-bank-discovery.mjs";

const ALLOWED_REPOSITORIES = new Set(AI_BANK_RELEASE_SOURCES.map(source => source.repo));
const MAX_CANDIDATES_PER_BATCH = 10;
const MAX_CANDIDATE_BYTES = 8192;
const MAX_EVIDENCE_PER_CHECK = 5;
const MAX_EVIDENCE_TITLE_CHARS = 180;
const MAX_EVIDENCE_EXCERPT_CHARS = 1000;
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

export class AgentAIBankCandidateStore {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS ai_bank_candidates (" +
      "candidate_id TEXT PRIMARY KEY, repository TEXT NOT NULL UNIQUE, " +
      "candidate_json TEXT NOT NULL, release_at INTEGER NOT NULL, " +
      "first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL)"
    );
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS ai_bank_candidates_last_seen ON ai_bank_candidates(last_seen_at)"
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS ai_bank_review_evidence (" +
      "evidence_id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, check_type TEXT NOT NULL, " +
      "source_title TEXT NOT NULL, source_url TEXT NOT NULL, excerpt TEXT NOT NULL, " +
      "source_status TEXT NOT NULL, review_status TEXT NOT NULL, submitted_at TEXT NOT NULL, " +
      "UNIQUE(candidate_id, check_type, source_url))"
    );
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS ai_bank_review_evidence_candidate ON ai_bank_review_evidence(candidate_id, submitted_at)"
    );
    const evidenceColumns = this.ctx.storage.sql.exec(
      "PRAGMA table_info(ai_bank_review_evidence)"
    ).toArray();
    if (!evidenceColumns.some(column => column.name === "candidate_release_url")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE ai_bank_review_evidence ADD COLUMN candidate_release_url TEXT NOT NULL DEFAULT ''"
      );
    }
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS ai_bank_review_evidence_releases (" +
      "evidence_id TEXT NOT NULL, candidate_release_url TEXT NOT NULL, associated_at TEXT NOT NULL, " +
      "PRIMARY KEY(evidence_id, candidate_release_url))"
    );
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO ai_bank_review_evidence_releases (evidence_id, candidate_release_url, associated_at) " +
      "SELECT evidence_id, candidate_release_url, submitted_at FROM ai_bank_review_evidence WHERE candidate_release_url <> ''"
    );
  }

  async fetch(request) {
    const url = new URL(request.url);
    const respond = (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      }
    });
    if (request.method !== "GET") return respond({ ok: false, error: "method_not_allowed" }, 405);
    if (url.pathname === "/candidates") {
      if ([...url.searchParams.keys()].some(key => key !== "limit") ||
          url.searchParams.getAll("limit").length > 1) {
        return respond({ ok: false, error: "candidate_query_invalid" }, 400);
      }
      const raw = url.searchParams.get("limit");
      const limit = raw === null ? 20 : (/^[0-9]{1,2}$/.test(raw) ? Number(raw) : null);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
        return respond({ ok: false, error: "candidate_limit_invalid" }, 400);
      }
      return respond({ ok: true, items: await this.listCandidates(limit) });
    }
    if (url.pathname === "/candidate") {
      if ([...url.searchParams.keys()].some(key => key !== "id") ||
          url.searchParams.getAll("id").length !== 1) {
        return respond({ ok: false, error: "candidate_id_invalid" }, 400);
      }
      const candidateId = url.searchParams.get("id");
      const packet = await this.getReviewPacket(candidateId);
      if (!packet) return respond({ ok: false, error: "candidate_not_found" }, 404);
      return respond({ ok: true, packet });
    }
    return respond({ ok: false, error: "not_found" }, 404);
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

  async listCandidates(limit = 20) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new TypeError("invalid_candidate_list_limit");
    }
    return this.ctx.storage.sql.exec(
      "SELECT * FROM ai_bank_candidates ORDER BY last_seen_at DESC, repository ASC LIMIT ?",
      limit
    ).toArray().map(safeCandidate);
  }

  async getCandidate(candidateId) {
    if (typeof candidateId !== "string" || !/^github:[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(candidateId)) {
      return null;
    }
    const row = this.ctx.storage.sql.exec(
      "SELECT * FROM ai_bank_candidates WHERE candidate_id = ?",
      candidateId
    ).toArray()[0];
    return row ? safeCandidate(row) : null;
  }

  async submitReviewEvidence(candidateId, evidence, now = Date.now()) {
    const candidate = await this.getCandidate(candidateId);
    if (!candidate) return { accepted: false, reason: "candidate_not_found" };
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
      return { accepted: false, reason: "invalid_evidence" };
    }
    const checkType = evidence.check_type;
    if (!REQUIRED_CHECKS.includes(checkType)) {
      return { accepted: false, reason: "unsupported_check_type" };
    }
    if (typeof evidence.source_title !== "string" ||
        evidence.source_title.trim().length < 1 ||
        evidence.source_title.length > MAX_EVIDENCE_TITLE_CHARS ||
        typeof evidence.excerpt !== "string" ||
        evidence.excerpt.trim().length < 1 ||
        evidence.excerpt.length > MAX_EVIDENCE_EXCERPT_CHARS) {
      return { accepted: false, reason: "invalid_evidence_text" };
    }
    let sourceUrl;
    try {
      sourceUrl = new URL(evidence.source_url);
    } catch {
      return { accepted: false, reason: "invalid_evidence_url" };
    }
    const host = sourceUrl.hostname.toLowerCase();
    if (sourceUrl.protocol !== "https:" || !host || sourceUrl.username ||
        sourceUrl.password || sourceUrl.search || sourceUrl.hash ||
        (sourceUrl.port && sourceUrl.port !== "443") ||
        host === "localhost" || host.endsWith(".localhost") ||
        host.endsWith(".local") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
        host.includes(":") || sourceUrl.href.length > 1000) {
      return { accepted: false, reason: "invalid_evidence_url" };
    }
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isFinite(new Date(now).getTime())) {
      return { accepted: false, reason: "invalid_evidence_timestamp" };
    }
    const releaseUrl = candidate.candidate.latest_release.source_url;
    const existing = this.ctx.storage.sql.exec(
      "SELECT evidence_id FROM ai_bank_review_evidence WHERE candidate_id = ? AND check_type = ? AND source_url = ?",
      candidateId, checkType, sourceUrl.href
    ).toArray()[0];
    if (existing) {
      const association = this.ctx.storage.sql.exec(
        "SELECT evidence_id FROM ai_bank_review_evidence_releases WHERE evidence_id = ? AND candidate_release_url = ?",
        existing.evidence_id, releaseUrl
      ).toArray()[0];
      if (association) return { accepted: false, reason: "duplicate_evidence" };
    }
    const count = this.ctx.storage.sql.exec(
      "SELECT COUNT(*) AS count FROM ai_bank_review_evidence e JOIN ai_bank_review_evidence_releases r ON r.evidence_id = e.evidence_id WHERE e.candidate_id = ? AND e.check_type = ? AND r.candidate_release_url = ?",
      candidateId, checkType, releaseUrl
    ).one().count;
    if (count >= MAX_EVIDENCE_PER_CHECK) {
      return { accepted: false, reason: "evidence_limit_reached" };
    }
    const submittedAt = new Date(now).toISOString();
    const evidenceId = existing ? existing.evidence_id : crypto.randomUUID();
    if (!existing) {
      this.ctx.storage.sql.exec(
        "INSERT INTO ai_bank_review_evidence (evidence_id, candidate_id, check_type, source_title, source_url, excerpt, source_status, review_status, submitted_at, candidate_release_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        evidenceId, candidateId, checkType, evidence.source_title.trim(),
        sourceUrl.href, evidence.excerpt.trim(),
        "submitted_source_not_verified", "pending_human_review", submittedAt,
        releaseUrl
      );
    }
    this.ctx.storage.sql.exec(
      "INSERT INTO ai_bank_review_evidence_releases (evidence_id, candidate_release_url, associated_at) VALUES (?, ?, ?)",
      evidenceId, releaseUrl, submittedAt
    );
    return {
      accepted: true,
      evidence_id: evidenceId,
      source_status: "submitted_source_not_verified",
      review_status: "pending_human_review",
      verification_authorized: false,
      catalog_write_authorized: false,
      public_publication_authorized: false
    };
  }

  async listReviewEvidence(candidateId, limit = 30) {
    if (!(await this.getCandidate(candidateId))) return [];
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) {
      throw new TypeError("invalid_evidence_list_limit");
    }
    return this.ctx.storage.sql.exec(
      "SELECT e.evidence_id, e.candidate_id, e.check_type, e.source_title, e.source_url, e.excerpt, e.source_status, e.review_status, e.submitted_at, r.candidate_release_url, r.associated_at FROM ai_bank_review_evidence e JOIN ai_bank_review_evidence_releases r ON r.evidence_id = e.evidence_id WHERE e.candidate_id = ? ORDER BY r.associated_at ASC, e.evidence_id ASC LIMIT ?",
      candidateId, limit
    ).toArray().map(row => ({ ...row }));
  }

  async getReviewPacket(candidateId) {
    const stored = await this.getCandidate(candidateId);
    if (!stored) return null;
    const rows = this.ctx.storage.sql.exec(
      "SELECT e.check_type, COUNT(*) AS evidence_count FROM ai_bank_review_evidence e JOIN ai_bank_review_evidence_releases r ON r.evidence_id = e.evidence_id WHERE e.candidate_id = ? AND r.candidate_release_url = ? GROUP BY e.check_type",
      candidateId, stored.candidate.latest_release.source_url
    ).toArray();
    const counts = new Map(rows.map(row => [row.check_type, row.evidence_count]));
    const checklist = REQUIRED_CHECKS.map(checkType => ({
      check_type: checkType,
      evidence_count: counts.get(checkType) || 0,
      status: counts.has(checkType) ? "evidence_pending_human_review" : "evidence_missing",
      verified: false
    }));
    const evidence = this.ctx.storage.sql.exec(
      "SELECT e.evidence_id, e.check_type, e.source_title, e.source_url, e.excerpt, e.source_status, e.review_status, e.submitted_at " +
      "FROM ai_bank_review_evidence e JOIN ai_bank_review_evidence_releases r ON r.evidence_id = e.evidence_id " +
      "WHERE e.candidate_id = ? AND r.candidate_release_url = ? " +
      "ORDER BY e.check_type ASC, e.submitted_at ASC, e.evidence_id ASC LIMIT 30",
      candidateId, stored.candidate.latest_release.source_url
    ).toArray().map(row => ({
      ...row,
      verified: false,
      verification_authorized: false
    }));
    const totalEvidence = checklist.reduce((sum, item) => sum + item.evidence_count, 0);
    return {
      candidate: stored,
      checklist,
      evidence,
      total_evidence: totalEvidence,
      checks_with_evidence: checklist.filter(item => item.evidence_count > 0).length,
      checks_missing_evidence: checklist.filter(item => item.evidence_count === 0).length,
      verification_status: "not_verified",
      human_review_required: true,
      catalog_write_authorized: false,
      public_publication_authorized: false
    };
  }

  async stats() {
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
