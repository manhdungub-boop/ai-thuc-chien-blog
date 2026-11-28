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

  it("limits authorization starts per client and resets each client's window independently", async () => {
    const clientA = "a".repeat(43);
    const clientB = "b".repeat(43);
    for (let index = 0; index < 10; index += 1) {
      expect(await store.consumeStartRateLimit(clientA, 1000 + index)).toMatchObject({ allowed: true });
    }
    expect(await store.consumeStartRateLimit(clientA, 1009)).toMatchObject({ allowed: false, retry_after_seconds: 51 });
    expect(await store.consumeStartRateLimit(clientB, 1009)).toMatchObject({ allowed: true, remaining: 9 });
    expect(await store.consumeStartRateLimit(clientA, 1060)).toMatchObject({ allowed: true, remaining: 9 });
  });

  it("fails closed for malformed client rate-limit keys", async () => {
    expect(await store.consumeStartRateLimit("spoofed-client", 1000)).toMatchObject({
      allowed: false,
      reason: "client_rate_limit_key_invalid"
    });
  });

  it("stores OAuth transactions once and consumes them exactly once", async () => {
    const values = ["s".repeat(43), "b".repeat(43), "n".repeat(43), "v".repeat(64)];
    expect(await store.createTransaction(...values, 2000, "/reviewer-console")).toEqual({ created: true });
    expect(await store.createTransaction(...values, 2000, "/reviewer-console")).toEqual({ created: false });
    expect(await store.consumeTransaction(values[0], values[1], 2001)).toMatchObject({
      nonce: values[2], code_verifier: values[3], created_at: 2000, expires_at: 2300, return_path: "/reviewer-console"
    });
    expect(await store.consumeTransaction(values[0], values[1], 2001)).toBeNull();
  });

  it("accepts only the two console return paths and keeps direct sign-in on the fixed root", async () => {
    const values = ["r".repeat(43), "c".repeat(43), "o".repeat(43), "p".repeat(64)];
    expect(await store.createTransaction(...values, 2500, "/operator-console")).toEqual({ created: true });
    expect(await store.consumeTransaction(values[0], values[1], 2501)).toMatchObject({ return_path: "/operator-console" });
    const invalid = ["i".repeat(43), "d".repeat(43), "n".repeat(43), "v".repeat(64)];
    expect(await store.createTransaction(...invalid, 2600, "https://attacker.example")).toMatchObject({ created: false });
    const direct = ["x".repeat(43), "y".repeat(43), "z".repeat(43), "w".repeat(64)];
    expect(await store.createTransaction(...direct, 2700)).toEqual({ created: true });
    expect(await store.consumeTransaction(direct[0], direct[1], 2701)).toMatchObject({ return_path: "/" });
  });

  it("rejects expired or mismatched browser transactions", async () => {
    const values = ["s".repeat(43), "b".repeat(43), "n".repeat(43), "v".repeat(64)];
    expect(await store.createTransaction(...values, 3000)).toEqual({ created: true });
    expect(await store.consumeTransaction(values[0], "x".repeat(43), 3001)).toBeNull();
    expect(await store.consumeTransaction(values[0], values[1], 3300)).toBeNull();
  });
});
