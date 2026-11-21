const MAX_BODY_BYTES = 120_000;
const MAX_EXCERPT_CHARS = 600;
const MAX_EVIDENCE_ITEMS = 4;
const TIMEOUT_MS = 6_000;
const ALLOWED = [
  { host: "openai.com", prefix: "/index/" },
  { host: "deepmind.google", prefix: "/blog/" },
  { host: "huggingface.co", prefix: "/blog/" },
  { host: "arxiv.org", prefix: "/abs/" }
];

function allowedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED.some(item =>
      url.hostname === item.host && url.pathname.startsWith(item.prefix)
    ) && !url.username && !url.password && (!url.port || url.port === "443") &&
      !url.search && !url.hash;
  } catch { return false; }
}

async function readBounded(response) {
  if (!response.body) throw new Error("empty_response");
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) throw new Error("page_too_large");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let html = "";
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("page_too_large");
    }
    html += decoder.decode(part.value, { stream: true });
  }
  return html + decoder.decode();
}

function extractExcerpt(html) {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|nav|footer|header|form|noscript|iframe|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  const article = withoutNoise.match(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1\s*>/i)?.[2] || withoutNoise;
  return article
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|h[1-6]|li|section|div)>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(0x10ffff, Number(n))))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(0x10ffff, parseInt(n, 16)))).replace(/\s+/g, " ").trim().slice(0, MAX_EXCERPT_CHARS);
}

async function retrieveOne(signal, fetchImpl, now) {
  if (!signal || !allowedUrl(signal.url)) {
    return { source: signal?.source || "unknown", url: null, status: "rejected_url", excerpt: "" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(signal.url, {
      method: "GET",
      headers: { accept: "text/html,application/xhtml+xml", "user-agent": "DUNG-AI-Research-Evidence/1.0" },
      redirect: "error",
      signal: controller.signal
    });
    if (response.redirected || (response.url && !allowedUrl(response.url))) throw new Error("redirect_or_final_url_rejected");
    if (!response.ok) throw new Error("http_" + response.status);
    const type = (response.headers.get("content-type") || "").toLowerCase();
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) throw new Error("unsupported_content_type");
    const html = await readBounded(response);
    const excerpt = extractExcerpt(html);
    if (excerpt.length < 80) throw new Error("insufficient_page_text");
    return {
      source: signal.source,
      title: String(signal.title || "").slice(0, 120),
      url: signal.url,
      published_at: signal.published_at || null,
      retrieved_at: new Date(now).toISOString(),
      status: "source_retrieved_not_fact_checked",
      excerpt
    };
  } catch (error) {
    return {
      source: signal.source,
      url: signal.url,
      status: String(error?.message || "retrieval_failed").replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80),
      excerpt: ""
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function retrieveResearchEvidence(signals, { fetchImpl = fetch, now = Date.now() } = {}) {
  const candidates = Array.isArray(signals) ? signals.slice(0, MAX_EVIDENCE_ITEMS) : [];
  const evidence = await Promise.all(candidates.map(item => retrieveOne(item, fetchImpl, now)));
  const successful = evidence.filter(item => item.status === "source_retrieved_not_fact_checked");
  return {
    status: successful.length ? "source_retrieval_complete" : "no_source_bodies_retrieved",
    attempts: candidates.length,
    retrieved: successful.length,
    failed: evidence.length - successful.length,
    evidence,
    notice: "Retrieved excerpts preserve source provenance but are not fact-checked, corroborated, originality-checked, or cleared for publication.",
    safety: { read_only: true, raw_html_stored: false, catalog_modified: false, content_published: false }
  };
}
