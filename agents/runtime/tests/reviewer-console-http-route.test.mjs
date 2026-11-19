import { describe, expect, it } from "vitest";
import worker from "../src/index.mjs";

const origin = "https://ai-thuc-chien-agent-runtime-preview.test-account.workers.dev";

describe("authenticated authoring and reviewer console HTTP routes", () => {
  it("serves a static console shell with a restrictive content security policy", async () => {
    const response = await worker.fetch(new Request(origin + "/reviewer-console"), {});
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
    expect(html).toContain('<script src="/reviewer-console.js" defer></script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("Không có quyền xuất bản");
    expect(html).toContain("Đề cương cần tác giả bổ sung");
    expect(html).toContain('id="authoring-queue"');
  });

  it("serves the console script as same-origin JavaScript without HTML injection sinks", async () => {
    const response = await worker.fetch(new Request(origin + "/reviewer-console.js"), {});
    const script = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(script).toContain('element.textContent = String(value)');
    expect(script).toContain('credentials: "same-origin"');
    expect(script).not.toContain("innerHTML");
    expect(script).not.toContain("insertAdjacentHTML");
    expect(script).toContain("!url.username && !url.password");
    expect(script).toContain('link.referrerPolicy = "no-referrer"');
    expect(script).toContain("CHƯA ĐỦ ĐIỀU KIỆN ĐÁNH GIÁ");
    expect(script).toContain("Danh sách URL hoặc claim manifest không thay thế được bằng chứng gốc");
    expect(script).toContain("Đánh giá từng luận điểm và từng nguồn");
    expect(script).toContain("Lưu bản sửa và tạo hồ sơ bằng chứng");
    expect(script).toContain("recorded");
    expect(script).toContain('select.value = "insufficient"');
    expect(script).toContain('overall.value = "needs_revision"');
  });

  it("requires an authenticated reviewer session for the authoring revision queue", async () => {
    const response = await worker.fetch(
      new Request(origin + "/api/reviewer/drafts-needing-authoring?limit=20"),
      {}
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "reviewer_session_required" });
  });

  it("rejects unsupported methods for console resources", async () => {
    const response = await worker.fetch(new Request(origin + "/reviewer-console", { method: "POST" }), {});
    expect(response.status).toBe(405);
  });
});
