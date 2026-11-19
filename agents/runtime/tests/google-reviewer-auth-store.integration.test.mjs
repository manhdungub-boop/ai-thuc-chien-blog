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

  it("does not let a mismatched browser binding consume or delete a valid login transaction", async () => {
    const stateHash = "s".repeat(43);
    const browserHash = "b".repeat(43);
    const wrongBrowserHash = "x".repeat(43);
    const nonce = "n".repeat(43);
    const codeVerifier = "v".repeat(64);
    const nowSeconds = 1_800_000_000;

    expect(await store.createTransaction(stateHash, browserHash, nonce, codeVerifier, nowSeconds))
      .toEqual({ created: true });

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
    await store.createTransaction(stateHash, browserHash, "n".repeat(43), "v".repeat(64), nowSeconds);
    expect(await store.consumeTransaction(stateHash, browserHash, nowSeconds + 301)).toBeNull();
  });
});
