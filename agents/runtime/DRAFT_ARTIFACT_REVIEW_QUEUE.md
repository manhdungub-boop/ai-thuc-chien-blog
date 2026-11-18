# Draft artifact store and human-review queue

- `AgentDraftStore` is a separate SQLite-backed Durable Object in the isolated Agent Preview Worker. It is not the website D1 database.
- Only article drafts with an exact schema are accepted. Each artifact is limited to 48 KiB and 20 source records.
- Create and revision operations run the deterministic article quality gate. Eligible structures are stored as `pending_human_review`; failed structures are stored as `needs_revision`.
- Revisions use optimistic version checks. Reusing an artifact ID with different content is rejected.
- The queue returns at most 20 metadata-only rows. Full content is retrieved by artifact ID through internal Durable Object RPC.
- There is no public endpoint, approval method, publication method, model provider, external submission, or Production binding.
- The store is infrastructure only: no current supervisor task creates article drafts. Research still consists of read-only source discovery, and factual verification/originality/licensing remain separate gates.
- The additional Durable Object class requires a new Preview migration. Do not deploy until the Preview account/resource boundary and current free-tier quota are verified. Never apply this migration to the website's Production Worker.
