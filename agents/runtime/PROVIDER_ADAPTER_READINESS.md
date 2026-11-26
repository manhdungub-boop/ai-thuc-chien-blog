# Verified Free Provider Adapter Readiness Gate

Status: design gate only. No provider is enabled by this document.

## Decision

Cloudflare Workers AI is the first candidate for an isolated Agent Runtime Preview adapter because it can be called through a Workers AI binding (`env.AI.run`) without placing a long-lived API token in application code.

This is not approved for execution. The account owner supplied Cloudflare dashboard evidence confirming Workers Free tier Active, Durable Objects Free tier, no payment method on file, no invoices, and no spend-limit history activity. This closes the base-plan verification gate only. The Agent Runtime Preview Worker and Durable Object namespace are not deployed/provisioned. Workers AI model eligibility, Neurons usage/headroom, model-specific paid requirements, and provider-level quota evidence remain unverified. Do not add an active binding, execute inference, or deploy based only on public pricing documentation.

## Publicly documented constraints checked on 2026-11-20

- Cloudflare documents a Workers AI Free allocation of 10,000 Neurons per day, resetting at 00:00 UTC.
- On Workers Free, usage above the free allocation is unavailable; on Workers Paid, usage above the allocation is billed.
- Some models require a paid billing method. Model eligibility must be checked against the current official model catalog and pricing documentation immediately before implementation.
- A Workers AI binding exposes `env.AI.run(model, input)`; binding configuration belongs only in the isolated Preview Worker until all gates pass.
- Cloudflare documents that Workers AI calls access the Cloudflare account even during local development. Do not run live inference in local development or CI.

Official references:
- https://developers.cloudflare.com/workers-ai/platform/pricing/
- https://developers.cloudflare.com/workers-ai/configuration/bindings/
- https://developers.cloudflare.com/changelog/product/workers-ai/

## Mandatory account and cost gates

Before implementing or enabling the adapter, verify all of the following from the Cloudflare account itself:

1. **Verified at account level:** the owner-supplied dashboard shows Workers Free tier Active and Durable Objects Free tier. The Agent Runtime Preview itself is not deployed. Recheck this gate if account subscriptions change.
2. No paid AI credits, paid-only model entitlement, or automatic paid upgrade is required for the selected model.
3. The exact model ID is currently available to Workers Free.
4. Account usage can be observed independently; public documentation alone is not quota evidence.
5. A hard application-side admission ceiling is configured below the provider's published free allocation, with a safety reserve.
6. The dashboard's `Spectrum: No data` view is Spectrum-only and is not evidence of Workers AI usage. `No invoices` and no payment method do not prove that every Cloudflare product is incapable of billable usage. If provider entitlement, usage, or quota evidence cannot be verified, inference remains disabled.

If the account is on a paid plan or its billing state is ambiguous, do not call the provider. A software-side token estimate is not a substitute for the provider's Neurons accounting.

## Runtime adapter contract

A future adapter must:

- Be code-registered in `VERIFIED_EXTERNAL_PROVIDER_ADAPTERS`; provider-supplied metadata must never self-authorize an adapter.
- Accept only allowlisted task types and model IDs.
- Use the runtime's budget-enforcing admission path before every inference call.
- Enforce strict input size, output-token, timeout, concurrency, and per-day limits.
- Record provider, model, task ID, request ID, observed usage metadata (when returned), and quota-evidence timestamp without logging prompts containing secrets or personal data.
- Classify quota exhaustion, rate limiting, model unavailability, timeout, and malformed responses separately.
- Never retry a non-idempotent inference indefinitely.
- Never switch to a paid provider, paid model, credit-backed gateway, or unverified endpoint.
- Fail closed when quota evidence is missing or stale.

## Fallback semantics

Do not treat multiple models under the same Workers AI account as independent quota fallbacks: they share the account's Workers AI allocation. Switching models does not create a new free quota.

A fallback is permitted only when it is a separately verified provider with its own independent free allocation, runtime-callable adapter, current quota evidence, and explicit no-billing guarantee. Otherwise defer the task to the durable queue and retry after the provider's documented reset or an operator review.

## Preview-only implementation sequence

1. Base plan and billing evidence has been verified from the owner's dashboard; do not change billing settings. Separately verify Workers AI model eligibility and actual Neurons usage before any inference.
2. Select one currently Free-eligible model and capture dated evidence.
3. Implement adapter unit tests with a mocked AI binding; tests must never invoke live inference.
4. Add the AI binding to `wrangler.preview.jsonc` only; do not touch production `wrangler.jsonc`, Worker, DNS, or D1.
5. Keep `AGENT_ENABLED=false`, `AGENT_PAUSED=true`, OAuth disabled, and Cron absent.
6. Run offline tests, type generation, and Wrangler dry-run.
7. Only after explicit Preview deployment authorization, configure the least-privilege Preview binding and perform a single bounded smoke test within the verified free allocation.
8. Capture actual usage evidence, test quota exhaustion and fail-closed behavior, then reassess.

## Acceptance criteria

- [x] Base Cloudflare Workers and Durable Objects plan labels verified from owner-supplied account evidence (Workers Free; Durable Objects Free; no payment method; no invoices). This does not verify Workers AI model entitlement or quota.
- [ ] Selected model verified Free-eligible on the test date.
- [ ] No paid credits, paid-only model, or paid gateway is used.
- [ ] Runtime-owned quota evidence is fresh and independently sourced.
- [ ] Internal hard ceiling and safety reserve are tested.
- [ ] Unit tests cover quota exhaustion, stale evidence, 429, 403 paid-only model, 5xx, timeout, malformed output, and no-paid-fallback.
- [ ] Preview-only Wrangler configuration is validated.
- [ ] No live inference occurs in CI or local development.
- [ ] No Production, DNS, D1, OAuth, Cron, website publishing, or social publishing change is included.

Until every applicable item passes, `providerPolicy.externalProviderIds` must remain empty and external inference must continue to defer.
