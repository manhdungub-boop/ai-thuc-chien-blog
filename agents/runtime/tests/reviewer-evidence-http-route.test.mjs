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
    let storeAccesses = 0;
    const env = { AGENT_AI_BANK_CANDIDATE_STORE: { getByName() { storeAccesses += 1; } } };
    for (const path of [collection, detail]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const response = await worker.fetch(new Request(path, { method }), env);
        expect(response.status, method + " " + path).toBe(405);
        expect(await response.json(), method + " " + path).toMatchObject({ error: "method_not_allowed" });
      }
    }
    expect(storeAccesses).toBe(0);
  });

  it("requires a same-origin JSON request and reviewer cookie before accessing the evidence store", async () => {
    let storeAccesses = 0;
    const env = { AGENT_AI_BANK_CANDIDATE_STORE: { getByName() { storeAccesses += 1; } } };
    const evidencePath = origin + "/api/reviewer/ai-bank/candidates/ollama/ollama/evidence";
    const body = JSON.stringify({
      audit_event_id: "a4e6d1c2-3b7f-4a91-8c22-1234567890ab",
      evidence: {
        check_type: "pricing_and_free_limits",
        source_title: "Pricing",
        source_url: "https://ollama.com/pricing",
        excerpt: "Pending human review."
      }
    });
    const noCookie = await worker.fetch(new Request(evidencePath, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body
    }), env);
    const crossOrigin = await worker.fetch(new Request(evidencePath, {
      method: "POST",
      headers: { origin: "https://attacker.example", "content-type": "application/json", cookie: "__Host-ai_reviewer_session=forged" },
      body
    }), env);
    expect(noCookie.status).toBe(401);
    expect(await noCookie.json()).toMatchObject({ error: "reviewer_session_required" });
    expect(crossOrigin.status).toBe(403);
    expect(storeAccesses).toBe(0);
  });

  it("passes only the signed session and serializable auth configuration to the Durable Object", async () => {
    const token = "opaque-signed-reviewer-session";
    const evidence = {
      check_type: "pricing_and_free_limits",
      source_title: "Official pricing",
      source_url: "https://ollama.com/pricing",
      excerpt: "Pricing requires human review."
    };
    const eventId = "b4e6d1c2-3b7f-4a91-8c22-1234567890ab";
    let received;
    const auth = reviewerAuthEnv("reviewer-session-secret-for-tests-32chars");
    auth.GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS = "reviewer@example.com";
    const env = {
      ...auth,
      GOOGLE_REVIEWER_CLIENT_SECRET: "reviewer-client-secret-for-test-32-characters",
      GOOGLE_REVIEWER_STATE_SECRET: "reviewer-state-secret-for-tests-32-characters",
      AGENT_AI_BANK_CANDIDATE_STORE: {
        getByName(name) {
          expect(name).toBe("primary");
          return {
            async submitAuthorizedReviewEvidence(...args) {
              received = args;
              return {
                accepted: true,
                evidence_id: "evidence-123",
                source_status: "submitted_source_not_verified",
                review_status: "pending_human_review",
                audit_event_id: eventId,
                replay_protected: true
              };
            }
          };
        }
      }
    };
    const evidencePath = origin + "/api/reviewer/ai-bank/candidates/ollama/ollama/evidence";
    const response = await worker.fetch(new Request(evidencePath, {
      method: "POST",
      headers: { origin, "content-type": "application/json", cookie: "__Host-ai_reviewer_session=" + token },
      body: JSON.stringify({ audit_event_id: eventId, evidence })
    }), env);
    expect(response.status).toBe(201);
    expect(received).toHaveLength(5);
    expect(received.slice(0, 4)).toEqual(["github:ollama/ollama", evidence, token, eventId]);
    expect(received[4]).toMatchObject({
      AGENT_REVIEWER_AUTH_ENABLED: "true",
      GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS: "reviewer@example.com"
    });
    expect(received[4].AGENT_AI_BANK_CANDIDATE_STORE).toBeUndefined();
    expect(await response.json()).toEqual({
      accepted: true,
      evidence: {
        evidence_id: "evidence-123",
        source_status: "submitted_source_not_verified",
        review_status: "pending_human_review"
      },
      audit_event_id: eventId,
      replay_protected: true,
      verification_authorized: false,
      catalog_write_authorized: false,
      public_publication_authorized: false
    });
  });

  it("maps duplicate audit event submissions to conflict and rejects malformed evidence payloads", async () => {
    let storeAccesses = 0;
    const auth = reviewerAuthEnv("reviewer-session-secret-for-tests-32chars");
    const env = {
      ...auth,
      GOOGLE_REVIEWER_CLIENT_SECRET: "reviewer-client-secret-for-test-32-characters",
      GOOGLE_REVIEWER_STATE_SECRET: "reviewer-state-secret-for-tests-32-characters",
      GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS: "reviewer@example.com",
      AGENT_AI_BANK_CANDIDATE_STORE: {
        getByName: () => {
          storeAccesses += 1;
          return { async submitAuthorizedReviewEvidence() {
            return { accepted: false, reason: "duplicate_audit_event" };
          } };
        }
      }
    };
    const evidencePath = origin + "/api/reviewer/ai-bank/candidates/ollama/ollama/evidence";
    const token = "__Host-ai_reviewer_session=opaque-session";
    const malformed = await worker.fetch(new Request(evidencePath, {
      method: "POST",
      headers: { origin, "content-type": "application/json", cookie: token },
      body: JSON.stringify({ audit_event_id: "a4e6d1c2-3b7f-4a91-8c22-1234567890ab", evidence: {}, extra: true })
    }), env);
    expect(malformed.status).toBe(400);
    expect(storeAccesses).toBe(0);
    const duplicate = await worker.fetch(new Request(evidencePath, {
      method: "POST",
      headers: { origin, "content-type": "application/json", cookie: token },
      body: JSON.stringify({
        audit_event_id: "a4e6d1c2-3b7f-4a91-8c22-1234567890ab",
        evidence: {
          check_type: "pricing_and_free_limits",
          source_title: "Pricing",
          source_url: "https://ollama.com/pricing",
          excerpt: "Pending review."
        }
      })
    }), env);
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: "duplicate_audit_event", evidence_recorded: false });
    expect(storeAccesses).toBe(1);
  });

  it("maps exhausted lifetime audit capacity to HTTP 503", async () => {
    const auth = reviewerAuthEnv("reviewer-session-secret-for-tests-32chars");
    const env = {
      ...auth,
      GOOGLE_REVIEWER_CLIENT_SECRET: "reviewer-client-secret-for-test-32-characters",
      GOOGLE_REVIEWER_STATE_SECRET: "reviewer-state-secret-for-tests-32-characters",
      GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS: "reviewer@example.com",
      AGENT_AI_BANK_CANDIDATE_STORE: {
        getByName: () => ({
          async submitAuthorizedReviewEvidence() {
            return { accepted: false, reason: "evidence_audit_capacity_reached" };
          }
        })
      }
    };
    const evidencePath = origin + "/api/reviewer/ai-bank/candidates/ollama/ollama/evidence";
    const response = await worker.fetch(new Request(evidencePath, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: "__Host-ai_reviewer_session=opaque-session"
      },
      body: JSON.stringify({
        audit_event_id: "e4e6d1c2-3b7f-4a91-8c22-1234567890ab",
        evidence: {
          check_type: "pricing_and_free_limits",
          source_title: "Pricing",
          source_url: "https://ollama.com/pricing",
          excerpt: "Pending review."
        }
      })
    }), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "evidence_audit_capacity_reached",
      evidence_recorded: false
    });
  });

  it("maps the exhausted evidence audit budget to HTTP 429", async () => {
    const auth = reviewerAuthEnv("reviewer-session-secret-for-tests-32chars");
    const env = {
      ...auth,
      GOOGLE_REVIEWER_CLIENT_SECRET: "reviewer-client-secret-for-test-32-characters",
      GOOGLE_REVIEWER_STATE_SECRET: "reviewer-state-secret-for-tests-32-characters",
      GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS: "reviewer@example.com",
      AGENT_AI_BANK_CANDIDATE_STORE: {
        getByName: () => ({
          async submitAuthorizedReviewEvidence() {
            return { accepted: false, reason: "evidence_audit_daily_limit_reached" };
          }
        })
      }
    };
    const evidencePath = origin + "/api/reviewer/ai-bank/candidates/ollama/ollama/evidence";
    const response = await worker.fetch(new Request(evidencePath, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: "__Host-ai_reviewer_session=opaque-session"
      },
      body: JSON.stringify({
        audit_event_id: "d4e6d1c2-3b7f-4a91-8c22-1234567890ab",
        evidence: {
          check_type: "pricing_and_free_limits",
          source_title: "Pricing",
          source_url: "https://ollama.com/pricing",
          excerpt: "Pending review."
        }
      })
    }), env);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "evidence_audit_daily_limit_reached",
      evidence_recorded: false
    });
  });
});


