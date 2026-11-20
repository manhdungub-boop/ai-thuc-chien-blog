import test from "node:test";
import assert from "node:assert/strict";
import { fetchGitHubActionsJwks } from "../src/github-oidc-jwks.mjs";

const issuer = "https://token.actions.githubusercontent.com";
const discoveryUrl = issuer + "/.well-known/openid-configuration";
const jwksUrl = issuer + "/.well-known/jwks";
const signingKey = Object.freeze({
  kty: "RSA",
  use: "sig",
  alg: "RS256",
  kid: "github-test-key-1",
  n: "AQAB",
  e: "AQAB",
});

function jsonResponse(value, headers = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fetchSequence(responses, calls = []) {
  let index = 0;
  return async (url, options) => {
    calls.push({ url, options });
    const response = responses[index++];
    if (response instanceof Error) throw response;
    if (!response) throw new Error("unexpected_fetch");
    return response;
  };
}

test("fetches discovery and signing keys only from the pinned GitHub issuer", async () => {
  const calls = [];
  const fetchImpl = fetchSequence([
    jsonResponse({ issuer, jwks_uri: jwksUrl }),
    jsonResponse({ keys: [signingKey] }),
  ], calls);

  const result = await fetchGitHubActionsJwks({ fetchImpl });
  assert.deepEqual(result, { keys: [signingKey] });
  assert.deepEqual(calls.map((call) => call.url), [discoveryUrl, jwksUrl]);
  for (const call of calls) {
    assert.equal(call.options.method, "GET");
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.cache, "no-store");
    assert.equal(call.options.credentials, "omit");
    assert.equal(call.options.headers.Accept, "application/json");
  }
});

test("rejects discovery metadata that changes issuer or signing-key location", async () => {
  await assert.rejects(
    fetchGitHubActionsJwks({
      fetchImpl: fetchSequence([jsonResponse({ issuer: "https://attacker.invalid", jwks_uri: jwksUrl })]),
    }),
    /oidc_discovery_untrusted/,
  );
  await assert.rejects(
    fetchGitHubActionsJwks({
      fetchImpl: fetchSequence([jsonResponse({ issuer, jwks_uri: "https://attacker.invalid/jwks" })]),
    }),
    /oidc_discovery_untrusted/,
  );
});

test("rejects redirects, non-JSON responses, and oversized discovery documents", async () => {
  await assert.rejects(
    fetchGitHubActionsJwks({ fetchImpl: fetchSequence([new Response("", { status: 302 })]) }),
    /oidc_discovery_invalid/,
  );
  await assert.rejects(
    fetchGitHubActionsJwks({
      fetchImpl: fetchSequence([new Response("{}", { status: 200, headers: { "content-type": "text/plain" } })]),
    }),
    /oidc_discovery_invalid/,
  );
  await assert.rejects(
    fetchGitHubActionsJwks({
      fetchImpl: fetchSequence([jsonResponse({}, { "content-length": "20000" })]),
    }),
    /oidc_discovery_invalid/,
  );
});

test("rejects malformed, duplicate, unsupported, empty, and oversized JWKS key sets", async () => {
  const discovery = jsonResponse({ issuer, jwks_uri: jwksUrl });
  const invalidSets = [
    { keys: [] },
    { keys: [signingKey, signingKey] },
    { keys: [{ ...signingKey, alg: "HS256" }] },
    { keys: [{ ...signingKey, n: "not valid!" }] },
    { keys: Array.from({ length: 11 }, (_, i) => ({ ...signingKey, kid: "key-" + i })) },
  ];
  for (const value of invalidSets) {
    await assert.rejects(
      fetchGitHubActionsJwks({ fetchImpl: fetchSequence([discovery, jsonResponse(value)]) }),
      /oidc_jwks_invalid/,
    );
  }
});

test("fails closed when either trusted endpoint is unavailable", async () => {
  await assert.rejects(
    fetchGitHubActionsJwks({ fetchImpl: fetchSequence([new Error("network")]) }),
    /oidc_discovery_unavailable/,
  );
  await assert.rejects(
    fetchGitHubActionsJwks({
      fetchImpl: fetchSequence([
        jsonResponse({ issuer, jwks_uri: jwksUrl }),
        new Error("network"),
      ]),
    }),
    /oidc_jwks_unavailable/,
  );
});
