import fs from "node:fs/promises";
import assert from "node:assert/strict";

const feeds = [
  { name: "OpenAI News", url: "https://openai.com/news/rss.xml", host: "openai.com" },
  { name: "Google DeepMind", url: "https://deepmind.google/blog/rss.xml", host: "deepmind.google" },
  { name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", host: "huggingface.co" },
  { name: "Google AI", url: "https://blog.google/innovation-and-ai/technology/ai/rss/", host: "blog.google" },
  { name: "AWS Machine Learning", url: "https://aws.amazon.com/blogs/machine-learning/feed/", host: "aws.amazon.com" }
];

const MAX_BYTES = 1_500_000;
const MAX_ITEMS_PER_FEED = 20;
const MAX_FEED_ITEMS_SCAN = 100;
const timeoutMs = 12_000;

function decodeXml(value = "") {
  const entities = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" };
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>|&(?:amp|lt|gt|quot|apos|#39);/g,
    (match, cdata) => cdata === undefined ? entities[match] : cdata);
}
function tag(block, name) {
  const re = new RegExp("<(?:[\\w.-]+:)?" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?" + name + "\\s*>", "i");
  return decodeXml(block.match(re)?.[1]?.trim() || "");
}
function markdownText(value = "") {
  return String(value).replace(/\s+/g, " ").replace(/[\u0060\\*_{}\[\]()#+.!|<>]/g, character => "\\" + character).trim();
}
function safeItemLink(raw, expectedHost) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.hostname !== expectedHost || u.username || u.password || (u.port && u.port !== "443")) return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) u.searchParams.delete(key);
    }
    return u.toString();
  } catch { return null; }
}
function parseFeedItems(body, feed, enabledAtMs) {
  if (!Number.isFinite(enabledAtMs)) throw new Error("rss_activation_timestamp_required");
  const blocks = [...body.matchAll(/<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)\s*>/gi)]
    .slice(0, MAX_FEED_ITEMS_SCAN);
  const items = [];
  for (const match of blocks) {
    const block = match[1];
    const rawLink = tag(block, "link") || block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || "";
    const link = safeItemLink(rawLink, feed.host);
    const title = tag(block, "title").replace(/[<>]/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    const publishedRaw = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated");
    const publishedMs = Date.parse(publishedRaw || "");
    // Fail closed: undated and pre-activation items are never backfilled into the discovery queue.
    if (!title || !link || !Number.isFinite(publishedMs) || publishedMs < enabledAtMs) continue;
    items.push({
      title, url: link, published: new Date(publishedMs).toISOString(),
      source: feed.name, source_feed: feed.url, review_status: "discovery_lead_only"
    });
  }
  return items.sort((a, b) => Date.parse(b.published) - Date.parse(a.published)).slice(0, MAX_ITEMS_PER_FEED);
}
function validateDeclaredLength(value, maxBytes) {
  if (value === null) return null;
  if (!/^[0-9]+$/.test(value)) throw new Error("invalid_content_length");
  const declared = Number(value);
  if (!Number.isSafeInteger(declared)) throw new Error("invalid_content_length");
  if (declared > maxBytes) throw new Error("feed_too_large");
  return declared;
}

async function readBoundedBody(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty_feed_body");
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("feed_too_large");
      }
      chunks.push(Buffer.from(part.value));
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
  } catch {
    throw new Error("feed_invalid_utf8");
  }
}
async function readFeed(feed, enabledAtMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(feed.url, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "user-agent": "AI-Thuc-Chien-AI-Bank-Discovery/1.0", "accept": "application/rss+xml, application/atom+xml, application/xml, text/xml" }
    });
    if (response.status >= 300 && response.status < 400) throw new Error("redirect_not_followed");
    if (!response.ok) throw new Error("http_" + response.status);
    try {
      validateDeclaredLength(response.headers.get("content-length"), MAX_BYTES);
    } catch (error) {
      await response.body?.cancel().catch(() => {});
      throw error;
    }
    const body = await readBoundedBody(response, MAX_BYTES);
    const items = parseFeedItems(body, feed, enabledAtMs);
    return { source: feed.name, feed: feed.url, status: "ok", items };
  } catch (error) {
    return { source: feed.name, feed: feed.url, status: "inconclusive", reason: String(error?.message || error).slice(0, 160), items: [] };
  } finally { clearTimeout(timer); }
}

