# AI Bank read-only discovery

## Purpose
Create a small, auditable stream of official release signals to help editors notice active AI tools and projects. This is discovery assistance, not automated product verification.

## Current source scope
The collector reads only the fixed public GitHub Atom release feeds for Ollama, ComfyUI, Open WebUI, n8n, AnythingLLM, OpenCode, whisper.cpp, Qdrant, MLflow and Haystack. It does not accept URLs from user input or from feed contents. Redirects are rejected, each request has a 12-second timeout, and each response is capped at 1 MB.

## Output
The workflow writes `reports/ai-bank/discovery-signals.json` as a 30-day rolling report (manual dispatch supports 1–90 days). It retains source repository, official release URL, release title and publication date. Feed failures are reported separately; they are not silently treated as zero activity.

## Important limitations
- A release signal is not proof of a new product, a free plan, current pricing, regional availability, a license for model weights, privacy posture, or iPhone compatibility.
- This initial phase watches a curated set of upstream projects; it does not discover every newly launched commercial AI product.
- Signals must be compared against `data/ai-tools.json` and the candidate queue, then independently checked against official pricing, license, privacy and product documentation.
- No automatic candidate insertion or public publishing occurs in this workflow.

## Security and cost
- GitHub Actions permissions are `contents: read` only.
- Checkout credentials are not persisted; no secrets or API keys are used.
- No external service receives project files or user data. Only public GET requests are made to the fixed GitHub feeds.
- The job creates an artifact only. It does not commit files, create PRs, deploy Workers, modify DNS/D1, or touch production.
- Scheduled execution uses GitHub Actions free allowance where available; if the account quota is exhausted, it will not be able to run until quota returns. No paid upgrade or billing is requested.
