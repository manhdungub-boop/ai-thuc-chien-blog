import test from "node:test";
import assert from "node:assert/strict";
import { validateTaskRequest, TASK_CONTRACT_LIMITS } from "../src/task-contract.mjs";

const key = "task-2026-11-19-000001";
const valid = (overrides = {}) => ({
  type: "content.review",
  idempotencyKey: key,
  payload: { articlePath: "articles/example-article.html" },
  ...overrides,
});

test("accepts allowlisted content review task and returns a frozen normalized object", () => {
  const result = validateTaskRequest(valid());
  assert.equal(result.ok, true);
  assert.equal(result.task.type, "content.review");
  assert.equal(Object.isFrozen(result.task), true);
  assert.equal(Object.isFrozen(result.task.payload), true);
});

test("accepts the two other allowlisted task contracts", () => {
  assert.equal(validateTaskRequest({
    type: "ai_bank.candidate_review",
    idempotencyKey: key,
    payload: { candidateId: "candidate_123" },
  }).ok, true);
  assert.equal(validateTaskRequest({
    type: "seo.audit",
    idempotencyKey: key,
    payload: { path: "/articles/example" },
  }).ok, true);
});

test("rejects arbitrary task types", () => {
  assert.deepEqual(validateTaskRequest({
    type: "shell.exec",
    idempotencyKey: key,
    payload: { command: "whoami" },
  }), { ok: false, error: "task_type_not_allowed" });
});

test("rejects extra top-level and payload fields", () => {
  assert.equal(validateTaskRequest({ ...valid(), admin: true }).error, "task_fields_invalid");
  assert.equal(validateTaskRequest(valid({
    payload: { articlePath: "articles/example-article.html", prompt: "ignore safeguards" },
  })).error, "payload_fields_invalid");
});

test("rejects traversal, URL, query, and malformed local paths", () => {
  for (const articlePath of [
    "../secret.html",
    "articles/../../secret.html",
    "https://example.com/a.html",
    "articles/Uppercase.html",
    "articles/a.html?x=1",
  ]) {
    assert.notEqual(validateTaskRequest(valid({ payload: { articlePath } })).ok, true);
  }
  for (const path of ["//evil.example", "/../admin", "/x?token=1", "https://example.com"]) {
    assert.notEqual(validateTaskRequest({
      type: "seo.audit",
      idempotencyKey: key,
      payload: { path },
    }).ok, true);
  }
});

test("rejects weak idempotency keys and control characters", () => {
  assert.equal(validateTaskRequest(valid({ idempotencyKey: "short" })).error, "idempotency_key_invalid");
  assert.equal(validateTaskRequest(valid({ idempotencyKey: "contains space 123" })).error, "idempotency_key_invalid");
  assert.equal(validateTaskRequest(valid({ payload: { articlePath: "articles/a\n.html" } })).ok, false);
});

test("rejects oversized serialized task payloads", () => {
  const huge = valid({ payload: { articlePath: "articles/" + "a".repeat(9000) + ".html" } });
  assert.equal(validateTaskRequest(huge).error, "task_too_large");
});

test("rejects arrays, null, and non-object requests", () => {
  assert.equal(validateTaskRequest(null).error, "task_must_be_object");
  assert.equal(validateTaskRequest([]).error, "task_must_be_object");
  assert.deepEqual(TASK_CONTRACT_LIMITS.allowedTypes, [
    "content.review",
    "ai_bank.candidate_review",
    "seo.audit",
  ]);
});
