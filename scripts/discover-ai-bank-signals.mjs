import fs from "node:fs/promises";
import path from "node:path";

const OUTPUT = process.env.AI_BANK_DISCOVERY_OUTPUT || "reports/ai-bank/discovery-signals.json";
const LOOKBACK_DAYS = Math.min(90, Math.max(1, Number(process.env.AI_BANK_DISCOVERY_DAYS || 30)));
const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 12_000;
const SOURCES = [
  { vendor: "Ollama", product: "Ollama", repo: "ollama/ollama", feed: "https://github.com/ollama/ollama/releases.atom" },
  { vendor: "ComfyUI", product: "ComfyUI", repo: "Comfy-Org/ComfyUI", feed: "https://github.com/Comfy-Org/ComfyUI/releases.atom" },
  { vendor: "Open WebUI", product: "Open WebUI", repo: "open-webui/open-webui", feed: "https://github.com/open-webui/open-webui/releases.atom" },
  { vendor: "n8n", product: "n8n", repo: "n8n-io/n8n", feed: "https://github.com/n8n-io/n8n/releases.atom" },
  { vendor: "AnythingLLM", product: "AnythingLLM", repo: "Mintplex-Labs/anything-llm", feed: "https://github.com/Mintplex-Labs/anything-llm/releases.atom" },
  { vendor: "OpenCode", product: "OpenCode", repo: "anomalyco/opencode", feed: "https://github.com/anomalyco/opencode/releases.atom" },
  { vendor: "whisper.cpp", product: "whisper.cpp", repo: "ggml-org/whisper.cpp", feed: "https://github.com/ggml-org/whisper.cpp/releases.atom" },
  { vendor: "Qdrant", product: "Qdrant", repo: "qdrant/qdrant", feed: "https://github.com/qdrant/qdrant/releases.atom" },
  { vendor: "MLflow", product: "MLflow", repo: "mlflow/mlflow", feed: "https://github.com/mlflow/mlflow/releases.atom" },
  { vendor: "Haystack", product: "Haystack", repo: "deepset-ai/haystack", feed: "https://github.com/deepset-ai/haystack/releases.atom" }
];

function sanitizeFeedTitle(value) {
  // Preserve only plain-text title characters. This removes markup delimiters,
  // entity introducers and control characters without decoding XML entities.
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/[^\p{L}\p{N}\p{M}\s.,:;!?'"()\[\]{}+/_@#%=-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function entries(xml, source) {
  return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map(match => {
    const body = match[1];
    const rawTitle = body.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "";
    const title = sanitizeFeedTitle(rawTitle);
    const link = body.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] || "";
    const updated = body.match(/<updated>([^<]+)<\/updated>/i)?.[1] || "";
    const id = body.match(/<id>([^<]+)<\/id>/i)?.[1] || link;
    const date = new Date(updated);
    if (!title || !link || !Number.isFinite(date.getTime())) return null;
    let parsed;
    try { parsed = new URL(link); } catch { return null; }
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "github.com" ||
      parsed.username ||
      parsed.password ||
      (parsed.port && parsed.port !== "443") ||
      parsed.pathname.split("/").slice(1, 3).join("/") !== source.repo ||
      !parsed.pathname.startsWith(`/${source.repo}/releases/`)
    ) return null;
    return { vendor: source.vendor, product: source.product, repository: source.repo, title, source_url: link, source_id: id, published_at: date.toISOString() };
  }).filter(Boolean);
}
async function fetchFeed(source) {
  const url = new URL(source.feed);
  if (url.protocol !== "https:" || url.hostname !== "github.com") throw new Error("Source is not allowlisted");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { accept: "application/atom+xml", "user-agent": "DUNG-AI-AI-Bank-Discovery/1.0" }, redirect: "error", signal: controller.signal });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) throw new Error("Feed exceeds size limit");
    if (!response.body) throw new Error("Feed has no response body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let body = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        throw new Error("Feed exceeds size limit");
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return { source, records: entries(body, source), error: null };
  } catch (error) {
    return { source, records: [], error: String(error?.message || error).slice(0, 240) };
  } finally { clearTimeout(timer); }
}
const cutoff = Date.now() - LOOKBACK_DAYS * 86400_000;
const results = await Promise.all(SOURCES.map(fetchFeed));
const seen = new Set();
const signals = results.flatMap(result => result.records).filter(record => {
  if (new Date(record.published_at).getTime() < cutoff || seen.has(record.source_url)) return false;
  seen.add(record.source_url);
  return true;
}).sort((a, b) => b.published_at.localeCompare(a.published_at));
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  lookback_days: LOOKBACK_DAYS,
  mode: "read_only_discovery_signals",
  sources_checked: results.length,
  sources_succeeded: results.filter(x => !x.error).length,
  sources_failed: results.filter(x => x.error).map(x => ({ repository: x.source.repo, error: x.error })),
  signal_count: signals.length,
  signals,
  review_notice: "Release activity is only a discovery signal. It does not verify product availability, pricing, free-tier limits, license scope, privacy, regional access, or suitability. Do not import or publish a record from this report without independent official-source review.",
  safety: { catalog_modified: false, public_content_modified: false, deployment_performed: false, secrets_used: false, external_submission: false }
};
await fs.mkdir(path.dirname(OUTPUT), { recursive: true });
await fs.writeFile(OUTPUT, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
console.log(JSON.stringify({ sources_checked: report.sources_checked, sources_succeeded: report.sources_succeeded, sources_failed: report.sources_failed.length, signal_count: report.signal_count, output: OUTPUT }, null, 2));
