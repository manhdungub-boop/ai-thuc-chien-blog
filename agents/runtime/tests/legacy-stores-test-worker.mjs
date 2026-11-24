import { AgentAIBankCandidateStore } from "../src/ai-bank-candidate-store.mjs";
import { AgentDraftStore } from "../src/draft-artifact-store.mjs";
import { AgentReviewerAuthStore } from "../src/google-reviewer-auth-store.mjs";

const METHODS = {
  AGENT_AI_BANK_CANDIDATE_STORE: new Set(["upsertCandidates", "listCandidates", "getCandidate", "submitAuthorizedReviewEvidence", "listReviewEvidence", "getReviewPacket", "stats", "getDiscoveryCursor", "upsertCandidatesAndAdvanceCursor", "testFetch", "testInstallCandidateInsertFailureTrigger", "testDropCandidateInsertFailureTrigger", "testSetLegacyDiscoveryDigest", "testUppercaseAuditEventId"]),
  AGENT_DRAFT_STORE: new Set(["createDraft", "createDraftFromAgent", "setRuntimePaused", "reviseDraft", "reviseDraftForReviewer", "recordReviewerClaimDecisions", "storeEvidenceLedger", "recordEvidenceReview", "listPendingReviewsForReviewer", "listNeedsRevisionForReviewer", "getDraftForReviewer", "getDraft", "reviewDraft", "listPendingReviews", "listNeedsRevision", "listOwnerReleaseReviews", "stats"]),
  AGENT_REVIEWER_AUTH_STORE: new Set(["consumeStartRateLimit", "createTransaction", "consumeTransaction"])
};

function withRpcFetch(Base, binding) {
  return class extends Base {
    async fetch(request) {
      if (request.method !== "POST") return new Response("method_not_allowed", { status: 405 });
      let input;
      try { input = await request.json(); } catch { return Response.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
      if (!input || typeof input !== "object" || Array.isArray(input) ||
          !METHODS[binding].has(input.method) || !Array.isArray(input.args)) {
        return Response.json({ ok: false, error: "invalid_rpc_request" }, { status: 400 });
      }
      try {
        let result;
        if (input.method === "testFetch") {
          const [url, method, headers] = input.args;
          const response = await Base.prototype.fetch.call(this, new Request(url, { method, headers }));
          result = {
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: await response.text()
          };
        } else {
          result = await this[input.method](...input.args);
        }
        return Response.json({ ok: true, result });
      } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : "rpc_failed" }, { status: 400 });
      }
    }
  };
}

class TestAgentAIBankCandidateStore extends withRpcFetch(AgentAIBankCandidateStore, "AGENT_AI_BANK_CANDIDATE_STORE") {
  testInstallCandidateInsertFailureTrigger() {
    this.ctx.storage.sql.exec(
      "CREATE TRIGGER test_fail_second_candidate_insert BEFORE INSERT ON ai_bank_candidates " +
      "WHEN NEW.candidate_id = 'github:Comfy-Org/ComfyUI' " +
      "BEGIN SELECT RAISE(ABORT, 'injected_candidate_insert_failure'); END"
    );
    return true;
  }

  testDropCandidateInsertFailureTrigger() {
    this.ctx.storage.sql.exec("DROP TRIGGER IF EXISTS test_fail_second_candidate_insert");
    return true;
  }

  testSetLegacyDiscoveryDigest() {
    this.ctx.storage.sql.exec("UPDATE ai_bank_discovery_cursor SET batch_sha256 = '' WHERE singleton_id = 1");
    return true;
  }

  testUppercaseAuditEventId(eventId) {
    this.ctx.storage.sql.exec(
      "UPDATE ai_bank_evidence_audit_events SET event_id = upper(event_id) WHERE event_id = ?",
      eventId
    );
    return true;
  }
}
class TestAgentDraftStore extends withRpcFetch(AgentDraftStore, "AGENT_DRAFT_STORE") {}
class TestAgentReviewerAuthStore extends withRpcFetch(AgentReviewerAuthStore, "AGENT_REVIEWER_AUTH_STORE") {}

export { TestAgentAIBankCandidateStore, TestAgentDraftStore, TestAgentReviewerAuthStore };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/__rpc" || request.method !== "POST") return new Response("not_found", { status: 404 });
    let input;
    try { input = await request.json(); } catch { return Response.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        !Object.hasOwn(METHODS, input.binding) || !METHODS[input.binding].has(input.method) ||
        typeof input.name !== "string" || !Array.isArray(input.args)) {
      return Response.json({ ok: false, error: "invalid_rpc_request" }, { status: 400 });
    }
    const namespace = env[input.binding];
    if (!namespace || typeof namespace.idFromName !== "function") {
      return Response.json({ ok: false, error: "test_binding_unavailable" }, { status: 503 });
    }
    try {
      const stub = namespace.get(namespace.idFromName(input.name));
      return await stub.fetch(new Request("https://legacy-store.internal/__rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: input.method, args: input.args })
      }));
    } catch (error) {
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "rpc_failed" }, { status: 400 });
    }
  }
};
