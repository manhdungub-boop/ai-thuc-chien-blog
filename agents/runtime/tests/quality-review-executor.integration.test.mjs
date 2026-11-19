import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { executeArticleQualityReview } from "../src/quality-review-executor.mjs";

describe("article quality-review executor with Durable Object storage", () => {
  let draftStore;
  let index = 0;
  beforeEach(() => {
    index += 1;
    draftStore = env.AGENT_DRAFT_STORE.getByName("quality-review-executor-test-" + index);
  });

  it("persists a deterministic review result for a stored scaffold without authorizing publication", async () => {
    const draft = {
      title: "Đề cương nghiên cứu AI Agent",
      slug: "de-cuong-nghien-cuu-ai-agent",
      meta_description: "Đề cương biên tập nội bộ cần tác giả hoàn thiện, kiểm chứng nguồn và rà soát trước khi công bố.",
      author: "DUNG - AI",
      language: "vi",
      body_markdown: "## Mục tiêu\n[ Tác giả bổ sung nội dung ]",
      sources: [
        { title: "Source one", publisher: "OpenAI", url: "https://openai.com/index/example", accessed_at: "2026-11-20T00:00:00.000Z" },
        { title: "Source two", publisher: "DeepMind", url: "https://deepmind.google/blog/example", accessed_at: "2026-11-20T00:00:00.000Z" },
        { title: "Source three", publisher: "Hugging Face", url: "https://huggingface.co/blog/example", accessed_at: "2026-11-20T00:00:00.000Z" }
      ],
      copyright_notice: "© DUNG - AI. Bản nháp nội bộ."
    };
    const created = await draftStore.createDraft("quality-review-article-01", draft);
    expect(created.accepted).toBe(true);
    expect(created.artifact.status).toBe("needs_revision");

    const result = await executeArticleQualityReview({
      draftStore,
      artifactId: created.artifact.id,
      artifactType: "article"
    });
    expect(result).toMatchObject({
      ok: true,
      status: "needs_revision",
      artifact_id: created.artifact.id,
      artifact_version: 1,
      artifact_status: "needs_revision",
      human_review_required: true,
      publication_authorized: false,
      external_calls: 0
    });
    const persisted = await draftStore.getDraft(created.artifact.id);
    expect(persisted.quality_review).toEqual(result.quality_review);
    expect(persisted.status).toBe("needs_revision");
  });
});
