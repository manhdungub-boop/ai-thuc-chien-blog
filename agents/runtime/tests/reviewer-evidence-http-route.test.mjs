import { describe, expect, it } from "vitest";
import worker from "../src/index.mjs";

const origin = "https://ai-thuc-chien-agent-runtime-preview.test-account.workers.dev";
const path = origin + "/api/reviewer/drafts/draft-review-12345678/evidence-review";
const body = JSON.stringify({
  expected_version: 1,
  ledger: { status: "test-ledger" },
  review_record: { status: "test-review" }
});

describe("authenticated reviewer evidence HTTP route", () => {
  it("rejects a review write without a session cookie", async () => {
    const response = await worker.fetch(new Request(path, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body
    }), {});
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "reviewer_session_required" });
  });

  it("rejects cross-origin requests before accessing the draft store", async () => {
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

  it("requires the exact JSON media type", async () => {
    const response = await worker.fetch(new Request(path, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/jsonp",
        cookie: "__Host-ai_reviewer_session=forged"
      },
      body
    }), {});
    expect(response.status).toBe(403);
  });

  it("passes the opaque session cookie to the Durable Object for independent verification", async () => {
    const sessionToken = "signed-session-token-placeholder";
    let received;
    const env = {
      AGENT_DRAFT_STORE: {
        getByName(name) {
          expect(name).toBe("primary");
          return {
            async recordEvidenceReview(...args) {
              received = args;
              return { recorded: false, reason: "reviewer_session_invalid" };
            }
          };
        }
      }
    };
    const response = await worker.fetch(new Request(path, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json; charset=utf-8",
        cookie: "__Host-ai_reviewer_session=" + sessionToken
      },
      body
    }), env);
    expect(response.status).toBe(400);
    expect(received).toHaveLength(5);
    expect(received[0]).toBe("draft-review-12345678");
    expect(received[4]).toBe(sessionToken);
    expect(await response.json()).toMatchObject({ error: "reviewer_session_invalid" });
  });

  it("never reports publication authorization even when the review store returns success", async () => {
    const env = {
      AGENT_DRAFT_STORE: {
        getByName() {
          return {
            async recordEvidenceReview() {
              return {
                recorded: true,
                owner_release_review_eligible: true,
                readiness: { status: "eligible_for_owner_release_review", publication_authorized: false }
              };
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
        cookie: "__Host-ai_reviewer_session=opaque-signed-session"
      },
      body
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      recorded: true,
      owner_release_review_eligible: true,
      publication_authorized: false,
      content_published: false,
      social_post_published: false
    });
  });
});

describe("authenticated reviewer draft read routes", () => {
  const collection = origin + "/api/reviewer/drafts?limit=5";
  const detail = origin + "/api/reviewer/drafts/draft-review-12345678";
  it("rejects queue reads without a session before accessing the store", async () => {
    const response = await worker.fetch(new Request(collection), {});
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "reviewer_session_required" });
  });

  it("rejects cross-origin queue reads even when a session cookie is present", async () => {
    const response = await worker.fetch(new Request(collection, {
      headers: { origin: "https://attacker.example", cookie: "__Host-ai_reviewer_session=forged" }
    }), {});
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "review_request_origin_or_content_type_rejected" });
  });

  it("passes the opaque session token to the Durable Object for independent queue authorization", async () => {
    let received;
    const token = "opaque-signed-reviewer-session";
    const env = { AGENT_DRAFT_STORE: { getByName: () => ({
      async listPendingReviewsForReviewer(...args) {
        received = args;
        return { authorized: false, reason: "reviewer_session_invalid" };
      }
    }) } };
    const response = await worker.fetch(new Request(collection, {
      headers: { cookie: "__Host-ai_reviewer_session=" + token }
    }), env);
    expect(received).toEqual([5, token]);
    expect(response.status).toBe(401);
  });

  it("returns only queue metadata after the Durable Object authorizes the session", async () => {
    const item = { id: "draft-review-12345678", status: "pending_human_review", version: 1, title: "Article", slug: "article", issue_count: 0, word_count: 700 };
    const env = { AGENT_DRAFT_STORE: { getByName: () => ({
      async listPendingReviewsForReviewer(limit, token) {
        expect(limit).toBe(5);
        expect(token).toBe("valid-session");
        return { authorized: true, items: [item] };
      }
    }) } };
    const response = await worker.fetch(new Request(collection, {
      headers: { cookie: "__Host-ai_reviewer_session=valid-session" }
    }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [item], count: 1, publication_authorized: false });
  });

  it("requires independent authorization before returning full draft details", async () => {
    let received;
    const token = "valid-session";
    const artifact = { id: "draft-review-12345678", version: 1, draft: { body_markdown: "private draft" } };
    const env = { AGENT_DRAFT_STORE: { getByName: () => ({
      async getDraftForReviewer(...args) {
        received = args;
        return { authorized: true, artifact };
      }
    }) } };
    const response = await worker.fetch(new Request(detail, {
      headers: { cookie: "__Host-ai_reviewer_session=" + token }
    }), env);
    expect(received).toEqual(["draft-review-12345678", token]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ artifact, publication_authorized: false });
  });

  it("rejects malformed queue limits and unsupported methods", async () => {
    const invalid = await worker.fetch(new Request(origin + "/api/reviewer/drafts?limit=21", {
      headers: { cookie: "__Host-ai_reviewer_session=token" }
    }), { AGENT_DRAFT_STORE: { getByName: () => ({}) } });
    const post = await worker.fetch(new Request(origin + "/api/reviewer/drafts", {
      method: "POST", headers: { cookie: "__Host-ai_reviewer_session=token" }
    }), {});
    expect(invalid.status).toBe(400);
    expect(post.status).toBe(405);
  });
});


describe("authenticated read-only AI Bank reviewer routes", () => {
  const collection = origin + "/api/reviewer/ai-bank/candidates?limit=10";
  const detail = origin + "/api/reviewer/ai-bank/candidates/ollama/ollama";

  it("rejects candidate reads without a reviewer session", async () => {
    const response = await worker.fetch(new Request(collection), {});
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "reviewer_session_required" });
  });

  it("rejects cross-origin requests before session verification or store access", async () => {
    const response = await worker.fetch(new Request(collection, {
      headers: { origin: "https://attacker.example", cookie: "__Host-ai_reviewer_session=forged" }
    }), {});
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "review_request_origin_or_content_type_rejected" });
  });

  it("keeps AI Bank reviewer reads unavailable until Google reviewer auth is explicitly configured", async () => {
    const response = await worker.fetch(new Request(collection, {
      headers: { cookie: "__Host-ai_reviewer_session=forged" }
    }), { AGENT_REVIEWER_AUTH_ENABLED: "false" });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "reviewer_auth_not_configured" });
  });

  it("rejects unsupported methods without touching the candidate store", async () => {
    const response = await worker.fetch(new Request(collection, { method: "POST" }), {});
    expect(response.status).toBe(405);
    expect(await response.json()).toMatchObject({ error: "method_not_allowed" });
  });
});