async function makeReviewerSessionToken(now = Date.now()) {
  const b64url = bytes => {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/=/g, "").replaceAll("+", "-").replaceAll("/", "_");
  };
  const secret = "reviewer-session-secret-for-tests-32chars";
  const nowSeconds = Math.floor(now / 1000);
  const payload = {
    provider: "google",
    sub: "reviewer-subject-123",
    email: "reviewer@example.com",
    reviewer_ref: "google:reviewer-subject-123",
    iat: nowSeconds,
    exp: nowSeconds + 900
  };
  const encoded = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded)));
  return { token: encoded + "." + b64url(signature), secret };
}

function reviewerAuthEnv(sessionSecret) {
  return {
    AGENT_REVIEWER_AUTH_ENABLED: "true",
    GOOGLE_REVIEWER_CLIENT_ID: "reviewer-client-id-for-test-32-characters",
    GOOGLE_REVIEWER_CLIENT_SECRET: "reviewer-client-secret-for-test-32-characters",
    GOOGLE_REVIEWER_REDIRECT_URI: "https://ai-thuc-chien-agent-runtime-preview.test-account.workers.dev/auth/google/callback",
    GOOGLE_REVIEWER_STATE_SECRET: "reviewer-state-secret-for-tests-32-characters",
    GOOGLE_REVIEWER_SESSION_SECRET: sessionSecret,
    GOOGLE_REVIEWER_ALLOWED_EMAILS: "reviewer@example.com"
  };
}


