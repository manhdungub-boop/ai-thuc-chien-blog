import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";

describe("AgentReviewerAuthStore Durable Object", () => {
  let store;
  let testIndex = 0;

  beforeEach(() => {
    testIndex += 1;
    store = env.AGENT_REVIEWER_AUTH_STORE.getByName("reviewer-auth-store-test-" + Date.now() + "-" + testIndex + "-" + crypto.randomUUID());
  });

  it("limits Google reviewer login starts to ten per rolling minute and resets the window", async () => {
    const nowSeconds = 1_800_000_000;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(store.consumeStartRateLimit(nowSeconds)).resolves.toMatchObject({ allowed: true });
    }
    await expect(store.consumeStartRateLimit(nowSeconds)).resolves.toEqual({
      allowed: false,
      retry_after_seconds: 60
    });
    await expect(store.consumeStartRateLimit(nowSeconds + 59)).resolves.toEqual({
      allowed: false,
      retry_after_seconds: 1
    });
    await expect(store.consumeStartRateLimit(nowSeconds + 60)).resolves.toEqual({
      allowed: true,
      remaining: 9
    });
  });

  it("does not let a mismatched browser binding consume or delete a valid login transaction", async () => {
    const stateHash = "s".repeat(43);
    const browserHash = "b".repeat(43);
    const wrongBrowserHash = "x".repeat(43);
    const nonce = "n".repeat(43);
    const codeVerifier = "v".repeat(64);
    const nowSeconds = 1_800_000_000;

    await runInDurableObject(store, (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO reviewer_auth_transactions (state_hash,browser_hash,nonce,code_verifier,created_at,expires_at) VALUES (?,?,?,?,?,?)",
        stateHash, browserHash, nonce, codeVerifier, nowSeconds, nowSeconds + 300
      );
    });

    expect(await store.consumeTransaction(stateHash, wrongBrowserHash, nowSeconds)).toBeNull();

    const rowsAfterMismatch = await runInDurableObject(store, (_instance, state) =>
      state.storage.sql.exec(
        "SELECT state_hash, browser_hash FROM reviewer_auth_transactions WHERE state_hash = ?",
        stateHash
      ).toArray()
    );
    expect(rowsAfterMismatch).toEqual([{ state_hash: stateHash, browser_hash: browserHash }]);

    await expect(store.consumeTransaction(stateHash, browserHash, nowSeconds)).resolves.toMatchObject({
      nonce,
      code_verifier: codeVerifier
    });
    await expect(store.consumeTransaction(stateHash, browserHash, nowSeconds)).resolves.toBeNull();
  });

  it("does not consume an expired transaction", async () => {
    const stateHash = "e".repeat(43);
    const browserHash = "c".repeat(43);
    const nowSeconds = 1_800_000_000;
    await runInDurableObject(store, (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO reviewer_auth_transactions (state_hash,browser_hash,nonce,code_verifier,created_at,expires_at) VALUES (?,?,?,?,?,?)",
        stateHash, browserHash, "n".repeat(43), "v".repeat(64), nowSeconds, nowSeconds + 300
      );
    });
    expect(await store.consumeTransaction(stateHash, browserHash, nowSeconds + 301)).toBeNull();
  });
});
