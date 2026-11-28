import { describe, it } from "node:test";
import { expect } from "./test-compat.mjs";
import { isValidReviewerDraftAuthoringRequest } from "../src/reviewer-http-routes.mjs";

describe("reviewer draft authoring request", () => {
  it("accepts a versioned draft and rejects client-supplied evidence or extra fields", () => {
    const valid = {
      expected_version: 3,
      draft: { title: "A reviewed draft", claims: [] }
    };

    expect(isValidReviewerDraftAuthoringRequest(valid)).toBe(true);
    expect(isValidReviewerDraftAuthoringRequest({
      ...valid,
      retrieved_evidence: [{
        source: "OpenAI",
        url: "https://openai.com/research",
        status: "source_retrieved_not_fact_checked",
        excerpt: "Client-supplied text must never be treated as a server-retrieved source excerpt."
      }]
    })).toBe(false);
    expect(isValidReviewerDraftAuthoringRequest({ ...valid, untrusted: true })).toBe(false);
    expect(isValidReviewerDraftAuthoringRequest({ ...valid, draft: [] })).toBe(false);
  });
});
