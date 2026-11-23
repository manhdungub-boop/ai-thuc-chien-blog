import { Miniflare } from "miniflare";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(here, "legacy-stores-test-worker.mjs");

function rpcNamespace(mf, binding) {
  return {
    idFromName(name) { return name; },
    get(name) {
      return new Proxy({}, {
        get(_target, method) {
          if (method === "then") return undefined;
          if (method === "fetch") {
            return async request => {
              const response = await mf.dispatchFetch("https://legacy-stores.test/__rpc", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  binding,
                  name,
                  method: "testFetch",
                  args: [request.url, request.method, Object.fromEntries(request.headers)]
                })
              });
              const payload = await response.json();
              if (!response.ok || !payload.ok) throw new Error(payload.error || "store_rpc_failed");
              return new Response(payload.result.body, {
                status: payload.result.status,
                headers: payload.result.headers
              });
            };
          }
          return async (...args) => {
            const response = await mf.dispatchFetch("https://legacy-stores.test/__rpc", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ binding, name, method: String(method), args })
            });
            const payload = await response.json();
            if (!response.ok || !payload.ok) throw new Error(payload.error || "store_rpc_failed");
            return payload.result;
          };
        }
      });
    }
  };
}

export async function createLegacyStoresRuntime() {
  const mf = new Miniflare({
    modules: true,
    scriptPath: workerPath,
    compatibilityDate: "2026-07-08",
    durableObjects: {
      AGENT_AI_BANK_CANDIDATE_STORE: { className: "TestAgentAIBankCandidateStore", useSQLite: true },
      AGENT_DRAFT_STORE: { className: "TestAgentDraftStore", useSQLite: true },
      AGENT_REVIEWER_AUTH_STORE: { className: "TestAgentReviewerAuthStore", useSQLite: true }
    },
    bindings: {
      AGENT_REVIEWER_AUTH_ENABLED: "false"
    }
  });
  return {
    mf,
    aiBank: rpcNamespace(mf, "AGENT_AI_BANK_CANDIDATE_STORE"),
    drafts: rpcNamespace(mf, "AGENT_DRAFT_STORE"),
    auth: rpcNamespace(mf, "AGENT_REVIEWER_AUTH_STORE")
  };
}
