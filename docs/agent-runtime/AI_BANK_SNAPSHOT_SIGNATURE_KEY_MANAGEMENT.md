# AI Bank Snapshot Signature and Key Management Design

Status: design proposal only; not implemented or production-approved in the consolidated Runtime.

## 1. Current verified boundary

The current consolidated Runtime source and test inventory contains no Ed25519 snapshot-signing module, trusted-key registry, snapshot export/import path, or key-custody implementation. Historical prototype test evidence is not treated as validation of the current Runtime. No production signing key or trusted-key set exists in this branch.

Any future prototype must use ephemeral keypairs in an isolated emulator first. It must not persist private keys, create a production backup artifact, provide an export/import endpoint, or claim secure key custody until separately implemented and reviewed.

SHA-256 is an integrity digest, not proof of who created a snapshot. Ed25519 verification proves that a signer possessing the corresponding private key signed the exact canonical manifest bytes, provided the verifier already trusts the public key.

## 2. Proposed manifest envelope

A future versioned manifest should bind at least:
- format identifier and format version;
- canonicalization algorithm/version;
- dataset identifier and logical environment identifier;
- source Durable Object namespace/class identifier (never credentials);
- schema version or migration fingerprint;
- unique snapshot identifier;
- creation timestamp in UTC;
- per-table row counts and SHA-256 digests;
- aggregate manifest SHA-256;
- signer key identifier and signature algorithm in a detached signature envelope.

The signature must cover the canonical manifest bytes. The detached envelope should include the manifest digest, algorithm, key identifier, and signature. The signature envelope itself must not be included in the bytes it signs.

Do not include access tokens, OAuth secrets, session cookies, private keys, or other credentials in the manifest or snapshot.

## 3. Key custody decision

No production signing key is approved or created by this change.

Preferred initial posture:
1. Generate the Ed25519 private key in a controlled offline environment.
2. Keep the private key outside the repository, Worker source, D1, Durable Object storage, and public artifacts.
3. Keep at least two separately protected offline recovery copies, with access and recovery procedures documented by the owner.
4. Distribute only the public key and immutable key identifier to the verifier's trusted-key configuration.
5. Never log, print, commit, paste into chat, or put private-key bytes in GitHub Actions logs or artifacts.

An automated Worker-held signing key would place signing authority in the same runtime trust boundary as the backup process. It must not be described as offline or independently protected. A managed HSM/KMS is not assumed because paid services are prohibited unless separately approved.

If no safe offline signing workflow and private-key recovery method exist, do not enable signed production backups. Continue with emulator-only tests.

## 4. Rotation and revocation

Use explicit key states in an operator-controlled trust registry:
- active: may verify newly created snapshots;
- verify_only: retained temporarily to verify historical snapshots, but cannot sign;
- revoked: reject signatures, including historical ones, unless an explicitly documented incident-recovery exception is approved.

Rotation procedure:
1. Create a new keypair offline and assign a never-reused key ID.
2. Add the new public key to the verifier trust set.
3. Verify a test snapshot signed by the new key.
4. Switch the signing process to the new key.
5. Retain the old public key as verify_only only for a defined migration window.
6. Revoke the old key after the owner verifies recovery requirements and historical retention policy.
7. Record the change in an append-only, access-controlled change log.

A key ID is an identifier, not a secret. Do not reuse an ID for replacement key material.

## 5. Restore acceptance policy

A future restore tool must fail closed unless all checks pass:
- supported manifest format and canonicalization version;
- expected dataset and environment;
- supported schema/migration fingerprint;
- valid manifest digest and trusted signature;
- key state permits verification;
- snapshot age and restore target are explicitly approved;
- all table digests and row counts match;
- schema and foreign-key/relationship checks pass;
- restore target is a fresh isolated Durable Object identity or a separately approved disposable target.

Reject unknown, revoked, malformed, downgraded, cross-environment, or unexpected snapshots before any destination write. Do not use a valid signature as permission to restore into Production.

## 6. Operational limits and no-go conditions

Until independently reviewed, do not add production export/import endpoints; store signing private keys in Worker bindings, repository files, D1, Durable Objects, or CI artifacts; schedule automatic backups or restores; upload reviewer evidence to public or unapproved storage; prune audit history to make space; claim off-site backup, key escrow, RPO/RTO, or disaster-recovery readiness; or perform Production restore drills or alter Production resources.

The project currently has no verified off-site backup destination, tested key recovery process, or measured RPO/RTO. This remains a design gap.

## 7. Next safe validation

Continue in the disposable emulator:
1. Test signature verification against a public key imported from raw bytes.
2. Test explicit key states (active, verify_only, revoked).
3. Test manifest context binding (environment, schema fingerprint, snapshot ID).
4. Test unknown format/canonicalization versions and malformed envelope rejection.
5. Keep all private test keys ephemeral and ensure no key material is logged.

Only after these tests pass should a separate security review consider a production key custody proposal. No production implementation is authorized by this document.