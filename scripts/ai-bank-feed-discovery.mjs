import fs from "node:fs/promises";
import assert from "node:assert/strict";

const feeds = [
  { name: "OpenAI News", url: "https://openai.com/news/rss.xml", host: "openai.com" },
  { name: "Google DeepMind", url: "https://deepmind.google/blog/rss.xml", host: "deepmind.google" },
  { name: "Hugging Face Blog", url: "https://huggingface.co/blog/feed.xml", host: "huggingface.co" },
  { name: "Google AI", url: "https://blog.google/technology/ai/rss/", host: "blog.google" },
  { name: "AWS Machine Learning", url: "https://aws.amazon.com/blogs/machine-learning/feed/", host: "aws.amazon.com" }
];

const MAX_BYTES = 1_500_000;
const MAX_ITEMS_PER_FEED = 20;
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
    if (u.protocol !== "https:" || u.hostname !== expectedHost || u.username || u.password) return null;
    u.hash = "";
    return u.toString();
  } catch { return null; }
}
function parseFeedItems(body, feed) {
  const blocks = [...body.matchAll(/<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)\s*>/gi)]
    .slice(0, MAX_ITEMS_PER_FEED);
  const items = [];
  for (const match of blocks) {
    const block = match[1];
    const rawLink = tag(block, "link") || block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || "";
    const link = safeItemLink(rawLink, feed.host);
    const title = tag(block, "title").replace(/[<>]/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    const published = tag(block, "pubDate") || tag(block, "published") || tag(block, "updated");
    if (title && link) items.push({
      title, url: link, published: published || null,
      source: feed.name, source_feed: feed.url, review_status: "discovery_lead_only"
    });
  }
  return items;
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
  return Buffer.concat(chunks, total).toString("utf8");
}
async function readFeed(feed) {
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
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) throw new Error("feed_too_large");
    const body = await readBoundedBody(response, MAX_BYTES);
    const items = parseFeedItems(body, feed);
    return { source: feed.name, feed: feed.url, status: "ok", items };
  } catch (error) {
    return { source: feed.name, feed: feed.url, status: "inconclusive", reason: String(error?.message || error).slice(0, 160), items: [] };
  } finally { clearTimeout(timer); }
}

async function selfTest() {
  const fixture = `<rss><channel>
    <item><title><![CDATA[AI & Security]]></title><link>https://openai.com/news/example</link><pubDate>Mon, 16 Nov 2026 00:00:00 GMT</pubDate></item>
    <item><title>Wrong host</title><link>https://openai.com.attacker.test/news</link></item>
    <item><title>HTTP link</title><link>http://openai.com/news/insecure</link></item>
    <item><title>Credential URL</title><link>https://user:pass@openai.com/news/private</link></item>
  </channel></rss>`;
  const parsed = parseFeedItems(fixture, feeds[0]);
  assert.equal(parsed.length, 1, "only exact HTTPS source-host links are retained");
  assert.equal(parsed[0].title, "AI & Security");
  assert.equal(parsed[0].review_status, "discovery_lead_only");
  assert.equal(safeItemLink("https://sub.openai.com/news", "openai.com"), null, "subdomains are not silently trusted");
  const small = new Response(new TextEncoder().encode("12345"));
  assert.equal(await readBoundedBody(small, 5), "12345");
  const oversized = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("123"));
      controller.enqueue(new TextEncoder().encode("456"));
      controller.close();
    }
  }));
  await assert.rejects(() => readBoundedBody(oversized, 5), /feed_too_large/);
  const many = Array.from({ length: 21 }, (_, index) =>
    `<item><title>Lead ${index}</title><link>https://openai.com/news/${index}</link></item>`).join("");
  assert.equal(parseFeedItems(many, feeds[0]).length, MAX_ITEMS_PER_FEED, "item count is capped");
  console.log("PASS: offline RSS fixtures, exact HTTPS host allowlist, bounded streaming body, and per-feed item cap.");
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const results = await Promise.all(feeds.map(readFeed));
  const all = results.flatMap(x => x.items);
  const unique = [...new Map(all.map(x => [x.url, x])).values()];
  const report = {
    schema_version: "1.0.0",
    generated_at: new Date().toISOString(),
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
