# Zero-Cost Provider Admission and Failover Policy

## Purpose

The Agent Runtime may select a provider only when runtime access, task capability, zero-cost classification, and trustworthy quota evidence are verified. Quota exhaustion must never trigger paid usage.

## Admission requirements

A provider is eligible for automated runtime execution only when all conditions hold:

1. It is callable from the isolated Agent Runtime, not merely connected as a ChatGPT app.
2. It is healthy and supports the requested task type.
3. Its cost is verified as zero for the current account and operation.
4. External inference has a trusted, runtime-owned quota adapter that obtains authoritative evidence; a provider-supplied quota object is not sufficient.
5. The quota evidence is current and reports positive remaining capacity.
6. The task type is explicitly allowlisted.

The only currently allowlisted `no_external_execution` implementation is the repository's deterministic `article-quality-gate`, and only for `quality_review`. A provider cannot bypass quota checks merely by self-declaring that it performs no external execution.

**No external inference provider is currently authorized.** The external adapter allowlist is intentionally empty until the runtime has a verified account-level usage source and a bounded local reservation mechanism. All external provider candidates must defer, even if their input object claims a fresh positive quota.

## Cloudflare Workers AI quota evidence

Cloudflare documents a 10,000 Neurons/day Free allocation and says usage can be monitored in the Workers AI dashboard. This published allowance is not proof of the account's current plan or remaining capacity.

Cloudflare's Billable Usage API is documented as Alpha/Restricted and returns daily usage records. It is not documented as a real-time remaining-Neurons endpoint. A read-only request made during implementation returned HTTP 403 with the connected API credential. Cloudflare's billing documentation says billing API tokens require Account > Billing > Read (or Edit). No token permissions or secrets were changed.

Daily billable-usage records may later support reconciliation, if access is explicitly granted and the returned records are validated. They must not be treated as real-time quota headroom by themselves.

## Additional cost-control findings (verified 2026-11-19)

- Cloudflare documents 10,000 Workers AI Neurons per day at no charge on Workers Free, resetting at 00:00 UTC. Usage above that allocation requires Workers Paid and is billed at the published rate. Some models separately require a paid billing method. The dashboard is the documented way to monitor Neuron usage; this does not expose a runtime-callable real-time remaining-quota API. See [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).
- Cloudflare AI Gateway spend limits can block routed requests when a dollar budget is reached, but enforcement is eventually consistent: concurrent requests can briefly exceed the configured limit. Cost tracking is a best-effort estimate. Therefore this is not a strict zero-cost guarantee. See [AI Gateway spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/).
- Cloudflare's account spending limits for Workers and Durable Objects explicitly exclude Workers AI. They cannot be used as an account-wide hard stop for model inference. See [Cloudflare spending limits](https://developers.cloudflare.com/billing/manage/spend-management/).
- Consequently, neither the Workers/Durable Objects spending limit nor AI Gateway's eventually consistent dollar budget is accepted as authoritative proof of zero-cost remaining Workers AI capacity.

**Decision:** Keep external inference disabled. Do not add prepaid credits, enable billing, upgrade plans, or rely on a best-effort cost budget as a zero-cost quota adapter. Reconsider only after a supported, account-authorized control can prove the exact free-plan state and reserve sufficient capacity before every inference request.

## Failover behavior

- Try another provider only if it independently passes every admission requirement.
- If none is eligible, defer the task and preserve the reason.
- Never rotate accounts, change workspaces, start trials, add credits, enable billing, or upgrade plans to bypass a quota.
- Do not repeatedly retry non-retryable billing blocks.
- A ChatGPT connector is not automatically callable from Cloudflare Worker code; a separate authorized runtime adapter is required.
- Social publication and replies require verified API scopes, channel policy checks, and an audit trail.

## Current implementation boundary

This module is a deterministic admission policy, not an AI inference adapter. It does not invoke providers, query Cloudflare billing, or publish content. The Runtime must remain model-disabled until account-specific Free-plan status, a trustworthy quota source, and the actual runtime binding are verified.

The policy does not itself generate content, publish articles, or post to social networks.
