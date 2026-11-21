import { describe, it } from "node:test";
import { expect } from "./test-compat.mjs";
import { handleReviewerHttpRequest } from "../src/reviewer-http-routes.mjs";

const base = "https://ai-thuc-chien-agent-runtime-preview.manhdungub.workers.dev";

describe("reviewer and operator HTTP routes", () => {
  it("serves the operator console with no-store and a restrictive CSP", async () => {
    const response = await handleReviewerHttpRequest(new Request(`${base}/operator-console`), {});
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await response.text()).toContain("operator-console.js");
  });

  it("serves the reviewer console and same-origin JavaScript assets", async () => {
    const page = await handleReviewerHttpRequest(new Request(`${base}/reviewer-console`), {});
    const script = await handleReviewerHttpRequest(new Request(`${base}/reviewer-console.js`), {});
    expect(page.status).toBe(200);
    expect((await page.text()).toLowerCase()).toContain("reviewer");
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("application/javascript");
  });

  it("keeps reviewer authentication disabled when Preview credentials are absent", async () => {
    const response = await handleReviewerHttpRequest(new Request(`${base}/auth/google/start`), {});
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("reviewer_auth_not_configured");
  });

  it("keeps operator controls disabled until the separate control gate is enabled", async () => {
    const response = await handleReviewerHttpRequest(new Request(`${base}/api/operator/runtime-control`), {
      AGENT_OPERATOR_CONTROL_ENABLED: "false"
    });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("operator_control_disabled");
  });

  it("rejects cross-origin operator mutations before checking credentials", async () => {
    const response = await handleReviewerHttpRequest(new Request(`${base}/api/operator/runtime-control`, {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pause", reason: "manual emergency pause" })
    }), { AGENT_OPERATOR_CONTROL_ENABLED: "true" });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("same_origin_required");
  });

  it("rejects cross-origin reviewer authoring mutations", async () => {
    const response = await handleReviewerHttpRequest(new Request(`${base}/api/reviewer/drafts/12345678/authoring`, {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ expected_version: 1, draft: {} })
    }), {});
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("same_origin_required");
  });

  it("requires a reviewer session before exposing draft queues", async () => {
    const response = await handleReviewerHttpRequest(new Request(`${base}/api/reviewer/drafts`), {});
    expect(response.status).toBe(401);
    expect(await response.text()).toContain("reviewer_session_required");
  });

  it("leaves unrelated Worker paths for the main Worker handler", async () => {
    expect(await handleReviewerHttpRequest(new Request(`${base}/health`), {})).toBeNull();
    expect(await handleReviewerHttpRequest(new Request(`${base}/run`, { method: "POST" }), {})).toBeNull();
  });
});
