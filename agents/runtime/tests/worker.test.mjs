import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";

const request = (path, method = "GET") =>
  new Request("https://agent-runtime-preview.example.workers.dev" + path, { method });

test("health is read-only and reports the default closed state", async () => {
  const response = await worker.fetch(request("/health"), {
    AGENT_ENABLED: "false",
    AGENT_PAUSED: "true",
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.enabled, false);
  assert.equal(body.paused, true);
  assert.equal(body.execution, "not_implemented");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("run is rejected while disabled", async () => {
  const response = await worker.fetch(request("/run", "POST"), {
    AGENT_ENABLED: "false",
    AGENT_PAUSED: "true",
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "agent_disabled_or_paused");
});

test("run remains unavailable after flags and operator authentication are opened", async () => {
  const token = "preview-only-test-secret-0123456789abcdef";
  const authorizedRequest = new Request("https://agent-runtime-preview.example.workers.dev/run", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
  });
  const response = await worker.fetch(authorizedRequest, {
    AGENT_ENABLED: "true",
    AGENT_PAUSED: "false",
    AGENT_OPERATOR_TOKEN: token,
  });
  assert.equal(response.status, 501);
  assert.equal((await response.json()).error, "execution_not_implemented");
});

test("health rejects non-GET methods", async () => {
  const response = await worker.fetch(request("/health", "POST"), {});
  assert.equal(response.status, 405);
});

test("unknown routes do not expose runtime internals", async () => {
  const response = await worker.fetch(request("/admin"), {});
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "not_found");
});

test("run requires operator authentication if both safety flags are opened", async () => {
  const response = await worker.fetch(request("/run", "POST"), {
    AGENT_ENABLED: "true",
    AGENT_PAUSED: "false",
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "operator_auth_required");
});

test("run remains unimplemented after valid operator authentication", async () => {
  const token = "preview-only-test-secret-0123456789abcdef";
  const authorizedRequest = new Request("https://agent-runtime-preview.example.workers.dev/run", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
  });
  const response = await worker.fetch(authorizedRequest, {
    AGENT_ENABLED: "true",
    AGENT_PAUSED: "false",
    AGENT_OPERATOR_TOKEN: token,
  });
  assert.equal(response.status, 501);
  assert.equal((await response.json()).error, "execution_not_implemented");
});
