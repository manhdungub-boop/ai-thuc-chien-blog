import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflow = await readFile(
  new URL("../.github/workflows/agent-runtime-preview-validation.yml", import.meta.url),
  "utf8"
);

assert.match(workflow, /^on:\n[\s\S]*?^  pull_request:/m);
assert.match(workflow, /^      - "agents\/runtime\/\*\*"$/m);
assert.doesNotMatch(
  workflow,
  /^      - "\.github\/workflows\/agent-runtime-preview-validation\.yml"$/m,
  "workflow-only changes must be checked by Static CI, not by runtime-source tests"
);
assert.match(workflow, /^  workflow_dispatch:/m);

const validateStart = workflow.indexOf("  validate:");
const e2eStart = workflow.indexOf("  one-shot-preview-e2e:");
assert.ok(validateStart >= 0 && e2eStart > validateStart, "expected validate and E2E jobs");
const validateJob = workflow.slice(validateStart, e2eStart);
assert.match(validateJob, /github\.event_name == 'pull_request'/);
assert.match(validateJob, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
assert.match(validateJob, /github\.event_name == 'workflow_dispatch'/);
assert.match(validateJob, /github\.ref == 'refs\/heads\/main'/);
assert.match(validateJob, /github\.actor_id == '342528485'/);
assert.doesNotMatch(validateJob, /secrets\.[A-Z0-9_]+|environment:/);

const e2eJob = workflow.slice(e2eStart);
assert.match(e2eJob, /needs: validate/);
assert.match(e2eJob, /environment: agent-runtime-preview/);
assert.match(e2eJob, /github\.ref == 'refs\/heads\/main'/);
assert.match(e2eJob, /github\.actor_id == '342528485'/);
assert.match(e2eJob, /github\.event\.pull_request\.head\.repo\.full_name == 'manhdungub-boop\/ai-thuc-chien-blog'/);
assert.match(e2eJob, /github\.event\.pull_request\.head\.ref == 'security\/fence-leases-on-circuit-breaker-pause-20261123'/);
assert.doesNotMatch(workflow, /^  (?:schedule|push|repository_dispatch|workflow_run):/m);
assert.doesNotMatch(workflow, /pull_request_target:/);

console.log("PASS: Agent Runtime PR shell validation is same-repository/read-only; E2E remains owner-pinned and protected.");
