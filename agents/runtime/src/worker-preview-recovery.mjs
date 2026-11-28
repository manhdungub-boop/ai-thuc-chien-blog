import worker, { AgentStateStore } from "./worker.mjs";
export {
  AgentStateStore,
  AgentAIBankCandidateStore,
  AgentDraftStore,
  AgentReviewerAuthStore,
} from "./worker.mjs";

// Durable Object migrations are forward-only. The deployed Preview Worker
// already applied fault-test-v1, which created this isolated test-only class.
// Keep exporting it while restoring the normal fail-closed Preview handler.
export class TestAgentStateStore extends AgentStateStore {}

export default worker;
