# Zero-Cost Provider Admission and Failover Policy

## Purpose

The Agent Runtime may select a provider only when runtime access, task capability, zero-cost classification, and current quota evidence are verified. Quota exhaustion must never trigger paid usage.

## Admission requirements

A provider is eligible for automated runtime execution only when all conditions hold:

1. It is callable from the isolated Agent Runtime, not merely connected as a ChatGPT app.
2. It is healthy and supports the requested task type.
3. Its cost is verified as zero for the current account and operation.
4. A quota observation no older than 15 minutes exists and reports positive remaining capacity.
5. The task type is explicitly allowlisted.

Deterministic local operations may declare `no_external_execution`; they do not require provider quota evidence. Unknown, stale, paid, exhausted, or non-runtime provider records must defer.

## Failover behavior

- Try another provider only if it independently passes every admission requirement.
- If none is eligible, defer the task and preserve the reason.
- Never rotate accounts, change workspaces, start trials, add credits, enable billing, or upgrade plans to bypass a quota.
- Do not repeatedly retry non-retryable billing blocks.
- A ChatGPT connector is not automatically callable from Cloudflare Worker code; a separate authorized runtime adapter is required.
- Social publication and replies require verified API scopes, channel policy checks, and an audit trail.

## Current implementation boundary

This module is a deterministic admission policy, not a quota meter and not an AI inference adapter. It does not query Cloudflare account billing or remaining Workers AI Neurons. The Agent Runtime must remain model-disabled until account-specific Free-plan status, remaining quota, and the actual runtime binding are verified. A published provider free allowance is not proof of the connected account's current entitlement or remaining capacity.

The policy does not itself invoke providers, generate content, publish articles, or post to social networks.
