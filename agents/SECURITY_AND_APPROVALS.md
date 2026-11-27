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

An additional independent human review is a **risk-based safeguard, not a universal prerequisite**. The project may skip that extra review for a change only when **all** of the following are evidenced on the exact commit proposed for merge or release:

- The change is low risk and narrowly scoped; it does not alter authentication or authorization behavior, OAuth, secrets or credential handling, billing or payment controls, production infrastructure, DNS, Worker bindings, D1 schema/data, privacy boundaries, or public publishing permissions.
- All applicable required CI, static analysis, CodeQL/security checks, and focused tests pass on the exact HEAD; no relevant check is skipped, stale, or merely passed on an earlier commit.
- Automated review/security findings have been triaged; no unresolved critical/high finding remains, and all actionable findings are fixed or documented with a justified non-applicability rationale.
- All review threads are resolved, the diff and changed-file scope have been inspected, and the rollback/containment path is clear where applicable.
- The owner has explicitly accepted the residual risk and authorized proceeding without the extra independent review.
- The project release gates in Section 8 and every repository/organization branch-protection or ruleset requirement remain satisfied.

Independent review remains required by project policy for high-risk or security-sensitive changes, including authentication/authorization, OAuth, secrets, billing, production infrastructure, data/privacy boundaries, and irreversible public or financial actions, unless the owner records a specific, informed exception for that exact change after reviewing the residual risk. A blanket instruction does not waive such a case-specific exception.

**This section never bypasses GitHub rulesets, required approvals, required status checks, environment approvals, or legal/compliance obligations.** If GitHub or an organization policy requires a human approval, that approval must still be obtained from an eligible reviewer; an AI/bot review or an owner-controlled automation account does not count as an independent human reviewer. Do not weaken branch protection to implement this policy.

Skipping the *extra independent review* does not skip technical validation, security triage, owner authorization, Preview/rollback evidence, or any applicable release gate. If evidence is missing or uncertain, fail closed and retain the review requirement.
