# Isolated Adapter Pause E2E: Preview environment policy

GitHub evaluates a `pull_request` deployment against its synthetic merge ref (`refs/pull/<number>/merge`), not the source branch name. For this one-run test, the `agent-runtime-preview` environment must allow only the exact merge ref for this PR. Do not add a wildcard such as `refs/pull/*/merge` or a broad source-branch pattern.

Keep the existing required environment reviewer approval. Remove the exact merge-ref policy after the E2E run, whether it passes or fails. The test Worker is separate from the existing Preview Worker and must be disabled, paused, have both public URL switches disabled, and have its one-run State Store credential removed after the run.
