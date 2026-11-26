import fs from "node:fs/promises";
import path from "node:path";
import { discoverAiBankReleaseSignals } from "../agents/runtime/src/ai-bank-discovery.mjs";

const lookbackDays = Math.min(90, Math.max(1, Number(process.env.AI_BANK_DISCOVERY_DAYS || 90)));
const startAt = process.env.AI_BANK_DISCOVERY_START_AT || "";
if (
  !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(startAt) ||
  !Number.isFinite(Date.parse(startAt))
) {
  throw new Error("AI_BANK_DISCOVERY_START_AT must be a valid persisted UTC cursor");
}
const output = process.env.AI_BANK_DISCOVERY_OUTPUT || "reports/ai-bank/discovery-signals.json";
const report = await discoverAiBankReleaseSignals({ lookbackDays, startAt });

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });

console.log(JSON.stringify({
  status: report.status,
  start_at: report.start_at,
  effective_cutoff: report.effective_cutoff,
  lookback_days: report.lookback_days,
  sources_checked: report.sources_checked,
  sources_succeeded: report.sources_succeeded,
  sources_failed: report.sources_failed.length,
  signal_count: report.signal_count,
  catalog_candidates: report.catalog_candidates.length,
  catalog_write_authorized: report.safety.catalog_modified,
  public_publication_authorized: report.safety.public_content_modified,
  output
}, null, 2));

if (!report.ok) process.exitCode = 1;
