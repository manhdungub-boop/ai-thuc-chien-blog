const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 10_000;
const MAX_SIGNALS = 5;

export const AI_BANK_RELEASE_SOURCES = [
  { vendor: "Ollama", product: "Ollama", repo: "ollama/ollama" },
  { vendor: "ComfyUI", product: "ComfyUI", repo: "Comfy-Org/ComfyUI" },
  { vendor: "Open WebUI", product: "Open WebUI", repo: "open-webui/open-webui" },
  { vendor: "n8n", product: "n8n", repo: "n8n-io/n8n" },
  { vendor: "AnythingLLM", product: "AnythingLLM", repo: "Mintplex-Labs/anything-llm" },
  { vendor: "OpenCode", product: "OpenCode", repo: "anomalyco/opencode" },
  { vendor: "whisper.cpp", product: "whisper.cpp", repo: "ggml-org/whisper.cpp" },
  { vendor: "Qdrant", product: "Qdrant", repo: "qdrant/qdrant" },
  { vendor: "MLflow", product: "MLflow", repo: "mlflow/mlflow" },
  { vendor: "Haystack", product: "Haystack", repo: "deepset-ai/haystack" }
].map(source => ({
  ...source,
  feed: "https://github.com/" + source.repo + "/releases.atom"
}));

function sanitizeTitle(value) {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&[^;\s]+;/g, " ")
    .replace(/[^\p{L}\p{N}\p{M}\s.,:;!?'"()\[\]{}+/_@#%=-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function parseEntries(xml, source, cutoff) {
  return [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)]
    .map(match => {
      const body = match[1];
      const title = sanitizeTitle(body.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "").slice(0, 140);
      const link = body.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] || "";
      const updated = body.match(/<updated>([^<]+)<\/updated>/i)?.[1] || "";
      const date = new Date(updated);
      if (!title || !link || !Number.isFinite(date.getTime()) || date.getTime() < cutoff) return null;
      let parsed;
      try { parsed = new URL(link); } catch { return null; }
      if (
        parsed.protocol !== "https:" ||
        parsed.hostname !== "github.com" ||
        parsed.username ||
        parsed.password ||
        (parsed.port && parsed.port !== "443") ||
        parsed.search ||
        parsed.hash ||
        !parsed.pathname.startsWith("/" + source.repo + "/releases/")
      ) return null;
      return {
        vendor: source.vendor,
        product: source.product,
        repository: source.repo,
        title,
        source_url: link,
        published_at: date.toISOString()
      };
    })
    .filter(Boolean);
}

async function fetchSource(source, fetchImpl, cutoff) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(source.feed, {
      method: "GET",
      headers: {
        accept: "application/atom+xml",
        "user-agent": "DUNG-AI-AI-Bank-Discovery/1.0"
      },
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) throw new Error("http_" + response.status);
    const declaredBytes = Number(response.headers.get("content-length") || 0);
    if (declaredBytes > MAX_BYTES) throw new Error("feed_too_large");
    if (!response.body) throw new Error("empty_response");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let xml = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) {
        await reader.cancel();
        throw new Error("feed_too_large");
      }
      xml += decoder.decode(chunk.value, { stream: true });
    }
    xml += decoder.decode();
    return { source, records: parseEntries(xml, source, cutoff), error: null };
  } catch (error) {
    return {
      source,
      records: [],
      error: String(error?.message || error).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 100)
    };
  } finally {
    clearTimeout(timer);
  }
}

function buildCatalogCandidates(signals, discoveredAt) {
  const latestByRepository = new Map();
  for (const signal of signals) {
    const repository = String(signal.repository || "").trim().toLowerCase();
    if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(repository)) continue;
    const existing = latestByRepository.get(repository);
    if (!existing || signal.published_at > existing.published_at) {
      latestByRepository.set(repository, signal);
    }
  }
  return [...latestByRepository.entries()]
    .sort((a, b) => b[1].published_at.localeCompare(a[1].published_at))
    .slice(0, MAX_SIGNALS)
    .map(([repository, signal]) => ({
      candidate_id: "github:" + repository,
      name: signal.product,
      provider: signal.vendor,
      repository,
      latest_release: {
        title: signal.title,
        source_url: signal.source_url,
        published_at: signal.published_at
      },
      discovered_at: new Date(discoveredAt).toISOString(),
      evidence_type: "github_release_activity_only",
      review_status: "needs_official_source_review",
      pricing_status: "unverified",
      free_limits_status: "unverified",
      license_status: "unverified",
      privacy_status: "unverified",
      platform_support_status: "unverified",
      regional_availability_status: "unverified",
      required_checks: [
        "official_product_domain",
        "pricing_and_free_limits",
        "license_scope",
        "privacy_and_data_handling",
        "platform_support",
        "regional_availability"
      ],
      catalog_write_authorized: false,
      public_publication_authorized: false
    }));
}

export async function discoverAiBankReleaseSignals({
  fetchImpl = fetch,
  now = Date.now(),
  lookbackDays = 30
} = {}) {
  const boundedDays = Math.min(90, Math.max(1, Number(lookbackDays) || 30));
  const cutoff = now - boundedDays * 86_400_000;
  const results = await Promise.all(
    AI_BANK_RELEASE_SOURCES.map(source => fetchSource(source, fetchImpl, cutoff))
  );
  const seen = new Set();
  const signals = results.flatMap(result => result.records)
    .filter(record => {
      if (seen.has(record.source_url)) return false;
      seen.add(record.source_url);
      return true;
    })
    .sort((a, b) => b.published_at.localeCompare(a.published_at));
  const succeeded = results.filter(result => !result.error).length;
  return {
    ok: succeeded > 0,
    status: succeeded === 0 ? "all_sources_failed" : "read_only_discovery_complete",
    generated_at: new Date(now).toISOString(),
    lookback_days: boundedDays,
    sources_checked: results.length,
    sources_succeeded: succeeded,
    sources_failed: results.filter(result => result.error).map(result => ({
      repository: result.source.repo,
      error: result.error
    })),
    signal_count: signals.length,
    latest_signals: signals.slice(0, MAX_SIGNALS),
    catalog_candidates: buildCatalogCandidates(signals, now),
    review_notice: "Release activity is a discovery signal only. It does not verify current pricing, free-tier limits, license scope, privacy, regional access, or suitability. Independent official-source review is required before catalog changes or publication.",
    safety: {
      catalog_modified: false,
      public_content_modified: false,
      deployment_performed: false,
      secrets_used: false,
      external_submission: false
    }
  };
}
