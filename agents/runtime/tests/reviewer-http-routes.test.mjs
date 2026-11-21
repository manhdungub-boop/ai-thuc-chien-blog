import { describe, it } from "node:test";
import { expect } from "./test-compat.mjs";
import { handleReviewerHttpRequest } from "../src/reviewer-http-routes.mjs";

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
    const response = await handleReviewerHttpRequest(new Request(base + "/api/reviewer/drafts?limit=21", {
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
