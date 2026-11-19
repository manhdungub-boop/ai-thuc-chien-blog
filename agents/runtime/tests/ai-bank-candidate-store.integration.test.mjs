import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";

const sources = [
  { vendor: "Ollama", product: "Ollama", repo: "ollama/ollama" },
  { vendor: "ComfyUI", product: "ComfyUI", repo: "Comfy-Org/ComfyUI" }
];

const writerAuthEnv = {
  AGENT_REVIEWER_AUTH_ENABLED: "true",
  GOOGLE_REVIEWER_CLIENT_ID: "preview-test-client-id-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com",
  GOOGLE_REVIEWER_CLIENT_SECRET: "test-google-client-secret-value-abcdefghijklmnopqrstuvwxyz0123456789",
  GOOGLE_REVIEWER_REDIRECT_URI: "https://ai-thuc-chien-agent-runtime-preview.test-account.workers.dev/auth/google/callback",
  GOOGLE_REVIEWER_ALLOWED_EMAILS: "reviewer@example.com",
  GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS: "reviewer@example.com",
  GOOGLE_REVIEWER_STATE_SECRET: "state-secret-for-tests-only-abcdefghijklmnopqrstuvwxyz0123456789",
  GOOGLE_REVIEWER_SESSION_SECRET: "session-secret-for-tests-only-zyxwvutsrqponmlkjihgfedcba9876543210"
};

function encodeBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replaceAll("+", "-").replaceAll("/", "_");
}

async function writerSessionToken(now = Date.now(), email = "reviewer@example.com") {
  const payload = {
    provider: "google",
    sub: "google-subject-writer-123",
    email,
    reviewer_ref: "google:google-subject-writer-123",
    iat: Math.floor(now / 1000) - 10,
    exp: Math.floor(now / 1000) + 600
  };
  const encoded = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(writerAuthEnv.GOOGLE_REVIEWER_SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  return encoded + "." + encodeBase64Url(new Uint8Array(signature));
}

async function submitEvidence(store, candidateId, evidence, now = Date.now(), eventId = crypto.randomUUID()) {
  return store.submitAuthorizedReviewEvidence(
    candidateId, evidence, await writerSessionToken(now), eventId, writerAuthEnv, now
  );
}

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

const SNAPSHOT_TABLES = [
  { name: "ai_bank_candidates", order: "candidate_id" },
  { name: "ai_bank_review_evidence", order: "evidence_id" },
  { name: "ai_bank_review_evidence_releases", order: "evidence_id ASC, candidate_release_url" },
  { name: "ai_bank_evidence_audit_events", order: "event_id" }
];

function canonicalSnapshotJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalSnapshotJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ":" + canonicalSnapshotJson(value[key])
    ).join(",") + "}";
  }
  return JSON.stringify(value);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

// Test-only snapshot prototype. All table reads occur inside one synchronous
// SQLite transaction; hashing happens after the consistent row set is copied.
async function captureTestSnapshot(state, pageSize = 1) {
  const rowsByTable = state.storage.transactionSync(() => {
    const result = {};
    for (const table of SNAPSHOT_TABLES) {
      const rows = [];
      let offset = 0;
      while (true) {
        const page = state.storage.sql.exec(
          "SELECT * FROM " + table.name + " ORDER BY " + table.order + " LIMIT ? OFFSET ?",
          pageSize, offset
        ).toArray();
        rows.push(...page);
        if (page.length < pageSize) break;
        offset += page.length;
      }
      result[table.name] = rows;
    }
    return result;
  });

  const counts = {};
  const tableDigests = {};
  for (const table of SNAPSHOT_TABLES) {
    const rows = rowsByTable[table.name];
    counts[table.name] = rows.length;
    tableDigests[table.name] = await sha256Hex(canonicalSnapshotJson(rows));
  }
  const manifest = {
    format_id: "ai-bank-audit-emulator-snapshot",
    format_version: 1,
    counts,
    table_sha256: tableDigests
  };
  return {
    ...manifest,
    tables: rowsByTable,
    manifest_sha256: await sha256Hex(canonicalSnapshotJson(manifest))
  };
}

const SNAPSHOT_COLUMNS = {
  ai_bank_candidates: ["candidate_id", "repository", "candidate_json", "release_at", "first_seen_at", "last_seen_at"],
  ai_bank_review_evidence: ["evidence_id", "candidate_id", "check_type", "source_title", "source_url", "excerpt", "source_status", "review_status", "submitted_at", "candidate_release_url"],
  ai_bank_review_evidence_releases: ["evidence_id", "candidate_release_url", "associated_at"],
  ai_bank_evidence_audit_events: ["event_id", "actor_subject", "actor_email", "request_sha256", "evidence_id", "recorded_at"]
};

