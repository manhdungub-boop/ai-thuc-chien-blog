# Agent Security and Approval Boundaries

## 1. Default-deny policy

Every agent starts with read-only access. An action is denied unless it is explicitly listed in the task plan, its cost is verified as zero, and its data scope is permitted.

## 2. Protected resources

The following are protected and must not be changed by an agent:
- Production Worker, live website configuration, DNS, and production D1;
- production secrets, OAuth credentials, API keys, and deployment tokens;
- real user accounts, personal records, and customer content;
- GitHub main branch, merge state, and production release state.

A user request to "continue", "fix", or "build" does not by itself authorize a production mutation, permission expansion, account connection, or paid operation.

## 3. Actions requiring an explicit owner gate

Stop and ask the owner before:
- connecting an external account or granting a new permission;
- installing an app that requests broad device, file, browser, or account access;
- starting a trial, adding billing, using paid credits, or triggering a cost-uncertain action;
- publishing or scheduling content externally where the channel authorization is not already explicit;
- merging a pull request or deploying to Production;
- changing DNS, Worker bindings, D1 schemas/data, secrets, OAuth settings, or live configuration.

## 4. Data handling

- Public sources may be researched and cited.
- Project-internal source code and documents may be read for the assigned task.
- Use synthetic data for tests.
- Never request or store passwords, OTPs, recovery codes, payment details, or secret values.
- Do not send private project content to an external AI provider unless the owner explicitly approves that provider and data transfer.
- Redact tokens and personal data from logs and reports.

## 5. Tool admission checklist

Before using a tool, record:
1. exact tool and official source;
2. task-specific purpose;
3. account/permission scope;
4. free-tier and quota evidence;
5. data sent and data retained;
6. whether it can write, publish, or trigger external actions;
7. fallback if unavailable.

If any item is unknown, classify it as `cost_unverified` or `permission_unverified` and do not execute.

## 6. Evidence standard

A result may be reported as successful only when supported by a direct tool response, a passing test, or an independently verifiable URL/state. Distinguish:
- discovered ≠ connected;
- connected ≠ tested;
- generated ≠ exported;
- draft ≠ published;
- CI passed ≠ Preview passed;
- Preview passed ≠ Production approved;
- mergeable ≠ merged.

## 7. Incident response

If unexpected access, data exposure, cost, or production impact is detected:
1. stop the affected workflow;
2. do not retry or broaden permissions;
3. preserve non-secret evidence;
4. report scope, impact, and containment status;
5. request owner direction before any corrective production action.

## 8. Release gate

Release Agent can recommend GO only when all applicable conditions are evidenced:
- affected-scope tests pass;
- Preview checks pass;
- no unresolved critical/high security finding remains;
- content/source/license checks pass where relevant;
- rollback path is documented and feasible;
- required owner approval is recorded.

The agent itself cannot merge or deploy.

## 9. Conditional independent-review requirement

An additional independent human review is a **risk-based safeguard, not a universal prerequisite**. This section defines when the project may waive only its *extra project-level independent-review step*. It never waives a human approval, status check, environment approval, or other requirement imposed by GitHub, an organization, law, or compliance policy.

The two paths below are alternatives. Path A applies only to routine low-risk changes. Path B is a narrow, documented owner exception for a specific high-risk change. The shared evidence gates below apply to **both** paths.

### Shared evidence gates — required for every waiver

Before either Path A or Path B may waive the project's extra independent-review step, all of the following must be evidenced on the exact commit proposed for merge or release:

- The exact PR, commit SHA, changed-file scope, and diff have been inspected and recorded.
- All applicable required CI, static analysis, CodeQL/security checks, and focused tests pass on that exact HEAD. No relevant check may be skipped, stale, or merely passed on an earlier commit.
- Automated review and security findings have been triaged. No unresolved critical/high finding remains; every actionable finding is fixed or has a documented, justified non-applicability rationale.
- All review threads are resolved. No unresolved actionable review comment remains.
- The threat/risk assessment, affected users and data, mitigations, residual risk, and rollback/containment plan are documented and proportionate to the change.
- The project release gates in Section 8 and every repository/organization branch-protection, ruleset, required-review, and protected-environment requirement remain satisfied.
- The owner has explicitly accepted the residual risk and authorized the specific waiver in a recorded decision.

If a shared gate is not met, the waiver is unavailable. This does **not** prohibit the normal path: the change may proceed through ordinary independent review if that review and every other applicable gate are completed successfully.

### Path A — routine low-risk change

The project may waive its extra independent-review step under Path A only when the change is narrow, reversible where applicable, and demonstrably low risk. It must not:

- alter authentication or authorization behavior, OAuth, secrets or credential handling;
- alter billing, payment, financial controls, or access to paid services;
- alter production infrastructure, DNS, Worker bindings, D1 schema/data, privacy boundaries, or security boundaries;
- alter public publishing permissions or the controls governing external side effects; or
- perform or enable an irreversible public or financial action.

If any exclusion applies or risk classification is uncertain, Path A is unavailable. Use normal independent review or assess the change for the specific Path B exception.

### Path B — exceptional high-risk change

A high-risk or security-sensitive change, including an irreversible public or financial action, is **not eligible for Path A**. The owner may grant a case-specific exception to the project's extra independent-review step only after reviewing the exact diff, threat/risk assessment, affected users and data, mitigations, residual risk, test evidence, and rollback/containment plan.

The written exception must:
- identify the exact PR and commit SHA and the specific independent-review step being waived;
- explain why an independent reviewer is unavailable or why the additional project-level review is disproportionate;
- record the owner's informed acceptance of the specific residual risks and the reasons the change remains acceptably bounded;
- confirm that all shared evidence gates above are satisfied; and
- authorize that exact change only. A new commit or materially changed scope requires a fresh assessment and authorization.

If the exception evidence is incomplete or the risk cannot be bounded, the change **must not proceed under the waiver**. It may still proceed through the normal independent-review path once the review is obtained and all other gates pass; the missing exception evidence is not a prohibition on that ordinary path.

### Non-waivable external requirements

A project-level exception does **not** waive any independent review or approval required by GitHub, repository/organization rulesets, protected environments, law, or compliance. If GitHub or an organization policy requires a human approval, that approval must still be obtained from an eligible reviewer. An AI/bot review or an owner-controlled automation account does not count as an independent human reviewer. Never weaken branch protection or fabricate review/deployment/check statuses to implement this policy.

Waiving the project's extra independent-review step does not skip technical validation, security triage, owner authorization, Preview/rollback evidence, or any applicable release gate. When evidence is missing or uncertain, fail closed for the waiver and retain the normal review requirement.
