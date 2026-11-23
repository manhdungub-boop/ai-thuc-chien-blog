import { describe, it } from "node:test";
import { expect } from "./test-compat.mjs";
import { handleReviewerHttpRequest } from "../src/reviewer-http-routes.mjs";
import { Script } from "node:vm";
import assert from "node:assert/strict";
import { REVIEWER_CONSOLE_JS } from "../src/reviewer-console.mjs";

const base = "https://ai-thuc-chien-agent-runtime-preview.manhdungub.workers.dev";

describe("reviewer and operator HTTP routes", () => {
  it("serves the operator console with no-store and a restrictive CSP", async () => {
    const response = await handleReviewerHttpRequest(new Request(`${base}/operator-console`), {});
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await response.text()).toContain("operator-console.js");
  });

  it("serves the reviewer console and same-origin JavaScript assets", async () => {
    const page = await handleReviewerHttpRequest(new Request(`${base}/reviewer-console`), {});
    const script = await handleReviewerHttpRequest(new Request(`${base}/reviewer-console.js`), {});
    expect(page.status).toBe(200);
    expect((await page.text()).toLowerCase()).toContain("reviewer");
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("application/javascript");
  });

  it("keeps reviewer authentication disabled when Preview credentials are absent", async () => {
    const response = await handleReviewerHttpRequest(new Request(`${base}/auth/google/start`), {});
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("reviewer_auth_not_configured");
  });

  it("keeps operator controls disabled until the separate control gate is enabled", async () => {
    const response = await handleReviewerHttpRequest(new Request(`${base}/api/operator/runtime-control`), {
      AGENT_OPERATOR_CONTROL_ENABLED: "false"
    });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("operator_control_disabled");
  });

  it("rejects cross-origin operator mutations before checking credentials", async () => {
    const response = await handleReviewerHttpRequest(new Request(`${base}/api/operator/runtime-control`, {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pause", reason: "manual emergency pause" })
    }), { AGENT_OPERATOR_CONTROL_ENABLED: "true" });
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("same_origin_required");
  });

  it("rejects cross-origin reviewer authoring mutations", async () => {
    const response = await handleReviewerHttpRequest(new Request(`${base}/api/reviewer/drafts/12345678/authoring`, {
      method: "POST",
      headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
      body: JSON.stringify({ expected_version: 1, draft: {} })
    }), {});
    expect(response.status).toBe(403);
    expect(await response.text()).toContain("same_origin_required");
  });

  it("requires a reviewer session before exposing draft queues", async () => {
    const response = await handleReviewerHttpRequest(new Request(`${base}/api/reviewer/drafts`), {});
    expect(response.status).toBe(401);
    expect(await response.text()).toContain("reviewer_session_required");
  });

  it("leaves unrelated Worker paths for the main Worker handler", async () => {
    expect(await handleReviewerHttpRequest(new Request(`${base}/health`), {})).toBeNull();
    expect(await handleReviewerHttpRequest(new Request(`${base}/run`, { method: "POST" }), {})).toBeNull();
  });
});

const reviewerAuthEnv = {
  AGENT_REVIEWER_AUTH_ENABLED: "true",
  GOOGLE_REVIEWER_CLIENT_ID: "preview-test-client-id-abcdefghijklmnopqrstuvwxyz0123456789.apps.googleusercontent.com",
  GOOGLE_REVIEWER_CLIENT_SECRET: "test-google-client-secret-value-abcdefghijklmnopqrstuvwxyz0123456789",
  GOOGLE_REVIEWER_REDIRECT_URI: base + "/auth/google/callback",
  GOOGLE_REVIEWER_ALLOWED_EMAILS: "reviewer@example.com",
  GOOGLE_REVIEWER_STATE_SECRET: "state-secret-for-tests-only-abcdefghijklmnopqrstuvwxyz0123456789",
  GOOGLE_REVIEWER_SESSION_SECRET: "session-secret-for-tests-only-zyxwvutsrqponmlkjihgfedcba9876543210"
};

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function createReviewerSessionToken() {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    provider: "google",
    sub: "reviewer-test-subject",
    email: "reviewer@example.com",
    reviewer_ref: "google:reviewer-test-subject",
    iat: now,
    exp: now + 1800
  };
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(reviewerAuthEnv.GOOGLE_REVIEWER_SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  return encoded + "." + base64Url(new Uint8Array(signature));
}