function validateTestSnapshotRows(snapshot) {
  const ids = {
    ai_bank_candidates: new Set(),
    ai_bank_review_evidence: new Set(),
    ai_bank_evidence_audit_events: new Set()
  };
  const releasePairs = new Set();
  for (const table of SNAPSHOT_TABLES) {
    const rows = snapshot.tables[table.name];
    if (!Array.isArray(rows) || !Number.isSafeInteger(snapshot.counts[table.name]) ||
        snapshot.counts[table.name] < 0 || rows.length !== snapshot.counts[table.name]) return false;
    const columns = SNAPSHOT_COLUMNS[table.name];
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row) ||
          Object.keys(row).sort().join("|") !== columns.slice().sort().join("|")) return false;
      if (columns.some(column => row[column] === undefined)) return false;
    }
  }
  for (const row of snapshot.tables.ai_bank_candidates) {
    if (typeof row.candidate_id !== "string" || !row.candidate_id ||
        typeof row.repository !== "string" || !row.repository ||
        ids.ai_bank_candidates.has(row.candidate_id)) return false;
    ids.ai_bank_candidates.add(row.candidate_id);
  }
  for (const row of snapshot.tables.ai_bank_review_evidence) {
    if (typeof row.evidence_id !== "string" || !row.evidence_id ||
        !ids.ai_bank_candidates.has(row.candidate_id) ||
        ids.ai_bank_review_evidence.has(row.evidence_id)) return false;
    ids.ai_bank_review_evidence.add(row.evidence_id);
  }
  for (const row of snapshot.tables.ai_bank_review_evidence_releases) {
    const pair = row.evidence_id + "|" + row.candidate_release_url;
    if (!ids.ai_bank_review_evidence.has(row.evidence_id) || releasePairs.has(pair)) return false;
    releasePairs.add(pair);
  }
  for (const row of snapshot.tables.ai_bank_evidence_audit_events) {
    if (typeof row.event_id !== "string" || !row.event_id ||
        !ids.ai_bank_review_evidence.has(row.evidence_id) ||
        ids.ai_bank_evidence_audit_events.has(row.event_id)) return false;
    ids.ai_bank_evidence_audit_events.add(row.event_id);
  }
  return snapshot.counts.ai_bank_evidence_audit_events <= 10000;
}

async function verifyTestSnapshot(snapshot) {
  if (!snapshot || snapshot.format_id !== "ai-bank-audit-emulator-snapshot" ||
      snapshot.format_version !== 1 || !snapshot.tables || !snapshot.counts ||
      !snapshot.table_sha256 || Object.keys(snapshot.tables).sort().join("|") !==
        SNAPSHOT_TABLES.map(table => table.name).sort().join("|")) {
    return false;
  }
  const manifest = {
    format_id: snapshot.format_id,
    format_version: snapshot.format_version,
    counts: snapshot.counts,
    table_sha256: snapshot.table_sha256
  };
  if (Object.keys(snapshot.counts).sort().join("|") !==
      SNAPSHOT_TABLES.map(table => table.name).sort().join("|") ||
      Object.keys(snapshot.table_sha256).sort().join("|") !==
      SNAPSHOT_TABLES.map(table => table.name).sort().join("|") ||
      !validateTestSnapshotRows(snapshot)) return false;
  for (const table of SNAPSHOT_TABLES) {
    const rows = snapshot.tables[table.name];
    if (await sha256Hex(canonicalSnapshotJson(rows)) !== snapshot.table_sha256[table.name]) return false;
  }
  return await sha256Hex(canonicalSnapshotJson(manifest)) === snapshot.manifest_sha256;
}

const RESTORE_COLUMNS = {
  ai_bank_candidates: ["candidate_id", "repository", "candidate_json", "release_at", "first_seen_at", "last_seen_at"],
  ai_bank_review_evidence: ["evidence_id", "candidate_id", "check_type", "source_title", "source_url", "excerpt", "source_status", "review_status", "submitted_at", "candidate_release_url"],
  ai_bank_review_evidence_releases: ["evidence_id", "candidate_release_url", "associated_at"],
  ai_bank_evidence_audit_events: ["event_id", "actor_subject", "actor_email", "request_sha256", "evidence_id", "recorded_at"]
};

