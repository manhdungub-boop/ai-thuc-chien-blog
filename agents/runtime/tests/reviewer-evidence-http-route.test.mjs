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
