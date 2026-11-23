const MAX_BYTES = 750_000;
const TIMEOUT_MS = 8_000;
const MAX_RESULTS = 4;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const RESEARCH_FEED_SOURCES = [
  { name: "OpenAI News", host: "openai.com", pathPrefix: "/index/", feed: "https://openai.com/news/rss.xml" },
  { name: "Google DeepMind", host: "deepmind.google", pathPrefix: "/blog/", feed: "https://deepmind.google/blog/rss.xml" },
  { name: "Hugging Face", host: "huggingface.co", pathPrefix: "/blog/", feed: "https://huggingface.co/blog/feed.xml" },
  { name: "arXiv cs.AI", host: "arxiv.org", pathPrefix: "/abs/", feed: "https://rss.arxiv.org/rss/cs.AI" }
];

function decodeHtmlEntities(value) {
  return value.replace(/&(?:amp|lt|gt|quot|apos|#39|#\d+|#x[0-9a-f]+);/gi, entity => {
    const name = entity.slice(1, -1).toLowerCase();
    if (name === "amp") return "&";
    if (name === "lt") return "<";
    if (name === "gt") return ">";
    if (name === "quot") return '"';
    if (name === "apos" || name === "#39") return "'";
    return " ";
  });
}

function cleanText(value, max = 500) {
  return decodeHtmlEntities(value.replace(/<!\[CDATA\[|\]\]>/g, " ").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ").trim().slice(0, max);
}
function elementText(xml, name) {
  const match = xml.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
  return match ? match[1] : "";
}

function maskNonElementMarkup(xml) {
  let output = "";
  let index = 0;
  while (index < xml.length) {
    if (xml.startsWith("<!--", index)) {
      const end = xml.indexOf("-->", index + 4);
      if (end === -1) return "";
      output += " ".repeat(end + 3 - index);
      index = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", index)) {
      const end = xml.indexOf("]]>", index + 9);
      if (end === -1) return "";
      const content = xml.slice(index + 9, end)
        .replace(/</g, "&amp;lt;")
        .replace(/>/g, "&amp;gt;");
      output += content;
      index = end + 3;
      continue;
    }
    if (xml.startsWith("<?", index)) {
      const end = xml.indexOf("?>", index + 2);
      if (end === -1) return "";
      output += " ".repeat(end + 2 - index);
      index = end + 2;
      continue;
    }
    if (/^<!DOCTYPE\b/i.test(xml.slice(index))) {
      let quote = null;
      let subsetDepth = 0;
      let end = -1;
      for (let cursor = index + 9; cursor < xml.length; cursor++) {
        const character = xml[cursor];
        if (quote) {
          if (character === quote) quote = null;
        } else if (character === '"' || character === "'") {
          quote = character;
        } else if (character === "[") {
          subsetDepth++;
        } else if (character === "]" && subsetDepth) {
          subsetDepth--;
        } else if (character === ">" && subsetDepth === 0) {
          end = cursor;
          break;
        }
      }
      if (end === -1) return "";
      output += " ".repeat(end + 1 - index);
      index = end + 1;
      continue;
    }
    output += xml[index++];
  }
  return output;
}

function parseItems(xml, source, cutoff, now) {
  const searchableXml = maskNonElementMarkup(xml);
  return [...searchableXml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map(match => {
    const body = match[2];
    const title = cleanText(elementText(body, "title"), 120);
    const summary = cleanText(elementText(body, "description") || elementText(body, "summary") || elementText(body, "content:encoded"), 160);
    const rawLink = body.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] || cleanText(elementText(body, "link"), 300);
    const rawDate = elementText(body, "published") || elementText(body, "updated") || elementText(body, "pubDate") || elementText(body, "dc:date");
    const date = new Date(cleanText(rawDate, 100));
    if (!title || !rawLink || rawLink.length > 300 || !Number.isFinite(date.getTime()) ||
        date.getTime() < cutoff || date.getTime() > now + MAX_FUTURE_CLOCK_SKEW_MS) return null;
    let link;
    try { link = new URL(rawLink); } catch { return null; }
    if (link.protocol !== "https:" || link.hostname !== source.host || link.username || link.password ||
        (link.port && link.port !== "443") || link.search || link.hash || !link.pathname.startsWith(source.pathPrefix)) return null;
    return { source: source.name, title, summary, url: link.href, published_at: date.toISOString() };
  }).filter(Boolean);
}

function isFeedDocument(xml) {
  const document = xml.replace(/^\uFEFF/, "");
  let index = 0;
  let rootName = null;
  let rootLocalName = null;
  let rootNamespaceURI = null;
  const stack = [];
  let doctypeSeen = false;

  const scanTagEnd = start => {
    let quote = null;
    for (let cursor = start; cursor < document.length; cursor++) {
      const character = document[cursor];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        return cursor;
      }
    }
    return -1;
  };

  while (index < document.length) {
    if (document[index] !== "<") {
      const next = document.indexOf("<", index);
      const end = next === -1 ? document.length : next;
      const text = document.slice(index, end);
      if (!stack.length && text.trim()) return false;
      if (text.includes("]]>")) return false;
      index = end;
      continue;
    }

    if (document.startsWith("<!--", index)) {
      const end = document.indexOf("-->", index + 4);
      if (end === -1 || document.slice(index + 4, end).includes("--")) return false;
      index = end + 3;
      continue;
    }

    if (document.startsWith("<?", index)) {
      const end = document.indexOf("?>", index + 2);
      if (end === -1) return false;
      const instruction = document.slice(index, end + 2);
      const targetMatch = instruction.match(/^<\?([A-Za-z_][A-Za-z0-9_.:-]*)(?:\s|\?>)/);
      if (!targetMatch) return false;
      const target = targetMatch[1];
      if (target.toLowerCase() === "xml") {
        const validDeclaration =
          /^<\?xml\s+version\s*=\s*(["'])1\.[01]\1(?:\s+encoding\s*=\s*(["'])[A-Za-z][A-Za-z0-9._-]*\2)?(?:\s+standalone\s*=\s*(["'])(?:yes|no)\3)?\s*\?>$/.test(instruction);
        if (index !== 0 || target !== "xml" || !validDeclaration) return false;
      }
      index = end + 2;
      continue;
    }

    if (document.startsWith("<![CDATA[", index)) {
      if (!stack.length) return false;
      const end = document.indexOf("]]>", index + 9);
      if (end === -1) return false;
      index = end + 3;
      continue;
    }

    if (/^<!DOCTYPE\b/i.test(document.slice(index))) {
      if (rootName !== null || stack.length || doctypeSeen) return false;
      let quote = null;
      let subsetDepth = 0;
      let end = -1;
      for (let cursor = index + 9; cursor < document.length; cursor++) {
        const character = document[cursor];
        if (quote) {
          if (character === quote) quote = null;
        } else if (character === '"' || character === "'") {
          quote = character;
        } else if (character === "[") {
          subsetDepth++;
        } else if (character === "]" && subsetDepth) {
          subsetDepth--;
        } else if (character === ">" && subsetDepth === 0) {
          end = cursor;
          break;
        }
      }
      if (end === -1) return false;
      doctypeSeen = true;
      index = end + 1;
      continue;
    }

    if (document.startsWith("<!", index)) return false;

    if (document.startsWith("</", index)) {
      const end = document.indexOf(">", index + 2);
      if (end === -1) return false;
      const closing = document.slice(index + 2, end).trim();
      if (!/^[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(closing) || stack.pop() !== closing) return false;
      index = end + 1;
      continue;
    }

    const end = scanTagEnd(index + 1);
    if (end === -1) return false;
    let body = document.slice(index + 1, end);
    const selfClosing = /\/\s*$/.test(body);
    if (selfClosing) body = body.replace(/\/\s*$/, "");
    const nameMatch = body.match(/^([A-Za-z_:][A-Za-z0-9_.:-]*)([\s\S]*)$/);
    if (!nameMatch) return false;
    const name = nameMatch[1];
    let attributes = nameMatch[2];
    const seenAttributes = new Set();
    const namespaceDeclarations = new Map();
    while (attributes.trim().length) {
      if (!/^\s/.test(attributes)) return false;
      const match = attributes.match(/^\s+([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*("[^"]*"|'[^']*')/);
      if (!match || seenAttributes.has(match[1])) return false;
      const attributeValue = match[2].slice(1, -1);
      if (attributeValue.includes("<")) return false;
      seenAttributes.add(match[1]);
      if (match[1] === "xmlns") namespaceDeclarations.set("", attributeValue);
      else if (match[1].startsWith("xmlns:")) namespaceDeclarations.set(match[1].slice(6), attributeValue);
      attributes = attributes.slice(match[0].length);
    }

    if (!stack.length) {
      if (rootName !== null) return false;
      rootName = name;
      const separator = name.indexOf(":");
      const prefix = separator === -1 ? "" : name.slice(0, separator);
      rootLocalName = separator === -1 ? name : name.slice(separator + 1);
      rootNamespaceURI = namespaceDeclarations.get(prefix) || "";
      if (prefix && (!namespaceDeclarations.has(prefix) || !namespaceDeclarations.get(prefix))) return false;
    }
    if (!selfClosing) stack.push(name);
    index = end + 1;
  }

  const localName = String(rootLocalName || "").toLowerCase();
  const namespaceURI = String(rootNamespaceURI || "");
  const supportedRoot =
    (localName === "rss" && namespaceURI === "") ||
    (localName === "feed" && (namespaceURI === "" || namespaceURI === "http://www.w3.org/2005/Atom")) ||
    (localName === "rdf" && namespaceURI === "http://www.w3.org/1999/02/22-rdf-syntax-ns#");
  return rootName !== null && supportedRoot && stack.length === 0;
}

async function fetchFeed(source, fetchImpl, cutoff, now) {
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
    if (!isFeedDocument(xml)) throw new Error("invalid_feed_document");
    return { source, records: parseItems(xml, source, cutoff, now), error: null };
  } catch (error) {
    return { source, records: [], error: String(error?.message || error).replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80) };
  } finally { clearTimeout(timer); }
}

export async function discoverResearchSignals({ fetchImpl = fetch, now = Date.now(), lookbackDays = 14 } = {}) {
  const days = Math.min(60, Math.max(1, Number(lookbackDays) || 14));
  const cutoff = now - days * 86_400_000;
  const results = await Promise.all(RESEARCH_FEED_SOURCES.map(source => fetchFeed(source, fetchImpl, cutoff, now)));
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
