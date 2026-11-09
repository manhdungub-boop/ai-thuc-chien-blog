import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workers = await readFile(new URL("../.github/workflows/deploy-cloudflare-workers.yml", import.meta.url), "utf8");
const pages = await readFile(new URL("../.github/workflows/deploy-cloudflare-pages.yml", import.meta.url), "utf8");

const workerGuard = /if:\s*github\.event_name\s*==\s*'workflow_dispatch'\s*&&\s*github\.ref\s*==\s*'refs\/heads\/main'\s*&&\s*inputs\.confirm_production_worker_and_d1_changes\s*==\s*true/;
assert.match(workers, workerGuard,
  "Production Worker/D1 deployment must require manual dispatch, main ref, and explicit approval input");

const pagesGuard = /if:\s*github\.event_name\s*==\s*'workflow_dispatch'\s*&&\s*github\.ref\s*==\s*'refs\/heads\/main'/;
assert.match(pages, pagesGuard,
  "Production Pages deployment must require manual dispatch from main");

assert.match(pages, /command:\s*pages deploy dist --project-name=ai-thuc-chien-blog --branch=main/,
  "Pages deploy target must remain the named production project and main branch");
assert.doesNotMatch(pages, /^\s*push:/m,
  "Production Pages workflow must not deploy automatically on push");
assert.match(workers, /command:\s*deploy --config wrangler\.deploy\.jsonc/,
  "Production Worker must deploy only through its reviewed production Wrangler config");

console.log("PASS: Production Worker/D1 and Pages workflows require a manual dispatch from main; Worker/D1 also requires explicit approval.");
