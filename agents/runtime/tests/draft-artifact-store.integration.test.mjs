import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

const sources = [
  { title: "Official source one", publisher: "Research Lab One", url: "https://research-one.example/paper", accessed_at: "2026-11-18T00:00:00.000Z" },
  { title: "Official source two", publisher: "Research Lab Two", url: "https://research-two.example/report", accessed_at: "2026-11-18T00:00:00.000Z" },
  { title: "Official source three", publisher: "Research Lab Three", url: "https://research-three.example/guide", accessed_at: "2026-11-18T00:00:00.000Z" }
];
function validDraft() {
  const p = "Trí tuệ nhân tạo đang thay đổi cách tổ chức nghiên cứu, phát triển phần mềm và tự động hóa quy trình. Các nhóm triển khai cần xác định mục tiêu, giới hạn dữ liệu, đánh giá kết quả và giám sát rủi ro trước khi đưa hệ thống vào sử dụng. ";
  const body = ["## Tổng quan",p.repeat(8)+"[1]","## Kiến trúc hệ thống",p.repeat(8)+"[2]","## Quy trình triển khai",p.repeat(8)+"[3]","## An toàn và quản trị",p.repeat(8),"## Kết luận",p.repeat(4)].join("\n\n");
  return {
    title: "Xây dựng hệ thống AI agent an toàn và hiệu quả",
    slug: "xay-dung-he-thong-ai-agent-an-toan",
    meta_description: "Hướng dẫn xây dựng hệ thống AI agent có kiểm soát, an toàn, minh bạch và hiệu quả cho quy trình tự động hóa trong thực tế triển khai.",
    author: "DUNG - AI", language: "vi", body_markdown: body, sources,
    copyright_notice: "© DUNG - AI. Bản quyền nội dung thuộc về tác giả; các nguồn tham khảo được ghi nhận riêng."
  };
}
describe("AgentDraftStore Durable Object", () => {
  let store; let testIndex = 0;
  beforeEach(() => { testIndex += 1; store = env.AGENT_DRAFT_STORE.getByName("agent-draft-store-test-" + testIndex); });
  it("stores an eligible article only in the human-review queue", async () => {
    const result = await store.createDraft("draft-review-0001", validDraft());
    expect(result.accepted).toBe(true);
    expect(result.artifact.status).toBe("pending_human_review");
    expect(result.artifact.quality_review.publication_authorized).toBe(false);
    expect(await store.listPendingReviews()).toHaveLength(1);
    expect(await store.stats()).toEqual({ pending_human_review: 1 });
  });
  it("routes failed quality checks to needs_revision", async () => {
    const draft = validDraft(); draft.author = "Unverified Author";
    const result = await store.createDraft("draft-review-0002", draft);
    expect(result.artifact.status).toBe("needs_revision");
    expect(result.artifact.quality_review.publication_authorized).toBe(false);
    expect(await store.listPendingReviews()).toHaveLength(0);
  });
  it("is idempotent and rejects artifact ID collisions", async () => {
    const draft = validDraft();
    expect((await store.createDraft("draft-review-0003", draft)).accepted).toBe(true);
    expect((await store.createDraft("draft-review-0003", draft)).duplicate).toBe(true);
    expect(await store.createDraft("draft-review-0003", { ...draft, title: "Different title" }))
      .toEqual({ accepted: false, reason: "artifact_id_conflict" });
  });
  it("uses optimistic version checks for revisions", async () => {
    await store.createDraft("draft-review-0004", validDraft());
    const revised = validDraft(); revised.title = "Xây dựng hệ thống AI agent an toàn và hiệu quả hơn";
    const result = await store.reviseDraft("draft-review-0004", 1, revised);
    const stale = await store.reviseDraft("draft-review-0004", 1, validDraft());
    expect(result.artifact.version).toBe(2);
    expect(stale).toMatchObject({ updated: false, reason: "version_conflict", current_version: 2 });
  });
  it("rejects unknown fields, malformed sources, and oversized artifacts", async () => {
    expect(await store.createDraft("draft-review-0005", { ...validDraft(), publish: true }))
      .toEqual({ accepted: false, reason: "draft_schema_mismatch" });
    const malformed = validDraft(); malformed.sources[0] = { title: "bad" };
    expect(await store.createDraft("draft-review-0006", malformed))
      .toEqual({ accepted: false, reason: "invalid_source_shape" });
    const oversized = validDraft(); oversized.body_markdown = "x".repeat(50 * 1024);
    expect(await store.createDraft("draft-review-0007", oversized))
      .toEqual({ accepted: false, reason: "invalid_body_markdown" });
  });
  it("returns bounded queue metadata and retrieves full content by ID", async () => {
    const draft = validDraft(); await store.createDraft("draft-review-0008", draft);
    const [item] = await store.listPendingReviews(1000);
    expect(item.id).toBe("draft-review-0008");
    expect(item).not.toHaveProperty("body_markdown");
    expect((await store.getDraft(item.id)).draft.body_markdown).toBe(draft.body_markdown);
    expect(await store.getDraft("missing-draft-01")).toBeNull();
  });
});