function draftStoreNamespace(stub) {
  return {
    idFromName(name) {
      expect(name).toBe("agent-draft-store-primary");
      return "agent-draft-store-id";
    },
    get(id) {
      expect(id).toBe("agent-draft-store-id");
      return stub;
    }
  };
}

describe("authenticated reviewer draft read routes", () => {
  it("passes the signed session to the Durable Object and returns bounded queue metadata only", async () => {
    const token = await createReviewerSessionToken();
    const item = { id: "draft-review-12345678", status: "pending_human_review", version: 1, title: "Article", slug: "article", issue_count: 0, word_count: 700 };
    let received;
    const env = {
      ...reviewerAuthEnv,
      AGENT_DRAFT_STORE: draftStoreNamespace({
        async listPendingReviewsForReviewer(limit, sessionToken) {
          received = [limit, sessionToken];
          return { authorized: true, items: [item] };
        }
      })
    };
    const response = await handleReviewerHttpRequest(new Request(base + "/api/reviewer/drafts?limit=5", {
      headers: { origin: base, cookie: "__Host-ai_reviewer_session=" + token }
    }), env);
    expect(response.status).toBe(200);
    expect(received).toEqual([5, token]);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [item], count: 1, publication_authorized: false });
  });

  it("does not expose queue data when the Durable Object independently rejects the session", async () => {
    const token = await createReviewerSessionToken();
    const env = {
      ...reviewerAuthEnv,
      AGENT_DRAFT_STORE: draftStoreNamespace({
        async listPendingReviewsForReviewer(limit, sessionToken) {
          expect(limit).toBe(20);
          expect(sessionToken).toBe(token);
          return { authorized: false, reason: "reviewer_session_invalid", items: [{ id: "must-not-leak" }] };
        }
      })
    };
    const response = await handleReviewerHttpRequest(new Request(base + "/api/reviewer/drafts", {
      headers: { origin: base, cookie: "__Host-ai_reviewer_session=" + token }
    }), env);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: "reviewer_session_invalid",
      publication_authorized: false
    });
  });

  it("requires independent Durable Object authorization before returning full draft details", async () => {
    const token = await createReviewerSessionToken();
    const artifact = { id: "draft-review-12345678", version: 1, draft: { body_markdown: "private draft" } };
    let received;
    const env = {
      ...reviewerAuthEnv,
      AGENT_DRAFT_STORE: draftStoreNamespace({
        async getDraftForReviewer(...args) {
          received = args;
          return { authorized: true, artifact };
        }
      })
    };
    const response = await handleReviewerHttpRequest(new Request(base + "/api/reviewer/drafts/draft-review-12345678", {
      headers: { origin: base, cookie: "__Host-ai_reviewer_session=" + token }
    }), env);
    expect(received).toEqual(["draft-review-12345678", token]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ artifact, publication_authorized: false });
  });

  it("rejects invalid queue limits before reading the Durable Object", async () => {
    const token = await createReviewerSessionToken();
    let called = false;
    const env = {
      ...reviewerAuthEnv,
      AGENT_DRAFT_STORE: draftStoreNamespace({
        async listPendingReviewsForReviewer() { called = true; return { authorized: true, items: [] }; }
      })
    };
    const response = await handleReviewerHttpRequest(new Request(base + "/api/reviewer/drafts?limit=101", {
      headers: { origin: base, cookie: "__Host-ai_reviewer_session=" + token }
    }), env);
    expect(response.status).toBe(400);
    expect(called).toBe(false);
  });

  it("rejects a client-supplied evidence ledger instead of trusting browser excerpts", async () => {
    const token = await createReviewerSessionToken();
    let called = false;
    const env = {
      ...reviewerAuthEnv,
      AGENT_DRAFT_STORE: draftStoreNamespace({
        async reviseDraftForReviewer() { called = true; return { updated: true }; },
        async storeEvidenceLedger() { called = true; return { stored: true }; }
      })
    };
    const response = await handleReviewerHttpRequest(new Request(base + "/api/reviewer/drafts/draft-review-12345678/authoring", {
      method: "POST",
      headers: { origin: base, "content-type": "application/json", cookie: "__Host-ai_reviewer_session=" + token },
      body: JSON.stringify({
        expected_version: 1,
        draft: { title: "A draft", claims: [] },
        retrieved_evidence: [{ url: "https://openai.com/research", excerpt: "Untrusted browser text" }]
      })
    }), env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "draft_authoring_request_invalid" });
    expect(called).toBe(false);
  });
});


