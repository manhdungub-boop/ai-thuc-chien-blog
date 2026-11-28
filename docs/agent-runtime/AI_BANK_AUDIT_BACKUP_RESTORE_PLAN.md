# AI Bank Audit Backup and Restore Plan

Status: design only; not implemented or operationally enabled.
Current integration baseline: Agent Runtime PR #327; writer authorization integrated in commit 3000bb6638be9ab7b791ff4c9870bae1f1e488bd (PR #365).
Scope: `AgentAIBankCandidateStore` Durable Object SQLite state in `agents/runtime/src/ai-bank-candidate-store.mjs`.

## 1. Current verified design constraints

The current candidate store creates these related tables:

- `ai_bank_candidates`
- `ai_bank_review_evidence`
- `ai_bank_review_evidence_releases`
- `ai_bank_evidence_audit_events`

Accepted evidence writes run in a synchronous SQLite transaction. The audit event is inserted in the same transaction as the evidence and release association. Event IDs are unique. Replays are rejected. Accepted audit writes are limited to 100 per UTC day and 10,000 over the lifetime of this store. When the lifetime cap is reached, new writes fail closed with HTTP 503.

There is currently no verified audit export endpoint, off-site backup target, restore command, or completed restore drill for this Agent Runtime store. Do not infer backup readiness from the existence of SQLite tables or passing emulator tests.

## 2. Data sensitivity and threat model

Audit rows contain reviewer subject, reviewer email, request fingerprint, evidence identifier, event identifier, and timestamp. Evidence rows can contain excerpts submitted by a reviewer. Treat the complete snapshot as confidential operational data.

Threats to address:

- unauthorized export or disclosure of reviewer identity and evidence;
- partial export that silently omits rows;
- tampered, reordered, duplicated, or cross-store snapshot parts;
- restore into the wrong namespace or environment;
- replay of already-accepted event IDs after restore;
- schema drift between export and restore;
- a restore that exceeds the configured lifetime audit capacity;
- accidental overwrite or deletion of the only valid copy.

No public HTTP export/import route should be added. No credentials, session cookies, OAuth tokens, or Cloudflare secrets belong in a backup artifact.

## 3. Proposed snapshot contract

A future export should be an operator-initiated, read-only operation executed from a separately authorized maintenance path. It must not be callable by an ordinary reviewer session or public request.

The snapshot should include:

- a format identifier and monotonically increasing format version;
- source environment and Durable Object logical identity (non-secret identifiers only);
- schema/migration fingerprint and export timestamp;
- exact row counts for all four tables;
- deterministic, explicitly ordered records from all four tables;
- per-table SHA-256 digests over canonical UTF-8 serialization;
- a manifest digest covering metadata, counts, table digests, and format version.

Canonicalization must define object-key order, UTF-8 encoding, timestamp representation, null handling, and line endings. A digest detects accidental or malicious modification only when the expected manifest digest is protected separately; it does not prove who created the snapshot. A future design should sign the manifest with a server-held key that is not included in the export.

For bounded memory, export should be paginated with a fixed maximum page size and stable keyset cursors. It must not load an unbounded table into Worker memory. Every page must be bound to the same snapshot generation; if the source changes during export, abort and restart rather than mixing generations.

## 4. Proposed restore protocol

Restore must be a separate, explicitly authorized maintenance operation and must never be exposed as a public API.

1. Verify the manifest signature, format version, schema fingerprint, every page digest, table digest, and row count before writing anything.
2. Validate every row against the expected schema and constraints; reject unknown fields, invalid timestamps, duplicate primary keys, broken evidence/release references, and unsupported repositories.
3. Restore only into a newly created isolated Durable Object identity or disposable test namespace. Never overwrite the existing object in place.
4. Import in deterministic dependency order: candidates, evidence, evidence-release associations, then audit events.
5. Perform import batches atomically and make each batch idempotent by snapshot ID plus batch digest.
6. Verify post-restore row counts, unique event IDs, referential consistency, all audit-to-evidence references, and per-table digests.
7. Verify that a previously accepted event ID is still rejected as a replay and that a new event is subject to the existing daily and lifetime caps.
8. Keep the restored namespace isolated until an independently reviewed cutover plan exists. Do not change Production bindings as part of the restore operation.

If imported audit rows exceed 10,000, reject the restore. Do not raise or bypass the cap automatically. Any future capacity change requires a separate reviewed policy and tests.

## 5. Recovery objectives and operational controls

No RPO or RTO is claimed yet. They must be measured in a disposable environment before the service can claim recoverability.

Required evidence before calling backup/restore ready:

- export of a representative populated test store;
- detection of a modified byte, missing page, reordered page, duplicate row, and mismatched manifest;
- interrupted export that fails closed and can be safely restarted;
- restore into a fresh isolated namespace;
- interrupted restore followed by idempotent resume;
- exact before/after row-count and digest reconciliation;
- replay protection after restore;
- cap enforcement after restore;
- proof that the source namespace remained unchanged;
- a documented retention and access-control policy for backup files;
- an independently reviewed recovery runbook.

Backup storage must use a free, already-authorized destination with private access and encryption. Do not introduce a paid service, enable billing, or store reviewer data in a public Git repository. If no suitable free private destination is available, keep export as a controlled manual maintenance operation and state that off-site backup is unavailable.

## 6. Explicit non-goals

This plan does not authorize:

- adding a public export/download or restore endpoint;
- automatic backup schedules;
- deletion, pruning, compaction, or expiry of audit history;
- increasing the 10,000-event cap;
- production namespace changes or binding cutover;
- publishing evidence, catalog entries, articles, or social posts.

## 7. Decision

Proceed with design and disposable emulator tests only. Keep Agent Runtime disabled and paused. Do not claim audit backup, disaster recovery, or 24/7 operational readiness until the required evidence above exists and has been independently reviewed.
