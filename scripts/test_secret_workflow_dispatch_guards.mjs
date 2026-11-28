import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const read = async path => readFile(new URL("../.github/workflows/" + path, import.meta.url), "utf8");

for (const forbidden of ["deploy-auth-preview-candidate.yml", "verify-auth-preview-candidate.yml"]) {
  await assert.rejects(
    access(new URL("../.github/workflows/" + forbidden, import.meta.url)),
    { code: "ENOENT" },
    forbidden + " must remain absent: branch-controlled workflows must not receive Cloudflare or application secrets."
  );
}

const health = await read("health-check.yml");
const diagnoseBuild = await read("diagnose-cloudflare-worker-build.yml");
const diagnoseD1 = await read("diagnose-community-d1.yml");
const verifyToken = await read("verify-cloudflare-deploy-token.yml");
const repairLegacy = await read("repair-cloudflare-branch-preview-triggers.yml");
const pages = await read("deploy-cloudflare-pages.yml");
const workers = await read("deploy-cloudflare-workers.yml");
const workerOnly = await read("deploy-production-worker-only.yml");
const googlePreview = await read("deploy-google-login-preview.yml");
const previewD1 = await read("migrate-preview-d1.yml");
const configureBuilds = await read("configure-cloudflare-worker-builds.yml");
const stagingEmail = await read("staging-email-e2e.yml");
const agentRuntimePreview = await read("agent-runtime-preview-validation.yml");
const agentRuntimeLines = agentRuntimePreview.split("\n");
const agentRuntimeValidateStart = agentRuntimeLines.indexOf("  validate:");
const agentRuntimeE2EStart = agentRuntimeLines.indexOf("  one-shot-preview-e2e:");
assert.notEqual(agentRuntimeValidateStart, -1, "Agent Runtime validation job must exist.");
assert.ok(agentRuntimeE2EStart > agentRuntimeValidateStart, "Protected Preview E2E must remain a separate job.");
const agentRuntimeValidateLines = agentRuntimeLines.slice(agentRuntimeValidateStart, agentRuntimeE2EStart);
const agentRuntimeValidateBlock = agentRuntimeValidateLines.join("\n");
assert.ok(agentRuntimeValidateBlock.includes("github.event_name == 'pull_request'"),
  "Credential-free Agent Runtime validation must run for pull requests.");
assert.ok(agentRuntimeValidateBlock.includes("github.event.pull_request.head.repo.full_name == 'manhdungub-boop/ai-thuc-chien-blog'"),
  "PR validation must pin checkout to same-repository source.");
assert.ok(agentRuntimeValidateBlock.includes("github.event_name == 'workflow_dispatch'") &&
  agentRuntimeValidateBlock.includes("github.ref == 'refs/heads/main'") &&
  agentRuntimeValidateBlock.includes("github.actor_id == '342528485'"),
  "Manual validation must remain restricted to the owner on trusted main.");
assert.doesNotMatch(agentRuntimeValidateBlock, /secrets\\.[A-Z0-9_]+\\s*\\}\\}/,
  "Credential-free PR validation must not reference secret values.");
const agentRuntimePullRequestTrigger = agentRuntimePreview.slice(
  agentRuntimePreview.indexOf("  pull_request:"),
  agentRuntimePreview.indexOf("  workflow_dispatch:")
);
assert.ok(agentRuntimePullRequestTrigger.includes('"feat/ai-bank-discovery-workflow-20261126"'),
  "The stacked AI Bank discovery PR base branch must trigger validation.");
assert.ok(agentRuntimePullRequestTrigger.includes('"agents/runtime/**"'),
  "Runtime source changes must trigger exact-head validation.");
assert.ok(!agentRuntimePullRequestTrigger.includes(".github/workflows/agent-runtime-preview-validation.yml"),
  "Workflow-only changes must use Static CI guard tests rather than runtime tests without runtime source.");
const agentRuntimeE2EBlock = agentRuntimeLines.slice(agentRuntimeE2EStart).join("\n");
assert.ok(agentRuntimeE2EBlock.includes("environment: agent-runtime-preview") &&
  agentRuntimeE2EBlock.includes("github.actor_id == '342528485'") &&
  agentRuntimeE2EBlock.includes("inputs.expected_head_sha") &&
  agentRuntimeE2EBlock.includes("id-token: write"),
  "Protected Preview E2E must retain its owner pin, exact SHA, protected environment, and scoped OIDC permission.");