function aiBankStoreNamespace(stub) {
  return {
    idFromName(name) {
      expect(name).toBe("agent-ai-bank-candidates-primary");
      return "agent-ai-bank-candidates-id";
    },
    get(id) {
      expect(id).toBe("agent-ai-bank-candidates-id");
      return stub;
    }
  };
}

function aiBankStoreFetchStub(handler) {
  return {
    async fetch(request) {
      const result = await handler(new URL(request.url));
      return new Response(JSON.stringify(result), {
        status: result.status || 200,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }
  };
}

describe("reviewer console script", () => {
  it("parses as JavaScript and contains the read-only AI Bank queue", () => {
    assert.doesNotThrow(() => new Script(REVIEWER_CONSOLE_JS));
    expect(REVIEWER_CONSOLE_JS).toContain("/api/reviewer/ai-bank/candidates?limit=20");
    expect(REVIEWER_CONSOLE_JS).toContain("Release đang được rà soát:");
    expect(REVIEWER_CONSOLE_JS).toContain("Chỉ đọc; không xác minh, chỉnh sửa hoặc xuất bản.");
  });
});

describe("authenticated read-only AI Bank reviewer routes", () => {
  const collection = base + "/api/reviewer/ai-bank/candidates?limit=10";
  const detail = base + "/api/reviewer/ai-bank/candidates/ollama/ollama";

  it("rejects candidate reads without a reviewer session", async () => {
    const response = await handleReviewerHttpRequest(new Request(collection), {});
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "reviewer_session_required" });
  });

  it("rejects cross-origin requests before session verification or store access", async () => {
    let storeAccesses = 0;
    const response = await handleReviewerHttpRequest(new Request(collection, {
      headers: { origin: "https://attacker.example", cookie: "__Host-ai_reviewer_session=forged" }
    }), {
      AGENT_AI_BANK_CANDIDATE_STORE: { idFromName() { storeAccesses += 1; }, get() { storeAccesses += 1; } }
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "review_request_origin_or_content_type_rejected" });
    expect(storeAccesses).toBe(0);
  });

  it("keeps AI Bank reviewer reads unavailable until reviewer auth is configured", async () => {
    const response = await handleReviewerHttpRequest(new Request(collection, {
      headers: { cookie: "__Host-ai_reviewer_session=forged" }
    }), { AGENT_REVIEWER_AUTH_ENABLED: "false" });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it("rejects unsupported methods without touching the candidate store", async () => {
    let storeAccesses = 0;
    const env = {
      ...reviewerAuthEnv,
      AGENT_AI_BANK_CANDIDATE_STORE: {
        idFromName() { storeAccesses += 1; return "unused"; },
        get() { storeAccesses += 1; return {}; }
      }
    };
    for (const path of [collection, detail]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const response = await handleReviewerHttpRequest(new Request(path, { method }), env);
        expect(response.status, method + " " + path).toBe(405);
        expect(await response.json()).toMatchObject({ error: "method_not_allowed" });
      }
    }
    expect(storeAccesses).toBe(0);
  });

  it("returns bounded candidate summaries with all write and publication permissions false", async () => {
    const token = await createReviewerSessionToken();
    const items = [{ candidate: { candidate_id: "github:ollama/ollama" }, review_status: "pending" }];
    let receivedLimit;
    const env = {
      ...reviewerAuthEnv,
      AGENT_AI_BANK_CANDIDATE_STORE: aiBankStoreNamespace(aiBankStoreFetchStub((url) => {
        expect(url.pathname).toBe("/candidates");
        receivedLimit = Number(url.searchParams.get("limit"));
        return { ok: true, items };
      }))
    };
    const response = await handleReviewerHttpRequest(new Request(collection, {
      headers: { origin: base, cookie: "__Host-ai_reviewer_session=" + token }
    }), env);
    expect(response.status).toBe(200);
    expect(receivedLimit).toBe(10);
    expect(await response.json()).toEqual({
      items,
      count: 1,
      reviewer_ref: "google:reviewer-test-subject",
      catalog_write_authorized: false,
      evidence_verification_authorized: false,
      public_publication_authorized: false
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns a release-scoped review packet with pending evidence explicitly unverified", async () => {
    const token = await createReviewerSessionToken();
    const packet = {
      candidate: { candidate: { candidate_id: "github:ollama/ollama" } },
      evidence: [{ source_status: "submitted_source_not_verified", verified: false, verification_authorized: false }]
    };
    let received;
    const env = {
      ...reviewerAuthEnv,
      AGENT_AI_BANK_CANDIDATE_STORE: aiBankStoreNamespace(aiBankStoreFetchStub((url) => {
        expect(url.pathname).toBe("/candidate");
        received = url.searchParams.get("id");
        return { ok: true, packet };
      }))
    };
    const response = await handleReviewerHttpRequest(new Request(detail, {
      headers: { origin: base, cookie: "__Host-ai_reviewer_session=" + token }
    }), env);
    expect(response.status).toBe(200);
    expect(received).toBe("github:ollama/ollama");
    expect(await response.json()).toEqual({
      packet,
      reviewer_ref: "google:reviewer-test-subject",
      catalog_write_authorized: false,
      evidence_verification_authorized: false,
      public_publication_authorized: false
    });
  });

  it("rejects invalid limits before candidate-store access", async () => {
    const token = await createReviewerSessionToken();
    let storeAccesses = 0;
    const env = {
      ...reviewerAuthEnv,
      AGENT_AI_BANK_CANDIDATE_STORE: {
        idFromName() { storeAccesses += 1; return "unused"; },
        get() { storeAccesses += 1; return {}; }
      }
    };
    const response = await handleReviewerHttpRequest(new Request(base + "/api/reviewer/ai-bank/candidates?limit=21", {
      headers: { origin: base, cookie: "__Host-ai_reviewer_session=" + token }
    }), env);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_ai_bank_candidate_limit" });
    expect(storeAccesses).toBe(0);
  });

  it("requires same-origin authenticated access before touching the evidence writer", async () => {
    const token = await createReviewerSessionToken();
    let calls = 0;
    const stub = { async submitAuthorizedReviewEvidence() { calls += 1; return { accepted: true }; } };
    const env = { ...reviewerAuthEnv, AGENT_AI_BANK_CANDIDATE_STORE: aiBankStoreNamespace(stub) };
    const noSession = await handleReviewerHttpRequest(new Request(base + "/api/reviewer/ai-bank/candidates/ollama/ollama/evidence", { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: "{}" }), env);
    const crossOrigin = await handleReviewerHttpRequest(new Request(base + "/api/reviewer/ai-bank/candidates/ollama/ollama/evidence", { method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/json", cookie: "__Host-ai_reviewer_session=" + token }, body: "{}" }), env);
    expect(noSession.status).toBe(401);
    expect(crossOrigin.status).toBe(403);
    expect(calls).toBe(0);
  });

  it("submits evidence through the independently authorized Durable Object RPC", async () => {
    const token = await createReviewerSessionToken();
    const eventId = "a4e6d1c2-3b7f-4a91-8c22-1234567890ab";
    const reviewedReleaseUrl = "https://github.com/ollama/ollama/releases/tag/v1.2.3";
    const evidence = { check_type: "pricing_and_free_limits", source_title: "Official pricing", source_url: "https://ollama.com/pricing", excerpt: "Pending human review." };
    let received;
    const stub = { async submitAuthorizedReviewEvidence(...args) { received = args; return { accepted: true, evidence_id: "evidence-123", source_status: "submitted_source_not_verified", review_status: "pending_human_review", audit_event_id: eventId, replay_protected: true }; } };
    const env = { ...reviewerAuthEnv, GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS: "reviewer@example.com", AGENT_AI_BANK_CANDIDATE_STORE: aiBankStoreNamespace(stub) };
    const response = await handleReviewerHttpRequest(new Request(base + "/api/reviewer/ai-bank/candidates/ollama/ollama/evidence", { method: "POST", headers: { origin: base, "content-type": "application/json", cookie: "__Host-ai_reviewer_session=" + token }, body: JSON.stringify({ audit_event_id: eventId, reviewed_release_url: reviewedReleaseUrl, evidence }) }), env);
    expect(response.status).toBe(201);
    expect(received[0]).toBe("github:ollama/ollama");
    expect(received[1]).toEqual(evidence);
    expect(received[2]).toBe(token);
    expect(received[3]).toBe(eventId);
    expect(received[4]).toBe(reviewedReleaseUrl);
    expect(received[5].GOOGLE_REVIEWER_EVIDENCE_WRITER_EMAILS).toBe("reviewer@example.com");
    expect(await response.json()).toEqual({ accepted: true, evidence: { evidence_id: "evidence-123", source_status: "submitted_source_not_verified", review_status: "pending_human_review" }, audit_event_id: eventId, replay_protected: true, verification_authorized: false, catalog_write_authorized: false, public_publication_authorized: false });
  });

  it("rejects malformed evidence payloads and maps writer authorization failures", async () => {
    const token = await createReviewerSessionToken();
    let calls = 0;
    const stub = { async submitAuthorizedReviewEvidence() { calls += 1; return { accepted: false, reason: "evidence_writer_not_configured" }; } };
    const env = { ...reviewerAuthEnv, AGENT_AI_BANK_CANDIDATE_STORE: aiBankStoreNamespace(stub) };
    const invalid = await handleReviewerHttpRequest(new Request(base + "/api/reviewer/ai-bank/candidates/ollama/ollama/evidence", { method: "POST", headers: { origin: base, "content-type": "application/json", cookie: "__Host-ai_reviewer_session=" + token }, body: JSON.stringify({ audit_event_id: "bad", evidence: {}, extra: true }) }), env);
    expect(invalid.status).toBe(400);
    expect(calls).toBe(0);
    const denied = await handleReviewerHttpRequest(new Request(base + "/api/reviewer/ai-bank/candidates/ollama/ollama/evidence", { method: "POST", headers: { origin: base, "content-type": "application/json", cookie: "__Host-ai_reviewer_session=" + token }, body: JSON.stringify({ audit_event_id: "a4e6d1c2-3b7f-4a91-8c22-1234567890ab", reviewed_release_url: "https://github.com/ollama/ollama/releases/tag/v1.2.3", evidence: { check_type: "pricing_and_free_limits", source_title: "Pricing", source_url: "https://ollama.com/pricing", excerpt: "Pending review." } }) }), env);
    expect(denied.status).toBe(503);
    expect(await denied.json()).toMatchObject({ error: "evidence_writer_not_configured", evidence_recorded: false });
    expect(calls).toBe(1);
  });
});
