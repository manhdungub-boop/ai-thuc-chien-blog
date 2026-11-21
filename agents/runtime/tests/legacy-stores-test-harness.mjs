import { Miniflare } from "miniflare";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(here, "legacy-stores-test-worker.mjs");

export async function createLegacyStoresRuntime() {
  const mf = new Miniflare({
    modules: true,
    scriptPath: workerPath,
    compatibilityDate: "2026-07-08",
    durableObjects: {
      AGENT_AI_BANK_CANDIDATE_STORE: { className: "AgentAIBankCandidateStore", useSQLite: true },
      AGENT_DRAFT_STORE: { className: "AgentDraftStore", useSQLite: true },
      AGENT_REVIEWER_AUTH_STORE: { className: "AgentReviewerAuthStore", useSQLite: true }
    },
    bindings: {
      AGENT_REVIEWER_AUTH_ENABLED: "true",
      GOOGLE_REVIEWER_CLIENT_ID: "preview-test-client-id-abcdefghijklmnopqrstuvwxyz.apps.googleusercontent.com",
      GOOGLE_REVIEWER_CLIENT_SECRET: "test-google-client-secret-value-abcdefghijklmnopqrstuvwxyz0123456789",
      GOOGLE_REVIEWER_REDIRECT_URI: "https://ai-thuc-chien-agent-runtime-preview.manhdungub.workers.dev/auth/google/callback",
      GOOGLE_REVIEWER_ALLOWED_EMAILS: "reviewer@example.com",
      GOOGLE_REVIEWER_STATE_SECRET: "state-secret-for-tests-only-abcdefghijklmnopqrstuvwxyz0123456789",
      GOOGLE_REVIEWER_SESSION_SECRET: "session-secret-for-tests-only-zyxwvutsrqponmlkjihgfedcba9876543210"
    }
  });
  return {
    mf,
    aiBank: await mf.getDurableObjectNamespace("AGENT_AI_BANK_CANDIDATE_STORE"),
    drafts: await mf.getDurableObjectNamespace("AGENT_DRAFT_STORE"),
    auth: await mf.getDurableObjectNamespace("AGENT_REVIEWER_AUTH_STORE")
  };
}
