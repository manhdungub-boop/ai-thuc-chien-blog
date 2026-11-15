import fs from "node:fs/promises";

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
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}
function tag(block, name) {
  const re = new RegExp("<(?:[\\w.-]+:)?" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?" + name + "\\s*>", "i");
  return decodeXml(block.match(re)?.[1]?.trim() || "");
}
function markdownText(value = "") {
  return String(value).replace(/[\\r\\n\\t]+/g, " ").replace(/([\\\\*_{}\\[\\]()#+.!|<>])/g, "\\\\$1").replace(/`/g, "\\\\`").trim();
}
function safeItemLink(raw, expectedHost) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.hostname !== expectedHost || u.username || u.password) return null;
    u.hash = "";
    return u.toString();
  } catch { return null; }
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
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_BYTES) throw new Error("feed_too_large");
    const blocks = [...body.matchAll(/<(?:item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/(?:item|entry)\s*>/gi)].slice(0, MAX_ITEMS_PER_FEED);
    const items = [];
    for (const match of blocks) {
      const b = match[1];
      const rawLink = tag(b, "link") || b.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || "";
      const link = safeItemLink(rawLink, feed.host);
      const title = tag(b, "title").replace(/<[^>]+>/g, "").trim();
      const published = tag(b, "pubDate") || tag(b, "published") || tag(b, "updated");
      if (title && link) items.push({ title, url: link, published: published || null, source: feed.name, source_feed: feed.url, review_status: "discovery_lead_only" });
    }
    return { source: feed.name, feed: feed.url, status: "ok", items };
  } catch (error) {
    return { source: feed.name, feed: feed.url, status: "inconclusive", reason: String(error?.message || error).slice(0, 160), items: [] };
  } finally { clearTimeout(timer); }
}

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
