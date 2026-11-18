import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

function transaction(seed, nowSeconds = 1_800_000_000) {
  const token = value => (seed + value).repeat(30).slice(0, 43);
  return {
    stateHash: token("s"),
    browserHash: token("b"),
    nonce: token("n"),
    codeVerifier: token("v") + token("w").slice(0, 21),
    nowSeconds
  };
}

describe("AgentReviewerAuthStore Durable Object", () => {
  let store;
  let storeName;

  beforeEach(() => {
    storeName = "reviewer-auth-store-integration-" + crypto.randomUUID();
    store = env.AGENT_REVIEWER_AUTH_STORE.getByName(storeName);
  });

  it("persists a browser-bound transaction and consumes it exactly once", async () => {
    const tx = transaction("one");
    const created = await store.createTransaction(
      tx.stateHash, tx.browserHash, tx.nonce, tx.codeVerifier, tx.nowSeconds
    );
    console.log("reviewer_auth_create_debug", JSON.stringify({
      created,
      lengths: [tx.stateHash.length, tx.browserHash.length, tx.nonce.length, tx.codeVerifier.length],
      nowSeconds: tx.nowSeconds,
      integer: Number.isInteger(tx.nowSeconds)
    }));
    expect(created).toEqual({ created: true });

    const secondStub = env.AGENT_REVIEWER_AUTH_STORE.getByName(storeName);
    expect(await secondStub.consumeTransaction(
      tx.stateHash, tx.browserHash, tx.nowSeconds + 1
    )).toMatchObject({
      nonce: tx.nonce,
      code_verifier: tx.codeVerifier,
      created_at: tx.nowSeconds,
      expires_at: tx.nowSeconds + 300
    });
    expect(await store.consumeTransaction(
      tx.stateHash, tx.browserHash, tx.nowSeconds + 2
    )).toBeNull();
  });

  it("rejects a mismatched browser binding and deletes the unusable state", async () => {
    const tx = transaction("two");
    await store.createTransaction(
      tx.stateHash, tx.browserHash, tx.nonce, tx.codeVerifier, tx.nowSeconds
    );
    expect(await store.consumeTransaction(
      tx.stateHash, "x".repeat(43), tx.nowSeconds + 1
    )).toBeNull();
    expect(await store.consumeTransaction(
      tx.stateHash, tx.browserHash, tx.nowSeconds + 2
    )).toBeNull();
  });

  it("rejects expired transactions and cleans them during the next create", async () => {
    const expired = transaction("three");
    await store.createTransaction(
      expired.stateHash, expired.browserHash, expired.nonce, expired.codeVerifier, expired.nowSeconds
    );
    expect(await store.consumeTransaction(
      expired.stateHash, expired.browserHash, expired.nowSeconds + 300
    )).toBeNull();

    const fresh = transaction("four", expired.nowSeconds + 301);
    expect(await store.createTransaction(
      fresh.stateHash, fresh.browserHash, fresh.nonce, fresh.codeVerifier, fresh.nowSeconds
    )).toEqual({ created: true });
    expect(await store.consumeTransaction(
      expired.stateHash, expired.browserHash, fresh.nowSeconds
    )).toBeNull();
    expect(await store.consumeTransaction(
      fresh.stateHash, fresh.browserHash, fresh.nowSeconds + 1
    )).toMatchObject({ nonce: fresh.nonce, code_verifier: fresh.codeVerifier });
  });

  it("rejects duplicate state hashes and malformed transaction material", async () => {
    const tx = transaction("five");
    expect(await store.createTransaction(
      tx.stateHash, tx.browserHash, tx.nonce, tx.codeVerifier, tx.nowSeconds
    )).toEqual({ created: true });
    expect(await store.createTransaction(
      tx.stateHash, tx.browserHash, "z".repeat(43), "q".repeat(64), tx.nowSeconds + 1
    )).toEqual({ created: false });
    expect(await store.createTransaction(
      "short", tx.browserHash, tx.nonce, tx.codeVerifier, tx.nowSeconds
    )).toEqual({ created: false });
    expect(await store.consumeTransaction(
      tx.stateHash, tx.browserHash, tx.nowSeconds + 2
    )).toMatchObject({ nonce: tx.nonce });
  });

  it("allows only one winner when two callback requests race to consume the same transaction", async () => {
    const tx = transaction("six");
    await store.createTransaction(
      tx.stateHash, tx.browserHash, tx.nonce, tx.codeVerifier, tx.nowSeconds
    );
    const results = await Promise.all([
      store.consumeTransaction(tx.stateHash, tx.browserHash, tx.nowSeconds + 1),
      store.consumeTransaction(tx.stateHash, tx.browserHash, tx.nowSeconds + 1)
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter(Boolean)[0]).toMatchObject({
      nonce: tx.nonce,
      code_verifier: tx.codeVerifier
    });
  });

  it("enforces a bounded number of active login transactions", async () => {
    const nowSeconds = 1_800_000_000;
    for (let index = 0; index < 100; index += 1) {
      const value = index.toString(16).padStart(2, "0");
      const repeat = character => (character + value).repeat(22).slice(0, 43);
      expect(await store.createTransaction(
        repeat("s"), repeat("b"), repeat("n"), repeat("v") + repeat("w").slice(0, 21), nowSeconds
      )).toEqual({ created: true });
    }
    const overflow = transaction("overflow", nowSeconds);
    expect(await store.createTransaction(
      overflow.stateHash, overflow.browserHash, overflow.nonce, overflow.codeVerifier, nowSeconds
    )).toMatchObject({ created: false, reason: "login_transaction_capacity_reached" });
  });
});
