# Zero-Cost Provider Admission and Failover Policy

## Purpose

Allow the AI Thực Chiến agent runtime to select a verified free provider and fail over to another verified free provider when a quota is exhausted or a provider is unavailable. The policy must never turn a quota failure into paid usage.

## Admission requirements

A provider is eligible for automated runtime execution only when all of the following are true:

1. The provider is explicitly callable from the isolated agent runtime (not merely connected as a ChatGPT app).
2. The provider is healthy and supports the requested task type.
3. Its cost is verified as zero for the current account and operation.
4. A live quota observation is available, no older than 15 minutes, and shows positive remaining capacity.
5. The task type is on the explicit allowlist.

A provider with unknown pricing, stale quota, no runtime adapter, or an exhausted balance is not eligible. The selector returns a defer decision rather than guessing.

## Current integration evidence (2026-11-18)

| Integration | Verified state | Runtime admission |
|---|---|---|
| Cloudflare Workers AI | Official Free allocation is 10,000 Neurons/day; account-level plan, remaining quota, and a runtime AI binding are not yet verified | Not enabled until account and binding checks pass |
| OpenArt | Account reports Free plan and 40 credits; currently listed video models exceed that balance; connector is available in ChatGPT | ChatGPT-side image work only when explicitly invoked; not callable by the isolated Worker |
| InVideo | Connected account reports 0 credits | Blocked until a free allocation is available |
| fal.ai | Connected account reports balance exhausted; pay-as-you-go | Blocked; never retry or add credits |
| Metricool | Connected brand exposes Facebook, TikTok and YouTube; scheduled/published post reads verified | ChatGPT-side integration only; runtime publishing/reply adapter not verified |

Cloudflare documents a 10,000 Neurons/day Free allocation for Workers AI. That published limit does not prove the connected Cloudflare account's current plan or remaining quota. The runtime must obtain account-specific evidence before enabling inference.

## Failover behavior

- If the preferred provider is quota-exhausted, try the next provider only if it independently passes every admission requirement.
- If no eligible provider remains, retain the task as deferred/retryable and report the exact reason.
- Do not rotate accounts, switch workspaces, create billing, start trials, or request a paid upgrade to bypass a quota.
- Do not repeatedly retry a provider that reports a non-retryable billing block.
- A ChatGPT connector is not automatically available to code running in a Cloudflare Worker. A separate, authorized runtime adapter is required.
- Social publication and replies require a verified API scope, channel policy check, and audit trail. Reading a Metricool schedule does not prove that automated comment replies are available.

## Tests

Run:

```sh
node --test agents/runtime/tests/provider-policy.test.mjs
```

The policy tests cover priority selection, quota failover, stale evidence, paid/unknown-cost rejection, connector/runtime separation, exhausted quotas, and task allowlisting.