describe("authorized AI Bank reviewer reads", () => {
  it("returns bounded candidate metadata only after verifying an allowlisted reviewer session", async () => {
    const { token, secret } = await makeReviewerSessionToken();
    const item = { candidate: { candidate_id: "github:ollama/ollama" }, first_seen_at: "2026-11-19T00:00:00.000Z", last_seen_at: "2026-11-19T00:00:00.000Z", stored_release_at: 1795046400000 };
    let requestedLimit;
    const env = {
      ...reviewerAuthEnv(secret),
      AGENT_AI_BANK_CANDIDATE_STORE: {
        getByName(name) {
          expect(name).toBe("primary");
          return {
            async listCandidates(limit) {
              requestedLimit = limit;
              return [item];
            }
          };
        }
      }
    };
    const response = await worker.fetch(new Request(origin + "/api/reviewer/ai-bank/candidates?limit=7", {
      headers: { cookie: "__Host-ai_reviewer_session=" + token }
    }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(requestedLimit).toBe(7);
    expect(await response.json()).toEqual({
      items: [item],
      count: 1,
      reviewer_ref: "google:reviewer-subject-123",
      catalog_write_authorized: false,
      public_publication_authorized: false
    });
  });

  it("returns only the exact owner/repository review packet and keeps verification disabled", async () => {
    const { token, secret } = await makeReviewerSessionToken();
    let requestedCandidate;
    const packet = { candidate: { candidate_id: "github:ollama/ollama" }, evidence: [{ verified: false }] };
    const env = {
      ...reviewerAuthEnv(secret),
      AGENT_AI_BANK_CANDIDATE_STORE: {
        getByName: () => ({
          async getReviewPacket(candidateId) {
            requestedCandidate = candidateId;
            return packet;
          }
        })
      }
    };
    const response = await worker.fetch(new Request(origin + "/api/reviewer/ai-bank/candidates/ollama/ollama", {
      headers: { cookie: "__Host-ai_reviewer_session=" + token }
    }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(requestedCandidate).toBe("github:ollama/ollama");
    expect(await response.json()).toEqual({
      packet,
      reviewer_ref: "google:reviewer-subject-123",
      verification_authorized: false,
      catalog_write_authorized: false,
      public_publication_authorized: false
    });
  });

  it("rejects expired, tampered, and non-allowlisted sessions before candidate-store access", async () => {
    const expired = await makeReviewerSessionToken(Date.now() - 60 * 60 * 1000);
    const valid = await makeReviewerSessionToken();
    let storeAccesses = 0;
    const env = {
      ...reviewerAuthEnv(valid.secret),
      AGENT_AI_BANK_CANDIDATE_STORE: {
        getByName: () => {
          storeAccesses += 1;
          return { async listCandidates() { return []; } };
        }
      }
    };
    const expiredResponse = await worker.fetch(new Request(origin + "/api/reviewer/ai-bank/candidates?limit=10", {
      headers: { cookie: "__Host-ai_reviewer_session=" + expired.token }
    }), env);
    const [payloadPart, signaturePart] = valid.token.split(".");
    const tamperedToken = payloadPart + "." + (signaturePart[0] === "A" ? "B" : "A") + signaturePart.slice(1);
    const tamperedResponse = await worker.fetch(new Request(origin + "/api/reviewer/ai-bank/candidates?limit=10", {
      headers: { cookie: "__Host-ai_reviewer_session=" + tamperedToken }
    }), env);
    const wrongAllowlistResponse = await worker.fetch(new Request(origin + "/api/reviewer/ai-bank/candidates?limit=10", {
      headers: { cookie: "__Host-ai_reviewer_session=" + valid.token }
    }), { ...env, GOOGLE_REVIEWER_ALLOWED_EMAILS: "another-reviewer@example.com" });
    expect(expiredResponse.status).toBe(401);
    expect(tamperedResponse.status).toBe(401);
    expect(wrongAllowlistResponse.status).toBe(401);
    expect(storeAccesses).toBe(0);
  });

  it("rejects invalid list limits before reading candidate data", async () => {
    const { token, secret } = await makeReviewerSessionToken();
    let storeAccessed = false;
    const env = {
      ...reviewerAuthEnv(secret),
      AGENT_AI_BANK_CANDIDATE_STORE: {
        getByName: () => {
          storeAccessed = true;
          return { async listCandidates() { return []; } };
        }
      }
    };
    const response = await worker.fetch(new Request(origin + "/api/reviewer/ai-bank/candidates?limit=21", {
      headers: { cookie: "__Host-ai_reviewer_session=" + token }
    }), env);
    expect(response.status).toBe(400);
    expect(storeAccessed).toBe(false);
  });

  it("rejects zero, malformed, non-canonical, and repeated list limits before candidate-store access", async () => {
    const { token, secret } = await makeReviewerSessionToken();
    const invalidQueries = ["limit=0", "limit=01", "limit=abc", "limit=1&limit=2"];
    for (const query of invalidQueries) {
      let storeAccessed = false;
      const env = {
        ...reviewerAuthEnv(secret),
        AGENT_AI_BANK_CANDIDATE_STORE: {
          getByName: () => {
            storeAccessed = true;
            return { async listCandidates() { return []; } };
          }
        }
      };
      const response = await worker.fetch(new Request(origin + "/api/reviewer/ai-bank/candidates?" + query, {
        headers: { cookie: "__Host-ai_reviewer_session=" + token }
      }), env);
      expect(response.status, query).toBe(400);
      expect(storeAccessed, query).toBe(false);
    }
  });

  it("returns not-found for an unknown candidate without granting any write or publication capability", async () => {
    const { token, secret } = await makeReviewerSessionToken();
    const env = {
      ...reviewerAuthEnv(secret),
      AGENT_AI_BANK_CANDIDATE_STORE: {
        getByName: () => ({ async getReviewPacket(candidateId) {
          expect(candidateId).toBe("github:unknown/unknown");
          return null;
        } })
      }
    };
    const response = await worker.fetch(new Request(origin + "/api/reviewer/ai-bank/candidates/unknown/unknown", {
      headers: { cookie: "__Host-ai_reviewer_session=" + token }
    }), env);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "ai_bank_candidate_not_found" });
  });
});


  it("rejects duplicate, non-canonical, and out-of-range limits before candidate-store access", async () => {
    const { token, secret } = await makeReviewerSessionToken();
    let storeAccesses = 0;
    const env = {
      ...reviewerAuthEnv(secret),
      AGENT_AI_BANK_CANDIDATE_STORE: {
        getByName: () => {
          storeAccesses += 1;
          return { async listCandidates() { return []; } };
        }
      }
    };
    for (const query of [
      "limit=1&limit=2",
      "limit=0",
      "limit=01",
      "limit=21",
      "limit=1.5",
      "limit=1e1",
      "limit=+1"
    ]) {
      const response = await worker.fetch(new Request(
        origin + "/api/reviewer/ai-bank/candidates?" + query,
        { headers: { cookie: "__Host-ai_reviewer_session=" + token } }
      ), env);
      expect(response.status, query).toBe(400);
      expect(await response.json(), query).toMatchObject({ error: "invalid_ai_bank_candidate_limit" });
    }
    expect(storeAccesses).toBe(0);
  });
