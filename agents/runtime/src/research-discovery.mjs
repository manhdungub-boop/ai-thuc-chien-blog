const MAX_BYTES = 750_000;
const TIMEOUT_MS = 8_000;
const MAX_RESULTS = 4;

export const RESEARCH_FEED_SOURCES = [
  { name: "OpenAI News", host: "openai.com", pathPrefix: "/index/", feed: "https://openai.com/news/rss.xml" },
  { name: "Google DeepMind", host: "deepmind.google", pathPrefix: "/blog/", feed: "https://deepmind.google/blog/rss.xml" },
  { name: "Hugging Face", host: "huggingface.co", pathPrefix: "/blog/", feed: "https://huggingface.co/blog/feed.xml" },
  { name: "arXiv cs.AI", host: "arxiv.org", pathPrefix: "/abs/", feed: "https://rss.arxiv.org/rss/cs.AI" }
];

function cleanText(value, max = 500) {
  return value.replace(/<!\[CDATA\[|\]\]>/g, " ").replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#\d+;|&#x[0-9a-f]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function elementText(xml, name) {
  const match = xml.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
  return match ? match[1] : "";
}

function parseItems(xml, source, cutoff) {
  return [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map(match => {
    const body = match[2];
    const title = cleanText(elementText(body, "title"), 120);
    const summary = cleanText(elementText(body, "description") || elementText(body, "summary") || elementText(body, "content:encoded"), 160);
    const rawLink = body.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] || cleanText(elementText(body, "link"), 300);
    const rawDate = elementText(body, "published") || elementText(body, "updated") || elementText(body, "pubDate") || elementText(body, "dc:date");
    const date = new Date(cleanText(rawDate, 100));
    if (!title || !rawLink || rawLink.length > 300 || !Number.isFinite(date.getTime()) || date.getTime() < cutoff) return null;
    let link;
    try { link = new URL(rawLink); } catch { return null; }
    if (link.protocol !== "https:" || link.hostname !== source.host || link.username || link.password ||
        (link.port && link.port !== "443") || link.search || link.hash || !link.pathname.startsWith(source.pathPrefix)) return null;
    return { source: source.name, title, summary, url: link.href, published_at: date.toISOString() };
  }).filter(Boolean);
}

async function fetchFeed(source, fetchImpl, cutoff) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(source.feed, {
      method: "GET",
      headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml", "user-agent": "DUNG-AI-Research-Discovery/1.0" },
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) throw new Error("http_" + response.status);
    if (Number(response.headers.get("content-length") || 0) > MAX_BYTES) throw new Error("feed_too_large");
    if (!response.body) throw new Error("empty_response");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let xml = "";
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error("feed_too_large"); }
      xml += decoder.decode(part.value, { stream: true });
    }
    xml += decoder.decode();
    return { source, records: parseItems(xml, source, cutoff), error: null };
  } catch (error) {
    return { source, records: [], error: String(error?.message || error).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80) };
  } finally { clearTimeout(timer); }
}

export async function discoverResearchSignals({ fetchImpl = fetch, now = Date.now(), lookbackDays = 14 } = {}) {
  const days = Math.min(60, Math.max(1, Number(lookbackDays) || 14));
  const cutoff = now - days * 86_400_000;
  const results = await Promise.all(RESEARCH_FEED_SOURCES.map(source => fetchFeed(source, fetchImpl, cutoff)));
  const seen = new Set();
  const records = results.flatMap(result => result.records).filter(record => {
    if (seen.has(record.url)) return false;
    seen.add(record.url);
    return true;
  }).sort((a, b) => b.published_at.localeCompare(a.published_at));
  const succeeded = results.filter(result => !result.error).length;
  return {
    ok: succeeded > 0,
    status: succeeded ? "read_only_research_discovery_complete" : "all_sources_failed",
    topic: "AI agents, automation, and open-source AI tools",
    generated_at: new Date(now).toISOString(),
    lookback_days: days,
    sources_checked: results.length,
    sources_succeeded: succeeded,
    sources_failed: results.filter(result => result.error).map(result => ({ source: result.source.name, error: result.error })),
    signal_count: records.length,
    latest_signals: records.slice(0, MAX_RESULTS),
    research_notice: "These are source-discovery signals, not verified factual claims or a publishable article. Read original sources and corroborate material claims before drafting.",
    safety: { read_only: true, catalog_modified: false, content_created: false, public_content_modified: false, deployment_performed: false }
  };
}
