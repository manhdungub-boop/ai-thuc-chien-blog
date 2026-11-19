import worker, { AgentStateStore } from "../src/worker.mjs";
import { hasValidStateStoreBearer } from "../src/internal-auth.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Test-only Durable Object subclass. This module is loaded by Miniflare tests,
 * never by the checked-in Wrangler entrypoint. Test clocks and rollback probes
 * therefore cannot be enabled through a deployed Worker environment variable.
 */
export class TestAgentStateStore extends AgentStateStore {
  requestTime(request) {
    const value = request.headers.get("x-test-now");
    if (value) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return Date.now();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/__test/rollback" || request.method !== "POST") {
      return super.fetch(request);
    }

    if (!await hasValidStateStoreBearer(request, this.env)) {
      return jsonResponse({ ok: false, error: "state_store_auth_required" }, 401);
    }

    try {
      await this.ready;
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("INSERT INTO daily_usage (day_utc, accepted_count) VALUES ('2099-12-31', 1)");
        throw new Error("intentional_rollback_probe");
      });
    } catch {
      const usage = this.sql.exec(
        "SELECT accepted_count FROM daily_usage WHERE day_utc = '2099-12-31'"
      ).toArray()[0] ?? null;
      return jsonResponse({
        ok: true,
        rolledBack: usage === null,
        acceptedToday: usage?.accepted_count ?? 0,
      });
    }
    return jsonResponse({ ok: false, error: "rollback_probe_did_not_throw" }, 500);
  }
}

export default worker;
