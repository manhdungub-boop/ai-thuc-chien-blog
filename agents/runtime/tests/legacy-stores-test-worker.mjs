import { AgentAIBankCandidateStore } from "../src/ai-bank-candidate-store.mjs";
import { AgentDraftStore } from "../src/draft-artifact-store.mjs";
import { AgentReviewerAuthStore } from "../src/google-reviewer-auth-store.mjs";

const METHODS = {
  AGENT_AI_BANK_CANDIDATE_STORE: new Set(["upsertCandidates", "listCandidates", "getCandidate", "submitReviewEvidence", "listReviewEvidence", "getReviewPacket", "stats"]),
  AGENT_DRAFT_STORE: new Set(["createDraft", "reviseDraft", "reviseDraftForReviewer", "recordReviewerClaimDecisions", "storeEvidenceLedger", "recordEvidenceReview", "listPendingReviewsForReviewer", "listNeedsRevisionForReviewer", "getDraftForReviewer", "getDraft", "reviewDraft", "listPendingReviews", "listNeedsRevision", "listOwnerReleaseReviews", "stats", "getTestAuthConfig"]),
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
        const result = await this[input.method](...input.args);
        return Response.json({ ok: true, result });
      } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : "rpc_failed" }, { status: 400 });
      }
    }
  };
}

class TestAgentAIBankCandidateStore extends withRpcFetch(AgentAIBankCandidateStore, "AGENT_AI_BANK_CANDIDATE_STORE") {}
class TestAgentDraftStore extends withRpcFetch(AgentDraftStore, "AGENT_DRAFT_STORE") {
  async getTestAuthConfig() {
    return {
      enabled: this.env.AGENT_REVIEWER_AUTH_ENABLED,
      clientIdLength: this.env.GOOGLE_REVIEWER_CLIENT_ID?.length ?? 0,
      clientSecretLength: this.env.GOOGLE_REVIEWER_CLIENT_SECRET?.length ?? 0,
      redirectUri: this.env.GOOGLE_REVIEWER_REDIRECT_URI,
      allowedEmails: this.env.GOOGLE_REVIEWER_ALLOWED_EMAILS,
      stateSecretLength: this.env.GOOGLE_REVIEWER_STATE_SECRET?.length ?? 0,
      sessionSecretLength: this.env.GOOGLE_REVIEWER_SESSION_SECRET?.length ?? 0
    };
  }
}
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