async function restoreTestSnapshotInBatches(state, snapshot, batchSize = 2, interruptAfterBatches = Infinity) {
  if (!await verifyTestSnapshot(snapshot)) return { restored: false, reason: "snapshot_integrity_invalid" };
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new TypeError("invalid_restore_batch_size");
  }

  // A retry may find a partially restored destination. Accept only exact rows
  // from this snapshot; reject unrelated or conflicting destination contents.
  for (const table of SNAPSHOT_TABLES) {
    const names = RESTORE_COLUMNS[table.name];
    const existing = state.storage.sql.exec("SELECT " + names.join(", ") + " FROM " + table.name).toArray();
    const expectedRows = new Set(snapshot.tables[table.name].map(row => canonicalSnapshotJson(row)));
    if (existing.length > snapshot.tables[table.name].length ||
        existing.some(row => !expectedRows.has(canonicalSnapshotJson(row)))) {
      return { restored: false, reason: "restore_destination_conflict" };
    }
  }

  const orderedRows = SNAPSHOT_TABLES.flatMap(table =>
    snapshot.tables[table.name].map(row => ({ table: table.name, row }))
  );
  let batchesCommitted = 0;
  for (let offset = 0; offset < orderedRows.length; offset += batchSize) {
    const batch = orderedRows.slice(offset, offset + batchSize);
    const missingRows = batch.filter(item => {
      const names = RESTORE_COLUMNS[item.table];
      const where = names.map(name => name + " IS ?").join(" AND ");
      return state.storage.sql.exec(
        "SELECT 1 AS present FROM " + item.table + " WHERE " + where + " LIMIT 1",
        ...names.map(name => item.row[name])
      ).toArray().length === 0;
    });
    if (missingRows.length > 0) {
      state.storage.transactionSync(() => {
        for (const item of missingRows) {
          const names = RESTORE_COLUMNS[item.table];
          state.storage.sql.exec(
            "INSERT OR IGNORE INTO " + item.table + " (" + names.join(", ") + ") VALUES (" +
            names.map(() => "?").join(", ") + ")",
            ...names.map(name => item.row[name])
          );
        }
      });
      batchesCommitted += 1;
    }
    if (batchesCommitted >= interruptAfterBatches && offset + batchSize < orderedRows.length) {
      throw new Error("simulated_restore_interruption");
    }
  }

  const restored = await captureTestSnapshot(state, 1);
  if (restored.manifest_sha256 !== snapshot.manifest_sha256) {
    return { restored: false, reason: "restored_snapshot_digest_mismatch" };
  }
  return { restored: true, manifest_sha256: restored.manifest_sha256, batches_committed: batchesCommitted };
}

async function restoreTestSnapshot(state, snapshot) {
  const result = await restoreTestSnapshotInBatches(state, snapshot, 100);
  if (!result.restored) return result;
  return { restored: true, manifest_sha256: result.manifest_sha256 };
}

