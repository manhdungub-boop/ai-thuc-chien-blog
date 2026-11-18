# Agent Task Contract

Every delegated task uses this contract. The Manager Agent must not create a task whose cost, permissions, data scope, or acceptance criteria are unknown.

```json
{
  "task_id": "stable-id",
  "goal": "one measurable outcome",
  "state": "RECEIVED",
  "assigned_agent": "research",
  "dependencies": [],
  "allowed_tools": [],
  "permission_scope": "read_only",
  "cost_class": "no_external_execution",
  "data_class": "public",
  "acceptance_criteria": [
    "Each factual claim has a primary or authoritative source",
    "Uncertainties are explicitly listed"
  ],
  "evidence": [],
  "blockers": [],
  "owner_action_required": false,
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

## State transitions

- `RECEIVED → TRIAGED`: request understood and safety/cost/data scope classified.
- `TRIAGED → PLANNED`: task split, dependencies and acceptance criteria recorded.
- `PLANNED → IN_PROGRESS`: all required tools are authorized and cost is verified.
- `IN_PROGRESS → REVIEW`: deliverable and evidence assembled.
- `REVIEW → DONE`: acceptance criteria pass.
- Any active state may move to `BLOCKED` when a permission, cost, source, or test dependency is missing.
- `CANCELLED` is terminal.

## Delegation rules

- Delegate the smallest independently verifiable unit of work.
- One task has one accountable specialist; Manager retains coordination responsibility.
- Do not delegate a task that requires an unavailable tool or unapproved permission.
- QA reviews the work of other specialists; an agent cannot self-certify a high-risk change.
- Release assessment is separate from implementation and never performs the release.

## Completion report

The Manager's report includes:
1. outcome and status;
2. changed files/resources (or "none");
3. tests/checks actually run and exact results;
4. evidence links;
5. cost/permission status;
6. unresolved risks and owner actions;
7. next safe step.