const stagingEmailLines = stagingEmail.split("\n");
const stagingJobStart = stagingEmailLines.indexOf("  staging-email-e2e:");
assert.notEqual(stagingJobStart, -1, "Staging email E2E job must exist.");
assert.equal(
  stagingEmailLines.filter(line => /^    environment:/.test(line)).length,
  1,
  "Staging email E2E must use exactly one protected environment."
);
assert.ok(stagingEmailLines.includes("    environment: staging-e2e"),
  "Staging email E2E must use the protected staging-e2e environment.");
const nextJobStart = stagingEmailLines.findIndex((line, index) =>
  index > stagingJobStart && /^  [A-Za-z0-9_-]+:\s*$/.test(line));
const stagingJobLines = stagingEmailLines.slice(
  stagingJobStart,
  nextJobStart === -1 ? stagingEmailLines.length : nextJobStart
);
const expectedStagingJobCondition =
  "    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'";
assert.deepEqual(
  stagingJobLines.filter(line => /^    if:/.test(line)),
  [expectedStagingJobCondition],
  "Staging email E2E must have exactly one trusted-main workflow_dispatch condition."
);

const stagingCheckoutStart = stagingJobLines.indexOf("      - name: Check out the exact trusted dispatch commit");
assert.notEqual(stagingCheckoutStart, -1, "Staging email E2E must check out the trusted source.");
const nextStepStart = stagingJobLines.findIndex((line, index) =>
  index > stagingCheckoutStart && /^      - name:/.test(line));
const stagingCheckoutLines = stagingJobLines.slice(
  stagingCheckoutStart,
  nextStepStart === -1 ? stagingJobLines.length : nextStepStart
);
assert.equal(
  stagingCheckoutLines.filter(line => /^          ref:/.test(line)).length,
  1,
  "Staging email checkout must define exactly one ref."
);
assert.ok(stagingCheckoutLines.includes("          ref: ${{ github.sha }}"),
  "Staging email E2E must check out the immutable dispatch commit, not a moving branch ref.");
assert.equal(
  stagingCheckoutLines.filter(line => /^          persist-credentials:/.test(line)).length,
  1,
  "Staging email checkout must define exactly one credential-persistence setting."
);
assert.ok(stagingCheckoutLines.includes("          persist-credentials: false"),
  "Staging email E2E must not persist the GitHub checkout token.");

const productionSmokeGuard = "if: github.event_name == 'schedule' || (github.event_name == 'workflow_run' && github.event.workflow_run.head_branch == 'main') || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')";
assert.ok(health.includes(productionSmokeGuard), "Live Production smoke tests must run only on schedule or trusted main.");
const healthGuard = "if: (github.event_name == 'workflow_run' && github.event.workflow_run.head_branch == 'main') || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main')";
assert.equal(health.split(healthGuard).length - 1, 2,
  "Both health-check steps carrying the Cloudflare token must be restricted to successful main workflow runs or manual main dispatch.");

assert.ok(diagnoseBuild.includes("confirm_read_only_diagnosis:"));
assert.ok(diagnoseBuild.includes("default: false"));
assert.ok(diagnoseBuild.includes("if: github.ref == 'refs/heads/main' && inputs.confirm_read_only_diagnosis == true"));
assert.ok(diagnoseD1.includes("confirm_read_only_diagnosis:"));
const d1WordBoundary = String.fromCharCode(92) + "b${col}" + String.fromCharCode(92) + "b";
assert.ok(diagnoseD1.includes("new RegExp(String.raw`" + d1WordBoundary + "`, 'i')"),
  "D1 schema diagnostics must use real word-boundary regexes, not literal backslash-b.");
assert.ok(diagnoseD1.includes("default: false"));
assert.ok(diagnoseD1.includes("if: github.ref == 'refs/heads/main' && inputs.confirm_read_only_diagnosis == true"));
assert.ok(diagnoseD1.includes("ref: main"));
assert.ok(diagnoseD1.includes("persist-credentials: false"));
assert.ok(verifyToken.includes("confirm_read_only_token_check:"));
assert.ok(verifyToken.includes("default: false"));
assert.ok(verifyToken.includes("if: github.ref == 'refs/heads/main' && inputs.confirm_read_only_token_check == true"));

assert.doesNotMatch(repairLegacy, /secrets\.|api\.cloudflare\.com|curl\b|--request\s+(?:POST|PATCH|PUT|DELETE)|api_mutate/i,
  "Legacy trigger repair must not access secrets or mutate Cloudflare.");
