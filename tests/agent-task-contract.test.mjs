import test from "node:test";
import assert from "node:assert/strict";
import { routeTask, validateTask } from "../scripts/validate-agent-task.mjs";

const validTask = {
  task_id: "test-001",
  goal: "Verify a public AI tool using official sources",
  task_type: "research",
  state: "PLANNED",
  permission_scope: "read_only",
  cost_class: "no_external_execution",
  data_class: "public",
  acceptance_criteria: ["Official source recorded"],
  allowed_tools: []
};

test("routes research work to the Research Agent", () => {
  assert.deepEqual(routeTask(validTask), { ok: true, assigned_agent: "research", role: "evidence_research" });
});

test("accepts a bounded zero-cost read-only task", () => {
  assert.equal(validateTask(validTask).ok, true);
});

test("blocks unverified or paid cost classes", () => {
  const result = validateTask({ ...validTask, cost_class: "cost_unverified" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("cost_not_verified_zero"));
});

test("blocks secret and sensitive data", () => {
  const result = validateTask({ ...validTask, data_class: "secret" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("data_class_blocked"));
});

test("blocks production changes and unapproved publication", () => {
  const production = validateTask({ ...validTask, requires_production_change: true });
  const publication = validateTask({ ...validTask, requires_external_publication: true });
  assert.ok(production.errors.includes("production_change_forbidden"));
  assert.ok(publication.errors.includes("external_publication_requires_owner_approval"));
});

test("requires isolated Preview for staging writes", () => {
  const result = validateTask({ ...validTask, permission_scope: "staging_write" });
  assert.ok(result.errors.includes("staging_write_requires_isolated_preview"));
});

test("requires evidence before a task can be DONE", () => {
  const result = validateTask({ ...validTask, state: "DONE", evidence: [] });
  assert.ok(result.errors.includes("done_requires_evidence"));
});

test("blocks unknown task types", () => {
  assert.ok(validateTask({ ...validTask, task_type: "unknown" }).errors.includes("unsupported_task_type"));
});

test("requires explicit owner action for account connections", () => {
  const result = validateTask({ ...validTask, requires_account_connection: true });
  assert.ok(result.errors.includes("account_connection_requires_owner_action"));
});