async function selfTest() {
  const enabledAtMs = Date.parse("2026-11-15T00:00:00.000Z");
  const fixture = `<rss><channel>
    <item><title><![CDATA[AI & Security]]></title><link>https://openai.com/news/example?utm_source=rss</link><pubDate>Mon, 16 Nov 2026 00:00:00 GMT</pubDate></item>
    <item><title>Pre-activation story</title><link>https://openai.com/news/old</link><pubDate>Fri, 14 Nov 2026 00:00:00 GMT</pubDate></item>
    <item><title>Undated story</title><link>https://openai.com/news/undated</link></item>
    <item><title>Wrong host</title><link>https://openai.com.attacker.test/news</link><pubDate>Mon, 16 Nov 2026 00:00:00 GMT</pubDate></item>
    <item><title>HTTP link</title><link>http://openai.com/news/insecure</link><pubDate>Mon, 16 Nov 2026 00:00:00 GMT</pubDate></item>
    <item><title>Credential URL</title><link>https://user:pass@openai.com/news/private</link><pubDate>Mon, 16 Nov 2026 00:00:00 GMT</pubDate></item>
    <item><title>Non-default port</title><link>https://openai.com:8443/news/private</link><pubDate>Mon, 16 Nov 2026 00:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const parsed = parseFeedItems(fixture, feeds[0], enabledAtMs);
  assert.equal(parsed.length, 1, "only dated post-activation exact-host HTTPS links are retained");
  assert.equal(parsed[0].title, "AI & Security");
  assert.equal(parsed[0].published, "2026-11-16T00:00:00.000Z");
  assert.equal(parsed[0].url, "https://openai.com/news/example", "tracking parameters must not defeat URL deduplication");
  assert.equal(parsed[0].review_status, "discovery_lead_only");
  assert.equal(safeItemLink("https://sub.openai.com/news", "openai.com"), null, "subdomains are not silently trusted");
  assert.equal(safeItemLink("https://openai.com:8443/news", "openai.com"), null, "non-default ports are rejected");
  assert.throws(() => parseFeedItems(fixture, feeds[0], NaN), /rss_activation_timestamp_required/);
  assert.equal(validateDeclaredLength("0005", 5), 5, "leading-zero decimal lengths remain valid");
  assert.throws(() => validateDeclaredLength("1e3", 2000), /invalid_content_length/);
  assert.throws(() => validateDeclaredLength("-1", 2000), /invalid_content_length/);
  assert.throws(() => validateDeclaredLength("6", 5), /feed_too_large/);
  const small = new Response(new TextEncoder().encode("12345"));
  assert.equal(await readBoundedBody(small, 5), "12345");
  const oversized = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode("123")); controller.enqueue(new TextEncoder().encode("456")); controller.close(); }
  }));
  await assert.rejects(() => readBoundedBody(oversized, 5), /feed_too_large/);
  const invalidUtf8 = new Response(new Uint8Array([0xff, 0xfe]));
  await assert.rejects(() => readBoundedBody(invalidUtf8, 5), /feed_invalid_utf8/);
  const many = Array.from({ length: 21 }, (_, index) =>
    `<item><title>Lead ${index}</title><link>https://openai.com/news/${index}</link><pubDate>Mon, 16 Nov 2026 00:00:00 GMT</pubDate></item>`).join("");
  assert.equal(parseFeedItems(many, feeds[0], enabledAtMs).length, MAX_ITEMS_PER_FEED, "post-activation item count is capped");
  console.log("PASS: RSS activation cutoff, dated-only entries, exact HTTPS host allowlist, canonical URLs, strict Content-Length/UTF-8, bounded stream and per-feed cap.");
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const enabledAtRaw = process.env.AI_BANK_RSS_ENABLED_AT || "";
  const enabledAtMs = Date.parse(enabledAtRaw);
  if (!Number.isFinite(enabledAtMs) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(enabledAtRaw)) {
    throw new Error("rss_activation_timestamp_required_utc_iso8601");
  }
  const enabledAt = new Date(enabledAtMs).toISOString();
  const results = await Promise.all(feeds.map(feed => readFeed(feed, enabledAtMs)));
  const all = results.flatMap(x => x.items);
  const unique = [...new Map(all.map(x => [x.url, x])).values()];
  const report = {
    schema_version: "1.1.0",
    generated_at: new Date().toISOString(),
    enabled_at: enabledAt,
    window_policy: "Only dated feed items published at or after AI_BANK_RSS_ENABLED_AT are eligible. Undated and pre-activation entries are excluded; no historical backfill.",
    policy: "Discovery leads only. No catalog writes, no automatic verification, no public publishing, no deployment, no D1 access.",
    sources_checked: results.length,
    sources_ok: results.filter(x => x.status === "ok").length,
    candidate_leads: unique.length,
    feeds: results,
    leads: unique
  };
  await fs.mkdir("reports/ai-bank", { recursive: true });
  await fs.writeFile("reports/ai-bank/discovery.json", JSON.stringify(report, null, 2) + "\n");
  const lines = [
    "# AI Bank — weekly discovery leads",
    "",
    "- Generated: " + report.generated_at,
    "- RSS enabled at (UTC): " + report.enabled_at,
    "- Window: only dated entries at or after activation; no historical backfill.",
    "- Sources checked: " + report.sources_checked + "; reachable: " + report.sources_ok,
    "- Discovery leads: " + report.candidate_leads,
    "- Scope: read-only discovery from official feeds; no catalog, website, Worker, D1 or production changes.",
    "- Every item is an unverified lead. Editors must open official pages and independently verify product identity, current pricing, quota, license, regional access and privacy before any catalog update.",
    "",
    "## Feed status",
    ...results.map(x => "- " + x.source + ": " + x.status + (x.reason ? " (" + x.reason + ")" : "") + " — " + x.items.length + " items retained"),
    "",
    "## Recent leads",
    ...unique.map(x => "- [" + markdownText(x.title) + "](" + x.url.replace(/\(/g, "%28").replace(/\)/g, "%29") + ") — " + markdownText(x.source) + (x.published ? " — " + markdownText(x.published) : "")),
    ""
  ];
  await fs.writeFile("reports/ai-bank/discovery.md", lines.join("\n"));
  console.log("AI Bank discovery: " + report.sources_ok + "/" + report.sources_checked + " feeds reachable; " + report.candidate_leads + " discovery leads. No catalog changes.");
}
