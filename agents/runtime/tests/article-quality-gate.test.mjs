import { describe, expect, it } from "vitest";
import { reviewArticleDraft } from "../src/article-quality-gate.mjs";

const sources = [
  { title: "Official AI research source one", publisher: "Research Lab One", url: "https://research-one.example/paper", accessed_at: "2026-11-18T00:00:00.000Z" },
  { title: "Official AI research source two", publisher: "Research Lab Two", url: "https://research-two.example/report", accessed_at: "2026-11-18T00:00:00.000Z" },
  { title: "Official AI research source three", publisher: "Research Lab Three", url: "https://research-three.example/guide", accessed_at: "2026-11-18T00:00:00.000Z" }
];

function validDraft() {
  const paragraph = "Trí tuệ nhân tạo đang thay đổi cách tổ chức nghiên cứu, phát triển phần mềm và tự động hóa quy trình. Các nhóm triển khai cần xác định mục tiêu, giới hạn dữ liệu, đánh giá kết quả và giám sát rủi ro trước khi đưa hệ thống vào sử dụng. ";
  const body = [
    "## Tổng quan",
    paragraph.repeat(8) + "[1]",
    "## Kiến trúc hệ thống",
    paragraph.repeat(8) + "[2]",
    "## Quy trình triển khai",
    paragraph.repeat(8) + "[3]",
    "## An toàn và quản trị",
    paragraph.repeat(8),
    "## Kết luận",
    paragraph.repeat(4)
  ].join("\n\n");
  return {
    title: "Xây dựng hệ thống AI agent an toàn và hiệu quả",
    slug: "xay-dung-he-thong-ai-agent-an-toan",
    meta_description: "Hướng dẫn xây dựng hệ thống AI agent có kiểm soát, an toàn, minh bạch và hiệu quả cho quy trình tự động hóa trong thực tế triển khai.",
    author: "DUNG - AI",
    language: "vi",
    body_markdown: body,
    sources,
    copyright_notice: "© DUNG - AI. Bản quyền nội dung thuộc về tác giả; các nguồn tham khảo được ghi nhận riêng."
  };
}

describe("deterministic article quality gate", () => {
  it("accepts a structurally complete draft only for human review", () => {
    const result = reviewArticleDraft(validDraft());
    expect(result.ok).toBe(true);
    expect(result.status).toBe("eligible_for_human_review");
    expect(result.metrics.source_count).toBe(3);
    expect(result.metrics.section_count).toBeGreaterThanOrEqual(4);
    expect(result.publication_authorized).toBe(false);
  });

  it("rejects missing attribution, weak metadata, and insufficient sources", () => {
    const draft = validDraft();
    draft.author = "Unknown";
    draft.meta_description = "Too short";
    draft.sources = [];
    const result = reviewArticleDraft(draft);
    const codes = result.issues.map(issue => issue.code);
    expect(codes).toContain("author_attribution");
    expect(codes).toContain("meta_description_length");
    expect(codes).toContain("source_count");
    expect(result.publication_authorized).toBe(false);
  });

  it("rejects non-HTTPS, malformed, and duplicate references", () => {
    const draft = validDraft();
    draft.sources = [
      ...sources.slice(0, 2),
      { ...sources[0], url: "http://research-one.example/paper" },
      { ...sources[1] }
    ];
    const result = reviewArticleDraft(draft);
    const codes = result.issues.map(issue => issue.code);
    expect(codes).toContain("invalid_source");
    expect(codes).toContain("duplicate_source");
  });

  it("rejects unsafe active markup and invalid citation indexes", () => {
    const draft = validDraft();
    draft.body_markdown += "\n\n<script>alert(1)</script> [9]";
    const result = reviewArticleDraft(draft);
    const codes = result.issues.map(issue => issue.code);
    expect(codes).toContain("unsafe_markup");
    expect(codes).toContain("citation_reference_mismatch");
  });


  it("does not count fenced code examples as article words, sections, or citations", () => {
    const draft = validDraft();
    draft.body_markdown = [
      "```markdown",
      "## Fake section one",
      "## Fake section two",
      "## Fake section three",
      "## Fake section four",
      "A long code sample that must not satisfy the article word-count requirement. ".repeat(100),
      "[1] [2] [3]",
      "```"
    ].join("\n");
    const result = reviewArticleDraft(draft);
    const codes = result.issues.map(issue => issue.code);
    expect(result.metrics.word_count).toBe(0);
    expect(result.metrics.section_count).toBe(0);
    expect(codes).toContain("body_word_count");
    expect(codes).toContain("section_count");
    expect(codes).toContain("missing_inline_citations");
    expect(result.publication_authorized).toBe(false);
  });

  it("does not treat script examples inside fenced code as executable article markup", () => {
    const draft = validDraft();
    draft.body_markdown += "\n\n```html\n<script>alert(1)</script>\n```";
    const result = reviewArticleDraft(draft);
    expect(result.issues.map(issue => issue.code)).not.toContain("unsafe_markup");
  });

  it("maps citation indexes to the original source-list positions", () => {
    const draft = validDraft();
    draft.sources[0] = { title: "Unsafe source", publisher: "Unknown", url: "http://unsafe.example", accessed_at: "2026-11-18T00:00:00.000Z" };
    const result = reviewArticleDraft(draft);
    expect(result.issues.map(issue => issue.code)).toContain("citation_reference_mismatch");
  });

  it("fails closed for non-object input", () => {
    const result = reviewArticleDraft(null);
    expect(result.ok).toBe(false);
    expect(result.status).toBe("invalid_draft");
    expect(result.publication_authorized).toBe(false);
  });
});