assert.ok(repairLegacy.includes("Disabled: legacy trigger repair has unverified Worker identity"));
assert.ok(pages.includes("github.ref == 'refs/heads/main'"));
assert.ok(pages.includes("confirm_production_pages_deploy == true"));
assert.ok(workers.includes("github.ref == 'refs/heads/main'"));
assert.ok(workers.includes("confirm_production_worker_and_d1_changes == true"));
assert.ok(workers.includes("github.event_name == 'workflow_dispatch'"),
  "Production Worker deployment must never run from a push event.");
assert.ok(workerOnly.includes("if: ${{ false }}"),
  "The duplicate Worker-only Production deployment workflow must remain disabled for this release.");
assert.doesNotMatch(workerOnly, /^\s{2}push:/m,
  "The duplicate Worker-only Production workflow must not run automatically on main pushes.");
assert.ok(!workerOnly.includes("CLOUDFLARE_WORKERS_API_TOKEN") &&
  !workerOnly.includes("cloudflare/wrangler-action") &&
  !workerOnly.includes("wrangler deploy") &&
  !workerOnly.includes("d1 migrations apply"),
  "The disabled Worker-only workflow must not retain a secret-bearing Production deploy path.");
assert.doesNotMatch(googlePreview, /^\s{2}push:/m,
  "The Preview deployment workflow must not run from branch pushes.");
assert.ok(googlePreview.includes("confirm_preview_worker_deploy:") &&
  googlePreview.includes("default: false") &&
  googlePreview.includes("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.confirm_preview_worker_deploy == true"),
  "Preview deployment must require explicit confirmation from trusted main.");
assert.ok(googlePreview.includes("ref: main") && googlePreview.includes("persist-credentials: false"),
  "Preview deployment must check out trusted main without persisting the GitHub token.");
assert.ok(googlePreview.includes("51d814c8-a3fc-4481-a5f1-60bc67617f3c"),
  "Preview deployment must remain pinned to the isolated Preview D1 UUID.");
assert.ok(googlePreview.includes("wrangler.preview-migrations.jsonc"),
  "Only the dedicated Preview D1 migration config may be used.");
assert.ok(previewD1.includes("github.ref == 'refs/heads/main'"));
assert.ok(previewD1.includes("ref: main"));
assert.ok(previewD1.includes("51d814c8-a3fc-4481-a5f1-60bc67617f3c"));
assert.ok(configureBuilds.includes("test_configure_cloudflare_worker_builds.py"));

const checkoutWorkflows = [
  ["health-check.yml", health],
  ["diagnose-community-d1.yml", diagnoseD1],
  ["deploy-cloudflare-pages.yml", pages],
  ["deploy-cloudflare-workers.yml", workers],
  ["deploy-google-login-preview.yml", googlePreview],
  ["migrate-preview-d1.yml", previewD1],
  ["configure-cloudflare-worker-builds.yml", configureBuilds],
  ["staging-email-e2e.yml", stagingEmail]
];
for (const [name, workflow] of checkoutWorkflows) {
  const lines = workflow.split("\n");
  const checkoutIndexes = lines.map((line, index) => line.includes("uses: actions/checkout@") ? index : -1).filter(index => index >= 0);
  assert.ok(checkoutIndexes.length > 0, name + " must retain an explicit checkout step.");
  for (const index of checkoutIndexes) {
    const nextStep = lines.findIndex((line, offset) => offset > index && /^\s*- name:/.test(line));
    const block = lines.slice(index, nextStep >= 0 ? nextStep : lines.length).join("\n");
    assert.match(block, /persist-credentials:\s*false/, name + " must not persist the GitHub checkout token.");
  }
}
console.log("PASS: all secret-bearing workflows with checkout disable persisted GitHub credentials.");
assert.doesNotMatch(configureBuilds, /secrets\.|api\.cloudflare\.com|wrangler (?:deploy|preview)/);
console.log("PASS: all Cloudflare secret-bearing diagnostics require trusted-main dispatch and explicit confirmation.");
console.log("PASS: legacy trigger repair is disabled; Workers Builds updater is offline-only.");
console.log("PASS: Production deploys require explicit confirmation from main; D1 migration is locked to the Preview UUID.");
console.log("PASS: Worker-only Production deployment is disabled; Preview deploys require trusted-main manual confirmation.");
console.log("PASS: staging email E2E runs trusted main only and cannot execute branch-controlled code with staging secrets.");
