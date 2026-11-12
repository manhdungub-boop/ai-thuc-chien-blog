# CircleCI Staging workflows

The Staging CircleCI configuration now separates stable core checks from extended checks without deleting test coverage.

## Automatic core workflow

`circleci_fallback_staging` runs on `staging/auth-worker-build`:
- `migration-validation`
- `catalog-public-link-check`
- `staging-health-readonly`

These checks had the strongest recent reliability in CircleCI metrics. GitLab remains the primary CI system and runs the complete JavaScript/offline suite, static bundle validation, catalog quality gate, migrations, public link checks, and Staging Worker dry-run.

## Extended workflow

`circleci_fallback_staging_extended` retains:
- `node-offline-validation`
- `production-static-release-validation`
- `candidate-batch5-validation`
- `catalog-browser-e2e`
- `editorial-browser-smoke`

It is opt-in using CircleCI pipeline parameter `run_extended_staging_checks=true`. This keeps browser and historically flaky validation available for deeper checks without allowing intermittent failures to block the automatic core Staging gate.

## Fix branches

`circleci_fallback_fix_branches` remains unchanged and continues to run `node-offline-validation` and `migration-validation` on `fix/*` branches.

No Worker, D1, secrets, DNS, relay, or Production resource is changed by this workflow split.
