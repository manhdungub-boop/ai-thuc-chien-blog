import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "./test-compat.mjs";
import { createLegacyStoresRuntime } from "./legacy-stores-test-harness.mjs";

describe("AgentReviewerAuthStore Durable Object", () => {
  let runtime;
  let store;
  let testIndex = 0;
  beforeEach(async () => {
    testIndex += 1;
    runtime = await createLegacyStoresRuntime();
    store = runtime.auth.get(runtime.auth.idFromName("reviewer-auth-test-" + testIndex));
  });
  afterEach(async () => {
    await runtime?.mf.dispose();
  });

  it("limits authorization starts to ten attempts per minute and resets the window", async () => {
    for (let index = 0; index < 10; index += 1) {
      expect(await store.consumeStartRateLimit(1000 + index)).toMatchObject({ allowed: true });
    }
    expect(await store.consumeStartRateLimit(1009)).toMatchObject({ allowed: false, retry_after_seconds: 51 });
    expect(await store.consumeStartRateLimit(1060)).toMatchObject({ allowed: true, remaining: 9 });
  });

  it("stores OAuth transactions once and consumes them exactly once", async () => {
    const values = ["s".repeat(43), "b".repeat(43), "n".repeat(43), "v".repeat(64)];
    expect(await store.createTransaction(...values, 2000)).toEqual({ created: true });
    expect(await store.createTransaction(...values, 2000)).toEqual({ created: false });
    expect(await store.consumeTransaction(values[0], values[1], 2001)).toMatchObject({
      nonce: values[2], code_verifier: values[3], created_at: 2000, expires_at: 2300
    });
    expect(await store.consumeTransaction(values[0], values[1], 2001)).toBeNull();
  });

  it("rejects expired or mismatched browser transactions", async () => {
    const values = ["s".repeat(43), "b".repeat(43), "n".repeat(43), "v".repeat(64)];
    expect(await store.createTransaction(...values, 3000)).toEqual({ created: true });
    expect(await store.consumeTransaction(values[0], "x".repeat(43), 3001)).toBeNull();
    expect(await store.consumeTransaction(values[0], values[1], 3300)).toBeNull();
  });
});
