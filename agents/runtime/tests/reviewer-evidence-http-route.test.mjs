import { describe, expect, it } from "vitest";
import worker from "../src/index.mjs";

const origin = "https://ai-thuc-chien-agent-runtime-preview.test-account.workers.dev";
const path = origin + "/api/reviewer/drafts/draft-review-12345678/evidence-review";
const body = JSON.stringify({
  expected_version: 1,
  decisions: [{ claim_id: "claim-01", decision: "needs_revision", reviewer_note: "The sources require a closer comparison.", evidence_reviews: [] }]
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
            async recordReviewerClaimDecisions(...args) {
              received = args;
              return { authorized: true, recorded: false, reason: "reviewer_session_invalid" };
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
    expect(received).toHaveLength(4);
    expect(received[0]).toBe("draft-review-12345678");
    expect(received[3]).toBe(sessionToken);
    expect(await response.json()).toMatchObject({ error: "reviewer_session_invalid" });
  });

  it("never reports publication authorization even when the review store returns success", async () => {
    const env = {
      AGENT_DRAFT_STORE: {
        getByName() {
          return {
            async recordReviewerClaimDecisions() {
              return {
                authorized: true,
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


  it("does not expose operator-supplied pause reasons through the public health endpoint", async () => {
    const env = {
      AGENT_TASK_STORE: {
        getByName: () => ({
          async getControl() {
            return {
              paused: true,
              changed_at: 1795118400000,
              reason: "private operator incident note",
              failure_count_last_10m: 5,
              circuit_breaker_threshold: 5,
              circuit_breaker_window_ms: 600000
            };
          },
          async getDailyAdmissionUsage() {
            return { day_utc: "2026-11-20", accepted: 3, limit: 100 };
          }
        })
      }
    };
    const response = await worker.fetch(new Request(origin + "/health"), env);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.runtime_control).toEqual({
      paused: true,
      changed_at: 1795118400000,
      failure_count_last_10m: 5,
      circuit_breaker_threshold: 5,
      circuit_breaker_window_ms: 600000
    });
    expect(JSON.stringify(body)).not.toContain("private operator incident note");
  });

describe("authenticated reviewer draft read routes", () => {
  const collection = origin + "/api/reviewer/drafts?limit=5";
  const detail = origin + "/api/reviewer/drafts/draft-review-12345678";
  const authoringCollection = origin + "/api/reviewer/drafts-needing-authoring?limit=5";
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

  it("requires an authenticated reviewer session for the authoring revision queue", async () => {
    const response = await worker.fetch(new Request(authoringCollection), {});
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "reviewer_session_required" });
  });

  it("returns only bounded authoring metadata after independent reviewer authorization", async () => {
    const item = {
      id: "article-brief-scaffold-01",
      status: "needs_revision",
      version: 1,
      title: "Draft outline",
      issue_count: 2,
      word_count: 350
    };
    let received;
    const token = "opaque-signed-reviewer-session";
    const env = { AGENT_DRAFT_STORE: { getByName: () => ({
      async listNeedsRevisionForReviewer(...args) {
        received = args;
        return { authorized: true, items: [item] };
      }
    }) } };
    const response = await worker.fetch(new Request(authoringCollection, {
      headers: { cookie: "__Host-ai_reviewer_session=" + token }
    }), env);
    expect(received).toEqual([5, token]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [item],
      count: 1,
      queue: "authoring_revision_required",
      publication_authorized: false
    });
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
    expect(await response.json()).toEqual({ items: [item], count: 1, queue: "pending_human_review", publication_authorized: false });
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

describe("authenticated operator runtime-control HTTP route", () => {
  const path = origin + "/api/operator/runtime-control";
  const token = "opaque-google-session-token";

  it("requires a Google session before reading operator state", async () => {
    const response = await worker.fetch(new Request(path), {});
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "operator_session_required" });
  });

  it("rejects cross-origin mutations before accessing the Task Store", async () => {
    const response = await worker.fetch(new Request(path, {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "content-type": "application/json",
        cookie: "__Host-ai_reviewer_session=" + token
      },
      body: JSON.stringify({ action: "pause", reason: "Emergency pause after suspicious activity" })
    }), {});
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "operator_request_origin_or_content_type_rejected" });
  });

  it("rejects unsupported actions and extra body fields", async () => {
    const invalidAction = await worker.fetch(new Request(path, {
      method: "POST",
      headers: { origin, "content-type": "application/json", cookie: "__Host-ai_reviewer_session=" + token },
      body: JSON.stringify({ action: "enable", reason: "Attempt to enable runtime" })
    }), {});
    const extraField = await worker.fetch(new Request(path, {
      method: "POST",
      headers: { origin, "content-type": "application/json", cookie: "__Host-ai_reviewer_session=" + token },
      body: JSON.stringify({ action: "pause", reason: "Pause due to suspicious activity", force: true })
    }), {});
    expect(invalidAction.status).toBe(400);
    expect(extraField.status).toBe(400);
  });

  it("passes the opaque session to the Task Store for independent operator authorization", async () => {
    let received;
    const control = { paused: true, reason: "manual emergency stop", failure_count_last_10m: 0 };
    const env = { AGENT_TASK_STORE: { getByName: name => {
      expect(name).toBe("primary");
      return {
        async setOperatorControl(...args) {
          received = args;
          return { authorized: true, changed: true, control };
        }
      };
    } } };
    const response = await worker.fetch(new Request(path, {
      method: "POST",
      headers: { origin, "content-type": "application/json; charset=utf-8", cookie: "__Host-ai_reviewer_session=" + token },
      body: JSON.stringify({ action: "pause", reason: "Pause due to suspicious activity" })
    }), env);
    expect(received).toEqual([true, "Pause due to suspicious activity", token]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ changed: true, control });
  });

  it("returns operator state only after the Task Store authorizes the session", async () => {
    let received;
    const control = { paused: false, reason: null, failure_count_last_10m: 0 };
    const env = { AGENT_TASK_STORE: { getByName: () => ({
      async getOperatorControl(sessionToken) {
        received = sessionToken;
        return { authorized: true, control };
      }
    }) } };
    const response = await worker.fetch(new Request(path, {
      headers: { cookie: "__Host-ai_reviewer_session=" + token }
    }), env);
    expect(received).toBe(token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ control, operator_control_enabled: true });
  });

  it("maps missing operator configuration to a fail-closed service error", async () => {
    const env = { AGENT_TASK_STORE: { getByName: () => ({
      async getOperatorControl() {
        return { authorized: false, reason: "operator_allowlist_not_configured" };
      }
    }) } };
    const response = await worker.fetch(new Request(path, {
      headers: { cookie: "__Host-ai_reviewer_session=" + token }
    }), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "operator_allowlist_not_configured" });
  });
});
