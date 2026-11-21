import { describe, it } from "node:test";\nimport { expect } from "./test-compat.mjs";
import { buildArticleAuthoringBrief } from "../src/article-authoring-brief.mjs";
const evidence = [
  { source: "OpenAI News", title: "OpenAI research update", url: "https://openai.com/index/research-update", retrieved_at: "2026-11-19T00:00:00.000Z", status: "source_retrieved_not_fact_checked", excerpt: "A retrieved passage containing source context, method descriptions, limitations, and reported research details for later human inspection." },
  { source: "Google DeepMind", title: "DeepMind research report", url: "https://deepmind.google/blog/research-report", retrieved_at: "2026-11-19T00:00:00.000Z", status: "source_retrieved_not_fact_checked", excerpt: "A second retrieved passage describing the research context, stated methodology, limitations, and findings for later human inspection." },
  { source: "Hugging Face", title: "Hugging Face engineering article", url: "https://huggingface.co/blog/engineering-article", retrieved_at: "2026-11-19T00:00:00.000Z", status: "source_retrieved_not_fact_checked", excerpt: "A third retrieved passage outlining platform engineering context, reported implementation details, and limitations for human inspection." }
];
describe("article authoring brief", () => {
  it("creates a Vietnamese scaffold with allowlisted provenance and explicit human placeholders", () => {
    const result = buildArticleAuthoringBrief({ topic: "Ứng dụng AI Agent trong tự động hóa công việc", researchEvidence: evidence, now: Date.parse("2026-11-19T00:00:00.000Z") });
    expect(result).toMatchObject({ prepared: true, status: "human_authoring_required", draft_created: false, claims_generated: false, publication_authorized: false });
    expect(result.draft.sources).toHaveLength(3);
    expect(result.draft.author).toBe("DUNG - AI");
    expect(result.draft.language).toBe("vi");
    expect(result.draft.body_markdown).toContain("[TÁC GIẢ BỔ SUNG:");
    expect(result.draft.body_markdown).not.toContain(evidence[0].excerpt);
    expect(result.quality_review.ok).toBe(false);
    expect(result.quality_review.status).toBe("needs_revision");
    expect(result.quality_review.publication_authorized).toBe(false);
    expect(result.draft.claims).toBeUndefined();
  });
  it("requires three successfully retrieved sources from exact allowlisted publishers", () => {
    expect(buildArticleAuthoringBrief({ topic: "Chủ đề nghiên cứu AI", researchEvidence: evidence.slice(0, 2) })).toMatchObject({ prepared: false, reason: "at_least_three_allowlisted_retrieved_sources_required" });
  });
  it("rejects untrusted host substitutions even when publisher labels look familiar", () => {
    const bad = evidence.map(item => ({ ...item }));
    bad[2].url = "https://huggingface.co.attacker.example/blog/engineering-article";
    expect(buildArticleAuthoringBrief({ topic: "Chủ đề nghiên cứu AI", researchEvidence: bad })).toMatchObject({ prepared: false, reason: "at_least_three_allowlisted_retrieved_sources_required" });
  });
  it("does not treat failed or unverified evidence as sources", () => {
    const bad = evidence.map(item => ({ ...item, status: "retrieval_failed" }));
    expect(buildArticleAuthoringBrief({ topic: "Chủ đề nghiên cứu AI", researchEvidence: bad })).toMatchObject({ prepared: false, reason: "at_least_three_allowlisted_retrieved_sources_required" });
  });
  it("does not create duplicate source entries", () => {
    const result = buildArticleAuthoringBrief({ topic: "Chủ đề nghiên cứu AI", researchEvidence: [...evidence, { ...evidence[0], title: "Duplicate URL" }] });
    expect(result.prepared).toBe(true);
    expect(result.draft.sources).toHaveLength(3);
  });
  it("rejects invalid topic input", () => {
    expect(buildArticleAuthoringBrief({ topic: "AI", researchEvidence: evidence })).toMatchObject({ prepared: false, reason: "invalid_authoring_brief_input" });
  });
});
