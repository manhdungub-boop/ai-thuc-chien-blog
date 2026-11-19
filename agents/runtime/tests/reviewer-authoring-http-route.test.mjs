import { describe, expect, it } from "vitest";
import worker from "../src/index.mjs";

const origin = "https://ai-thuc-chien-agent-runtime-preview.test-account.workers.dev";
const artifactId = "draft-authoring-12345678";
const path = origin + "/api/reviewer/drafts/" + artifactId + "/authoring";
const draft = {
  title: "Xây dựng AI Agent có kiểm soát và an toàn",
  slug: "xay-dung-ai-agent-co-kiem-soat",
  meta_description: "Hướng dẫn xây dựng AI Agent có kiểm soát, an toàn, minh bạch và có thể kiểm chứng trước khi đưa vào vận hành thực tế.",
  author: "DUNG - AI",
  language: "vi",
  body_markdown: "## Tổng quan\n" + "Nội dung đã được tác giả viết và kiểm chứng. ".repeat(100) +
    "\n## Kiến trúc\nChi tiết.\n## Triển khai\nChi tiết.\n## An toàn\nChi tiết. [1] [2]",
  sources: [
    { title: "A", publisher: "OpenAI", url: "https://openai.com/index/a", accessed_at: "2026-11-20T00:00:00.000Z" },
    { title: "B", publisher: "DeepMind", url: "https://deepmind.google/blog/b", accessed_at: "2026-11-20T00:00:00.000Z" },
    { title: "C", publisher: "Hugging Face", url: "https://huggingface.co/blog/c", accessed_at: "2026-11-20T00:00:00.000Z" }
  ],
  copyright_notice: "© DUNG - AI. Bản quyền và nguồn tham khảo được ghi nhận.",
  claims: [{
    claim_id: "claim-01",
    claim: "The article describes a bounded agent workflow.",
    evidence_urls: ["https://openai.com/index/a", "https://deepmind.google/blog/b"],
    citation_indices: [1, 2]
  }]
};
const body = JSON.stringify({ expected_version: 1, draft });

describe("authenticated reviewer authoring HTTP route", () => {
  it("requires a reviewer session before parsing or accessing the draft store", async () => {
    const response = await worker.fetch(new Request(path, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body
    }), {});
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "reviewer_session_required" });
  });

  it("rejects cross-origin writes before accessing the draft store", async () => {
    const response = await worker.fetch(new Request(path, {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "content-type": "application/json",
        cookie: "__Host-ai_reviewer_session=forged"
      },
      body
    }), {});
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "review_request_origin_or_content_type_rejected" });
  });

  it("requires a non-empty claim manifest", async () => {
    const response = await worker.fetch(new Request(path, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: "__Host-ai_reviewer_session=opaque-session"
      },
      body: JSON.stringify({ expected_version: 1, draft: { ...draft, claims: [] } })
    }), {});
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "authoring_claim_manifest_required" });
  });

  it("revises the exact version, then builds a ledger from stored research evidence", async () => {
    const token = "opaque-signed-google-reviewer-session";
    const revisedArtifact = { id: artifactId, version: 2, status: "pending_human_review", draft };
    const ledgerArtifact = {
      ...revisedArtifact,
      version: 3,
      evidence_review: { ledger: { status: "all_claims_traceable_pending_human_review" } }
    };
    const calls = [];
    const env = {
      AGENT_DRAFT_STORE: {
        getByName(name) {
          expect(name).toBe("primary");
          return {
            async reviseDraftForReviewer(...args) {
              calls.push(["revise", ...args]);
              return { authorized: true, updated: true, artifact: revisedArtifact };
            },
            async storeEvidenceLedger(...args) {
              calls.push(["ledger", ...args]);
              return { stored: true, artifact: ledgerArtifact };
            },
            getDraft(id) {
              expect(id).toBe(artifactId);
              return ledgerArtifact;
            }
          };
        }
      }
    };
    const response = await worker.fetch(new Request(path, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: "__Host-ai_reviewer_session=" + token
      },
      body
    }), env);
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      ["revise", artifactId, 1, draft, token],
      ["ledger", artifactId, 2]
    ]);
    expect(await response.json()).toMatchObject({
      updated: true,
      artifact: ledgerArtifact,
      evidence_ledger: {
        stored: true,
        status: "all_claims_traceable_pending_human_review"
      },
      human_review_required: true,
      publication_authorized: false,
      content_published: false,
      social_post_published: false
    });
  });

  it("does not build a claim ledger when structural quality remains failed", async () => {
    const calls = [];
    const env = {
      AGENT_DRAFT_STORE: {
        getByName: () => ({
          async reviseDraftForReviewer() {
            return {
              authorized: true,
              updated: true,
              artifact: { id: artifactId, version: 2, status: "needs_revision" }
            };
          },
          async storeEvidenceLedger(...args) { calls.push(args); },
          getDraft: () => ({ id: artifactId, version: 2, status: "needs_revision" })
        })
      }
    };
    const response = await worker.fetch(new Request(path, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: "__Host-ai_reviewer_session=opaque-session"
      },
      body
    }), env);
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(0);
    expect(await response.json()).toMatchObject({
      evidence_ledger: { stored: false, status: "quality_gate_not_passed" },
      publication_authorized: false
    });
  });
});