describe("AgentAIBankCandidateStore Durable Object", () => {
  let store;
  let testIndex = 0;
  beforeEach(() => {
    testIndex += 1;
    store = env.AGENT_AI_BANK_CANDIDATE_STORE.getByName("agent-ai-bank-candidates-" + testIndex);
  });

  it("rolls back every destination table when restore fails during the final audit-table insert", async () => {
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    await store.upsertCandidates([candidate()], now);
    const accepted = await submitEvidence(store, "github:ollama/ollama", {
      check_type: "pricing_and_free_limits",
      source_title: "Official pricing page",
      source_url: "https://ollama.com/pricing",
      excerpt: "Restore rollback fixture."
    }, now, "f4e6d1c2-3b7f-4a91-8c22-1234567890ab");
    expect(accepted.accepted).toBe(true);

    const sourceSnapshot = await runInDurableObject(store, async (_instance, state) =>
      captureTestSnapshot(state, 1)
    );
    const destination = env.AGENT_AI_BANK_CANDIDATE_STORE.getByName(
      "agent-ai-bank-candidates-restore-rollback-" + testIndex
    );

    await runInDurableObject(destination, async (_instance, state) => {
      state.storage.sql.exec(
        "CREATE TRIGGER fail_ai_bank_restore_audit_insert " +
        "BEFORE INSERT ON ai_bank_evidence_audit_events " +
        "BEGIN SELECT RAISE(ABORT, 'forced_restore_audit_insert_failure'); END"
      );

      await expect(restoreTestSnapshot(state, sourceSnapshot))
        .rejects.toThrow("forced_restore_audit_insert_failure");

      const counts = Object.fromEntries(SNAPSHOT_TABLES.map(table => [
        table.name,
        state.storage.sql.exec("SELECT COUNT(*) AS count FROM " + table.name).one().count
      ]));
      expect(counts).toEqual({
        ai_bank_candidates: 0,
        ai_bank_review_evidence: 0,
        ai_bank_review_evidence_releases: 0,
        ai_bank_evidence_audit_events: 0
      });
      state.storage.sql.exec("DROP TRIGGER fail_ai_bank_restore_audit_insert");
    });
  });

  it("resumes a partially committed restore in bounded batches without duplicating rows", async () => {
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    await store.upsertCandidates([candidate()], now);
    const evidence = {
      check_type: "pricing_and_free_limits",
      source_title: "Official pricing page",
      source_url: "https://ollama.com/pricing",
      excerpt: "Batch resume fixture."
    };
    const accepted = await submitEvidence(
      store, "github:ollama/ollama", evidence, now,
      "b4e6d1c2-3b7f-4a91-8c22-1234567890ab"
    );
    expect(accepted.accepted).toBe(true);
    const sourceSnapshot = await runInDurableObject(store, async (_instance, state) =>
      captureTestSnapshot(state, 1)
    );
    const destination = env.AGENT_AI_BANK_CANDIDATE_STORE.getByName(
      "agent-ai-bank-candidates-restore-resume-" + testIndex
    );

    await runInDurableObject(destination, async (_instance, state) => {
      await expect(restoreTestSnapshotInBatches(state, sourceSnapshot, 1, 1))
        .rejects.toThrow("simulated_restore_interruption");
      const partialCounts = Object.fromEntries(SNAPSHOT_TABLES.map(table => [
        table.name,
        state.storage.sql.exec("SELECT COUNT(*) AS count FROM " + table.name).one().count
      ]));
      expect(Object.values(partialCounts).reduce((sum, value) => sum + value, 0)).toBe(1);

      await expect(restoreTestSnapshotInBatches(state, sourceSnapshot, 1, 1))
        .rejects.toThrow("simulated_restore_interruption");
      const afterSecondInterruption = Object.fromEntries(SNAPSHOT_TABLES.map(table => [
        table.name,
        state.storage.sql.exec("SELECT COUNT(*) AS count FROM " + table.name).one().count
      ]));
      expect(Object.values(afterSecondInterruption).reduce((sum, value) => sum + value, 0)).toBe(2);

      const resumed = await restoreTestSnapshotInBatches(state, sourceSnapshot, 1);
      expect(resumed.restored).toBe(true);
      expect(resumed.manifest_sha256).toBe(sourceSnapshot.manifest_sha256);
      const repeated = await restoreTestSnapshotInBatches(state, sourceSnapshot, 1);
      expect(repeated.restored).toBe(true);
      expect(repeated.manifest_sha256).toBe(sourceSnapshot.manifest_sha256);
      const finalCounts = Object.fromEntries(SNAPSHOT_TABLES.map(table => [
        table.name,
        state.storage.sql.exec("SELECT COUNT(*) AS count FROM " + table.name).one().count
      ]));
      expect(finalCounts).toEqual(sourceSnapshot.counts);
    });
  });

  it("rejects destination mutation between interrupted restore and resume without writing more rows", async () => {
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    await store.upsertCandidates([candidate()], now);
    const accepted = await submitEvidence(store, "github:ollama/ollama", {
      check_type: "pricing_and_free_limits",
      source_title: "Official pricing page",
      source_url: "https://ollama.com/pricing",
      excerpt: "Mutation conflict fixture."
    }, now, "c4e6d1c2-3b7f-4a91-8c22-1234567890ab");
    expect(accepted.accepted).toBe(true);
    const sourceSnapshot = await runInDurableObject(store, async (_instance, state) =>
      captureTestSnapshot(state, 1)
    );
    const destination = env.AGENT_AI_BANK_CANDIDATE_STORE.getByName(
      "agent-ai-bank-candidates-restore-mutated-" + testIndex
    );

    await runInDurableObject(destination, async (_instance, state) => {
      await expect(restoreTestSnapshotInBatches(state, sourceSnapshot, 1, 1))
        .rejects.toThrow("simulated_restore_interruption");
      const beforeMutation = state.storage.sql.exec(
        "SELECT COUNT(*) AS count FROM ai_bank_candidates"
      ).one().count;
      expect(beforeMutation).toBe(1);

      state.storage.sql.exec(
        "UPDATE ai_bank_candidates SET candidate_json = ? WHERE candidate_id = ?",
        "{\"tampered\":true}", "github:ollama/ollama"
      );

      expect(await restoreTestSnapshotInBatches(state, sourceSnapshot, 1)).toEqual({
        restored: false,
        reason: "restore_destination_conflict"
      });
      expect(state.storage.sql.exec(
        "SELECT candidate_json FROM ai_bank_candidates WHERE candidate_id = ?",
        "github:ollama/ollama"
      ).one().candidate_json).toBe("{\"tampered\":true}");
      expect(state.storage.sql.exec(
        "SELECT COUNT(*) AS count FROM ai_bank_review_evidence"
      ).one().count).toBe(0);
    });
  });

  it("rejects a non-empty restore destination containing unrelated rows", async () => {
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    await store.upsertCandidates([candidate()], now);
    const sourceSnapshot = await runInDurableObject(store, async (_instance, state) =>
      captureTestSnapshot(state, 1)
    );
    const destination = env.AGENT_AI_BANK_CANDIDATE_STORE.getByName(
      "agent-ai-bank-candidates-restore-conflict-" + testIndex
    );
    await runInDurableObject(destination, async (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO ai_bank_candidates (candidate_id, repository, candidate_json, release_at, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
        "unrelated-candidate", "other/repo", "{}", now, now, now
      );
      expect(await restoreTestSnapshotInBatches(state, sourceSnapshot, 1)).toEqual({
        restored: false,
        reason: "restore_destination_conflict"
      });
      expect(state.storage.sql.exec("SELECT COUNT(*) AS count FROM ai_bank_candidates").one().count).toBe(1);
    });
  });

  it("restores a verified snapshot into a fresh emulator object idempotently and preserves replay protection", async () => {
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    const eventId = "e4e6d1c2-3b7f-4a91-8c22-1234567890ab";
    const evidence = {
      check_type: "pricing_and_free_limits",
      source_title: "Official pricing page",
      source_url: "https://ollama.com/pricing",
      excerpt: "Pricing evidence is retained for human review."
    };
    await store.upsertCandidates([candidate()], now);
    const accepted = await submitEvidence(store, "github:ollama/ollama", evidence, now, eventId);
    expect(accepted.accepted).toBe(true);

    const sourceSnapshot = await runInDurableObject(store, async (_instance, state) =>
      captureTestSnapshot(state, 1)
    );
    const restoredStore = env.AGENT_AI_BANK_CANDIDATE_STORE.getByName(
      "agent-ai-bank-candidates-restore-" + testIndex
    );
    await runInDurableObject(restoredStore, async (_instance, state) => {
      expect(await restoreTestSnapshot(state, sourceSnapshot)).toEqual({
        restored: true,
        manifest_sha256: sourceSnapshot.manifest_sha256
      });
      expect(await restoreTestSnapshot(state, sourceSnapshot)).toEqual({
        restored: true,
        manifest_sha256: sourceSnapshot.manifest_sha256
      });
      const counts = Object.fromEntries(SNAPSHOT_TABLES.map(table => [
        table.name,
        state.storage.sql.exec("SELECT COUNT(*) AS count FROM " + table.name).one().count
      ]));
      expect(counts).toEqual(sourceSnapshot.counts);
    });

    const replay = await submitEvidence(restoredStore, "github:ollama/ollama", evidence, now, eventId);
    expect(replay).toEqual({ accepted: false, reason: "duplicate_audit_event" });
    const sourceAfterRestore = await runInDurableObject(store, async (_instance, state) =>
      captureTestSnapshot(state, 1)
    );
    expect(sourceAfterRestore.manifest_sha256).toBe(sourceSnapshot.manifest_sha256);
  });

  it("rejects snapshot schema drift and unknown row fields before destination writes", async () => {
    await store.upsertCandidates([candidate()]);
    const sourceSnapshot = await runInDurableObject(store, async (_instance, state) =>
      captureTestSnapshot(state, 1)
    );
    const tampered = structuredClone(sourceSnapshot);
    tampered.tables.ai_bank_candidates[0].unexpected_column = "not-in-schema";
    const destination = env.AGENT_AI_BANK_CANDIDATE_STORE.getByName(
      "agent-ai-bank-candidates-schema-drift-" + testIndex
    );
    await runInDurableObject(destination, async (_instance, state) => {
      expect(await restoreTestSnapshot(state, tampered)).toEqual({
        restored: false,
        reason: "snapshot_integrity_invalid"
      });
      expect(state.storage.sql.exec("SELECT COUNT(*) AS count FROM ai_bank_candidates").one().count).toBe(0);
    });
  });

  it("rejects internally consistent but referentially broken snapshot rows", async () => {
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    await store.upsertCandidates([candidate()], now);
    const accepted = await submitEvidence(store, "github:ollama/ollama", {
      check_type: "pricing_and_free_limits",
      source_title: "Official pricing page",
      source_url: "https://ollama.com/pricing",
      excerpt: "Reference integrity fixture."
    }, now, "a4e6d1c2-3b7f-4a91-8c22-1234567890ab");
    expect(accepted.accepted).toBe(true);
    const sourceSnapshot = await runInDurableObject(store, async (_instance, state) =>
      captureTestSnapshot(state, 1)
    );
    const tampered = structuredClone(sourceSnapshot);
    tampered.tables.ai_bank_candidates[0].candidate_id = "missing-parent";
    tampered.table_sha256.ai_bank_candidates = await sha256Hex(canonicalSnapshotJson(tampered.tables.ai_bank_candidates));
    const manifest = {
      format_id: tampered.format_id,
      format_version: tampered.format_version,
      counts: tampered.counts,
      table_sha256: tampered.table_sha256
    };
    tampered.manifest_sha256 = await sha256Hex(canonicalSnapshotJson(manifest));
    const destination = env.AGENT_AI_BANK_CANDIDATE_STORE.getByName(
      "agent-ai-bank-candidates-broken-reference-" + testIndex
    );
    await runInDurableObject(destination, async (_instance, state) => {
      expect(await restoreTestSnapshot(state, tampered)).toEqual({
        restored: false,
        reason: "snapshot_integrity_invalid"
      });
      expect(state.storage.sql.exec("SELECT COUNT(*) AS count FROM ai_bank_candidates").one().count).toBe(0);
    });
  });

  it("rejects a tampered snapshot before writing to the destination emulator object", async () => {
    await store.upsertCandidates([candidate()]);
    const sourceSnapshot = await runInDurableObject(store, async (_instance, state) =>
      captureTestSnapshot(state, 1)
    );
    const tampered = structuredClone(sourceSnapshot);
    tampered.tables.ai_bank_candidates[0].repository = "attacker/modified";
    const destination = env.AGENT_AI_BANK_CANDIDATE_STORE.getByName(
      "agent-ai-bank-candidates-tampered-" + testIndex
    );
    await runInDurableObject(destination, async (_instance, state) => {
      expect(await restoreTestSnapshot(state, tampered)).toEqual({
        restored: false,
        reason: "snapshot_integrity_invalid"
      });
      expect(state.storage.sql.exec(
        "SELECT COUNT(*) AS count FROM ai_bank_candidates"
      ).one().count).toBe(0);
    });
  });

  it("captures a deterministic read-only four-table snapshot in one SQLite transaction", async () => {
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    await store.upsertCandidates([candidate()], now);
    const eventId = "d4e6d1c2-3b7f-4a91-8c22-1234567890ab";
    const accepted = await submitEvidence(store, "github:ollama/ollama", {
      check_type: "pricing_and_free_limits",
      source_title: "Official pricing page",
      source_url: "https://ollama.com/pricing",
      excerpt: "Pricing evidence is retained for human review."
    }, now, eventId);
    expect(accepted.accepted).toBe(true);

    await runInDurableObject(store, async (_instance, state) => {
      const before = Object.fromEntries(SNAPSHOT_TABLES.map(table => [
        table.name,
        state.storage.sql.exec("SELECT COUNT(*) AS count FROM " + table.name).one().count
      ]));
      const first = await captureTestSnapshot(state, 1);
      const second = await captureTestSnapshot(state, 1);
      const after = Object.fromEntries(SNAPSHOT_TABLES.map(table => [
        table.name,
        state.storage.sql.exec("SELECT COUNT(*) AS count FROM " + table.name).one().count
      ]));

      expect(first).toEqual(second);
      expect(first.format_id).toBe("ai-bank-audit-emulator-snapshot");
      expect(first.format_version).toBe(1);
      expect(first.counts).toEqual({
        ai_bank_candidates: 1,
        ai_bank_review_evidence: 1,
        ai_bank_review_evidence_releases: 1,
        ai_bank_evidence_audit_events: 1
      });
      expect(first.manifest_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(before).toEqual(after);

      const tampered = structuredClone(first);
      tampered.table_sha256.ai_bank_review_evidence = "0".repeat(64);
      const tamperedManifest = {
        format_id: tampered.format_id,
        format_version: tampered.format_version,
        counts: tampered.counts,
        table_sha256: tampered.table_sha256
      };
      expect(await sha256Hex(canonicalSnapshotJson(tamperedManifest))).not.toBe(first.manifest_sha256);
    });
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
    const result = await submitEvidence(store, "github:ollama/ollama", {
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
    expect(await submitEvidence(store, "github:missing/tool", evidence)).toEqual({
      accepted: false, reason: "candidate_not_found"
    });
    await store.upsertCandidates([candidate()]);
    expect(await submitEvidence(store, "github:ollama/ollama", {
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
      expect(await submitEvidence(store, "github:ollama/ollama", {
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
      expect((await submitEvidence(store, 
        "github:ollama/ollama", makeEvidence(index)
      )).accepted).toBe(true);
    }
    expect(await submitEvidence(store, 
      "github:ollama/ollama", makeEvidence(0)
    )).toEqual({ accepted: false, reason: "duplicate_evidence" });
    expect(await submitEvidence(store, 
      "github:ollama/ollama", makeEvidence(5)
    )).toEqual({ accepted: false, reason: "evidence_limit_reached" });
    expect(await store.listReviewEvidence("github:ollama/ollama", 30)).toHaveLength(5);
    await expect(Promise.resolve().then(() =>
      store.listReviewEvidence("github:ollama/ollama", 31)
    )).rejects.toThrow("invalid_evidence_list_limit");
  });

  it("rolls back evidence and release association when the audit insert fails", async () => {
    await store.upsertCandidates([candidate()]);
    const eventId = "e4e6d1c2-3b7f-4a91-8c22-1234567890ab";
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    const evidence = {
      check_type: "pricing_and_free_limits",
      source_title: "Official pricing page",
      source_url: "https://ollama.com/pricing",
      excerpt: "Pricing evidence requires human review."
    };

    const token = await writerSessionToken(now);
    await runInDurableObject(store, async (instance, state) => {
      state.storage.sql.exec(
        "CREATE TRIGGER fail_ai_bank_evidence_audit_insert " +
        "BEFORE INSERT ON ai_bank_evidence_audit_events " +
        "BEGIN SELECT RAISE(ABORT, 'forced_audit_insert_failure'); END"
      );

      await expect(instance.submitAuthorizedReviewEvidence(
        "github:ollama/ollama", evidence, token,
        eventId, writerAuthEnv, now
      )).rejects.toThrow("forced_audit_insert_failure");

      const evidenceCount = state.storage.sql.exec(
        "SELECT COUNT(*) AS count FROM ai_bank_review_evidence WHERE candidate_id = ?",
        "github:ollama/ollama"
      ).one().count;
      const releaseAssociationCount = state.storage.sql.exec(
        "SELECT COUNT(*) AS count FROM ai_bank_review_evidence_releases"
      ).one().count;
      const auditCount = state.storage.sql.exec(
        "SELECT COUNT(*) AS count FROM ai_bank_evidence_audit_events WHERE event_id = ?",
        eventId
      ).one().count;
      expect(evidenceCount).toBe(0);
      expect(releaseAssociationCount).toBe(0);
      expect(auditCount).toBe(0);
      state.storage.sql.exec("DROP TRIGGER fail_ai_bank_evidence_audit_insert");
    });
  });

  it("atomically rejects replayed audit event IDs, including concurrent submissions", async () => {
    await store.upsertCandidates([candidate()]);
    const evidence = {
      check_type: "pricing_and_free_limits",
      source_title: "Official pricing page",
      source_url: "https://ollama.com/pricing",
      excerpt: "Pricing evidence requires human review."
    };
    const eventId = "a4e6d1c2-3b7f-4a91-8c22-1234567890ab";
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    const token = await writerSessionToken(now);
    const submit = () => store.submitAuthorizedReviewEvidence(
      "github:ollama/ollama", evidence, token, eventId, writerAuthEnv, now
    );
    const results = await Promise.all([submit(), submit()]);
    expect(results.filter(item => item.accepted)).toHaveLength(1);
    expect(results.filter(item => item.reason === "duplicate_audit_event")).toHaveLength(1);
    expect(await store.listReviewEvidence("github:ollama/ollama")).toHaveLength(1);
  });

  it("binds an audit event ID to its actor and exact evidence payload", async () => {
    await store.upsertCandidates([candidate()]);
    const eventId = "b4e6d1c2-3b7f-4a91-8c22-1234567890ab";
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    const firstEvidence = {
      check_type: "license_scope",
      source_title: "Official license",
      source_url: "https://github.com/ollama/ollama/blob/main/LICENSE",
      excerpt: "License evidence requires human review."
    };
    const first = await store.submitAuthorizedReviewEvidence(
      "github:ollama/ollama", firstEvidence, await writerSessionToken(now),
      eventId, writerAuthEnv, now
    );
    expect(first.accepted).toBe(true);
    const changedPayload = await store.submitAuthorizedReviewEvidence(
      "github:ollama/ollama", { ...firstEvidence, excerpt: "Changed evidence excerpt." },
      await writerSessionToken(now), eventId, writerAuthEnv, now
    );
    expect(changedPayload).toEqual({ accepted: false, reason: "audit_event_id_reused" });
    expect(await store.listReviewEvidence("github:ollama/ollama")).toHaveLength(1);
  });

  it("fails closed at the lifetime audit capacity without deleting replay history or adding evidence", async () => {
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    await store.upsertCandidates([candidate()], now);
    const eventId = "f4e6d1c2-3b7f-4a91-8c22-1234567890ab";
    await runInDurableObject(store, async (_instance, state) => {
      state.storage.sql.exec(
        "WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM seq WHERE x < 10000) " +
        "INSERT INTO ai_bank_evidence_audit_events " +
        "(event_id, actor_subject, actor_email, request_sha256, evidence_id, recorded_at) " +
        "SELECT 'capacity-' || printf('%012d', x), 'google-subject', 'reviewer@example.com', " +
        "printf('%064d', 0), 'historical-evidence', '2026-11-19T09:00:00.000Z' FROM seq"
      );
      expect(state.storage.sql.exec(
        "SELECT COUNT(*) AS count FROM ai_bank_evidence_audit_events"
      ).one().count).toBe(10000);
    });
    const evidence = {
      check_type: "pricing_and_free_limits",
      source_title: "Official pricing page",
      source_url: "https://ollama.com/pricing",
      excerpt: "Pricing evidence requires human review."
    };
    const blocked = await store.submitAuthorizedReviewEvidence(
      "github:ollama/ollama", evidence, await writerSessionToken(now),
      eventId, writerAuthEnv, now
    );
    expect(blocked).toEqual({ accepted: false, reason: "evidence_audit_capacity_reached" });
    await runInDurableObject(store, async (_instance, state) => {
      expect(state.storage.sql.exec(
        "SELECT COUNT(*) AS count FROM ai_bank_evidence_audit_events"
      ).one().count).toBe(10000);
      expect(state.storage.sql.exec(
        "SELECT COUNT(*) AS count FROM ai_bank_review_evidence"
      ).one().count).toBe(0);
      expect(state.storage.sql.exec(
        "SELECT COUNT(*) AS count FROM ai_bank_review_evidence_releases"
      ).one().count).toBe(0);
    });
  });

  it("caps accepted audit writes at 100 per UTC day without deleting replay records", async () => {
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    await store.upsertCandidates([candidate()], now);
    const token = await writerSessionToken(now);
    const evidence = {
      check_type: "pricing_and_free_limits",
      source_title: "Official pricing page",
      source_url: "https://ollama.com/pricing",
      excerpt: "Pricing evidence requires human review."
    };
    for (let index = 0; index < 100; index += 1) {
      const publishedAt = new Date(Date.parse("2026-11-19T08:00:00.000Z") + index * 1000).toISOString();
      const discoveredAt = new Date(Date.parse(publishedAt) + 5 * 60 * 1000).toISOString();
      const nextCandidate = candidate(sources[0], "v1.2." + (index + 3), publishedAt);
      nextCandidate.discovered_at = discoveredAt;
      await store.upsertCandidates([nextCandidate], now);
      const eventId = "00000000-0000-4000-8000-" + (index + 1).toString(16).padStart(12, "0");
      const accepted = await store.submitAuthorizedReviewEvidence(
        "github:ollama/ollama", evidence, token, eventId, writerAuthEnv, now
      );
      expect(accepted.accepted, "audit event " + index).toBe(true);
    }
    const blockedCandidate = candidate(sources[0], "v1.2.103", "2026-11-19T08:02:00.000Z");
    blockedCandidate.discovered_at = "2026-11-19T08:07:00.000Z";
    await store.upsertCandidates([blockedCandidate], now);
    const blocked = await store.submitAuthorizedReviewEvidence(
      "github:ollama/ollama", evidence, token,
      "00000000-0000-4000-8000-000000000065", writerAuthEnv, now
    );
    expect(blocked).toEqual({ accepted: false, reason: "evidence_audit_daily_limit_reached" });

    const evidenceHistoryBeforeReplay = await store.listReviewEvidence("github:ollama/ollama", 30);
    const replayAfterCap = await store.submitAuthorizedReviewEvidence(
      "github:ollama/ollama", evidence, token,
      "00000000-0000-4000-8000-000000000001", writerAuthEnv, now
    );
    expect(replayAfterCap).toEqual({ accepted: false, reason: "duplicate_audit_event" });
    expect(await store.listReviewEvidence("github:ollama/ollama", 30)).toEqual(evidenceHistoryBeforeReplay);
  });

  it("denies an unallowlisted writer without recording evidence or an audit event", async () => {
    await store.upsertCandidates([candidate()]);
    const now = Date.parse("2026-11-19T10:00:00.000Z");
    const denied = await store.submitAuthorizedReviewEvidence(
      "github:ollama/ollama",
      {
        check_type: "pricing_and_free_limits",
        source_title: "Pricing",
        source_url: "https://ollama.com/pricing",
        excerpt: "Pending review."
      },
      await writerSessionToken(now),
      "c4e6d1c2-3b7f-4a91-8c22-1234567890ab",
      { ...writerAuthEnv, GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS: "other@example.com" },
      now
    );
    expect(denied).toEqual({ accepted: false, reason: "evidence_writer_not_allowlisted" });
    expect(await store.listReviewEvidence("github:ollama/ollama")).toEqual([]);
  });

  it("builds an explicit six-part review packet without treating submitted evidence as verified", async () => {
    await store.upsertCandidates([candidate()]);
    await submitEvidence(store, "github:ollama/ollama", {
      check_type: "pricing_and_free_limits",
      source_title: "Pricing reference",
      source_url: "https://ollama.com/pricing",
      excerpt: "Pricing excerpt awaiting review."
    });
    await submitEvidence(store, "github:ollama/ollama", {
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
    await submitEvidence(store, "github:ollama/ollama", {
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
    const first = await submitEvidence(store, 
      "github:ollama/ollama", evidence, Date.parse("2026-11-19T08:10:00.000Z")
    );
    expect(first.accepted).toBe(true);

    const newer = candidate(sources[0], "v1.2.4", "2026-11-19T11:00:00.000Z");
    newer.discovered_at = "2026-11-19T11:05:00.000Z";
    await store.upsertCandidates([newer], Date.parse("2026-11-19T11:06:00.000Z"));

    const second = await submitEvidence(store, 
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
    expect(await submitEvidence(store, 
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
      expect((await submitEvidence(store, 
        "github:ollama/ollama", makeEvidence("old", index)
      )).accepted).toBe(true);
    }

    const newer = candidate(sources[0], "v1.2.4", "2026-11-19T11:00:00.000Z");
    newer.discovered_at = "2026-11-19T11:05:00.000Z";
    await store.upsertCandidates([newer], Date.parse("2026-11-19T11:06:00.000Z"));

    for (let index = 0; index < 5; index += 1) {
      expect((await submitEvidence(store, 
        "github:ollama/ollama", makeEvidence("new", index)
      )).accepted).toBe(true);
    }
    expect(await submitEvidence(store, 
      "github:ollama/ollama", makeEvidence("new", 5)
    )).toEqual({ accepted: false, reason: "evidence_limit_reached" });
    const packet = await store.getReviewPacket("github:ollama/ollama");
    expect(packet.total_evidence).toBe(5);
    expect(packet.checklist.find(item => item.check_type === "license_scope").evidence_count).toBe(5);
  });


});