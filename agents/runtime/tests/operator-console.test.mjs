import { describe, expect, it } from "vitest";
import worker from "../src/index.mjs";
import { OPERATOR_CONSOLE_HTML, OPERATOR_CONSOLE_JS } from "../src/operator-console.mjs";

const origin = "https://ai-thuc-chien-agent-runtime-preview.test-account.workers.dev";

describe("operator console security and behavior", () => {
  it("uses same-origin external assets and does not embed executable inline scripts", () => {
    expect(OPERATOR_CONSOLE_HTML).toContain('<script src="/operator-console.js" defer></script>');
    expect(OPERATOR_CONSOLE_HTML).toContain('href="/auth/google/start"');
    expect(OPERATOR_CONSOLE_HTML).toContain('id="pause-button"');
    expect(OPERATOR_CONSOLE_HTML).toContain('id="resume-button"');
    expect(OPERATOR_CONSOLE_HTML).not.toContain("<style");
    expect(OPERATOR_CONSOLE_HTML).not.toMatch(/<script(?! src=)/i);
  });

  it("uses only same-origin authenticated requests and safe text rendering", () => {
    expect(OPERATOR_CONSOLE_JS).toContain('credentials: "same-origin"');
    expect(OPERATOR_CONSOLE_JS).toContain('requestJson("/api/operator/runtime-control")');
    expect(OPERATOR_CONSOLE_JS).toContain('method: "POST"');
    expect(OPERATOR_CONSOLE_JS).toContain('JSON.stringify({ action, reason })');
    expect(OPERATOR_CONSOLE_JS).toContain("window.confirm");
    expect(OPERATOR_CONSOLE_JS).toContain("reason.length < 12");
    expect(OPERATOR_CONSOLE_JS).toContain("textContent");
    expect(OPERATOR_CONSOLE_JS).not.toContain("innerHTML");
    expect(OPERATOR_CONSOLE_JS).not.toContain("eval(");
    expect(OPERATOR_CONSOLE_JS).not.toContain("localStorage");
    expect(OPERATOR_CONSOLE_JS).not.toContain("sessionStorage");
  });

  it("serves the operator console with a restrictive same-origin CSP", async () => {
    const response = await worker.fetch(new Request(origin + "/operator-console"), {});
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await response.text()).toContain("Điều khiển AI Agent Runtime");
  });

  it("serves the external console script and rejects non-GET methods", async () => {
    const script = await worker.fetch(new Request(origin + "/operator-console.js"), {});
    const post = await worker.fetch(new Request(origin + "/operator-console", { method: "POST" }), {});
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("javascript");
    expect(await script.text()).toContain("/api/operator/runtime-control");
    expect(post.status).toBe(405);
  });
});
