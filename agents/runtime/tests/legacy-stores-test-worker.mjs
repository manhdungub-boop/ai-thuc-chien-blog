import { AgentAIBankCandidateStore } from "../src/ai-bank-candidate-store.mjs";
import { AgentDraftStore } from "../src/draft-artifact-store.mjs";
import { AgentReviewerAuthStore } from "../src/google-reviewer-auth-store.mjs";

export { AgentAIBankCandidateStore, AgentDraftStore, AgentReviewerAuthStore };

export default {
  async fetch() {
    return new Response("not_found", { status: 404 });
  }
};
