# AI Thực Chiến DUNG - AI — Agent Coordinator

**Status:** Phase 1 foundation / review-only. This directory defines the agent operating model. It does not install software, call paid model APIs, connect accounts, publish content, or deploy the website.

## Purpose

Coordinate the recurring work shared by the owner and the AI assistant:

1. Research and verify useful AI tools.
2. Maintain the AI Bank with deduplication and evidence.
3. Research, write, edit, and quality-check SEO articles.
4. Prepare media and social content using verified no-cost capabilities.
5. Review repository changes, tests, security, and release readiness.
6. Report progress with links and evidence, including blockers and required owner actions.

## Operating model

The **Manager Agent** is the sole task coordinator. It converts a request into a small task plan, assigns each task to one specialist, checks dependencies, and records evidence. Specialist agents return structured findings; they do not independently publish, merge, deploy, connect accounts, or widen permissions.

The specialist roles are defined in `agent-registry.json`:

- Research Agent
- AI Bank Agent
- Content Agent
- Media Agent
- Social Agent
- QA & Security Agent
- Release Agent

This is intentionally a **provider-neutral specification**, not a claim that autonomous background agents or free inference are already running. The existing ChatGPT-connected tools may be used only when available, authorized, and verified. No paid API is assumed.

## Task lifecycle

`RECEIVED → TRIAGED → PLANNED → IN_PROGRESS → REVIEW → DONE`

Alternative terminal states: `BLOCKED`, `CANCELLED`.

Every task record must contain:
- task ID and plain-language goal;
- owner/specialist and dependencies;
- allowed tools and maximum permission scope;
- cost class (must be `zero_cost_verified` or `no_external_execution`);
- data classification;
- acceptance criteria;
- evidence links, test results, and timestamp;
- blockers and any action that requires the owner.

A task is not `DONE` until its acceptance criteria are evidenced. Tool discovery is not tool connection. A draft is not a published post. A passing static check is not a production release.

## Cost and tool selection

- Prefer built-in, already-connected, free capabilities.
- Verify current plan, quota, and whether an action consumes credits before execution.
- Do not start paid trials, enable billing, add payment methods, or consume generation credits.
- If price or quota is uncertain, mark the tool `cost_unverified` and do not execute it.
- If a required tool is not connected, explain the exact permission/connection needed and wait.

## Security and authority boundaries

See [SECURITY_AND_APPROVALS.md](./SECURITY_AND_APPROVALS.md).

The default is read-only and staging-only. The agents must not access secrets, OTPs, passwords, private customer data, or production records. Never echo secret values into logs or reports.

## Integration status

- Existing AI Affiliate Agents Stage 1 (7 agents, schemas, fixtures, simulator) is a prior offline foundation and should be reused after its exact files and tests are located and reviewed.
- GitHub is the active repository workflow.
- Existing Facebook draft workflow is separate; it creates drafts and does not grant permission to publish.
- No new workflow in this PR runs on a schedule or deploys the website.

## Phase plan

1. **Foundation (this PR):** roles, task contract, routing, safety, acceptance criteria.
2. **Offline executable core:** deterministic task validator/router and fixtures; no external network or model calls.
3. **Read-only integrations:** GitHub status, public research, catalog audit, and content checks using already-authorized free tools.
4. **Staging execution:** isolated Preview-only validation with synthetic/test data.
5. **Owner-approved actions:** account connection, public posting, merge, or deployment only at their explicit authority gates.

## Completion criteria for Phase 1

- Roles and responsibilities are unambiguous.
- Tool and cost gates are explicit.
- Production and external-action boundaries are explicit.
- Each specialist has measurable deliverables.
- No live service configuration or production asset is changed by this foundation.
