import { describe, it } from "node:test";
import { expect } from "./test-compat.mjs";
import { RESEARCH_FEED_SOURCES, discoverResearchSignals } from "../src/research-discovery.mjs";

const NOW = Date.parse("2026-11-18T12:00:00.000Z");

function entryFor(source, index = 0, date = "2026-11-18T10:00:00.000Z") {
  const path = source.pathPrefix + "research-update-" + index;
  const link = "https://" + source.host + path;
  return source.name === "Google DeepMind" || source.name === "Hugging Face"
    ? '<entry><title>AI agent research update</title><link href="' + link + '"/><updated>' + date + '</updated><summary>Research on AI agents and automation.</summary></entry>'
    : '<item><title>AI agent research update</title><link>' + link + '</link><pubDate>' + date + '</pubDate><description>Research on AI agents and automation.</description></item>';
}

function feedDocumentFor(source, entries) {
  return source.name === "Google DeepMind" || source.name === "Hugging Face"
    ? "<feed>" + entries + "</feed>"
    : "<rss><channel>" + entries + "</channel></rss>";
}

function feedFor(source, index = 0, date = "2026-11-18T10:00:00.000Z") {
  return feedDocumentFor(source, entryFor(source, index, date));
}

describe("read-only AI research discovery", () => {
  it("reads only four fixed sources and returns a bounded set of signals", async () => {
    const requested = [];
    const result = await discoverResearchSignals({
      now: NOW,
      fetchImpl: async (url, options) => {
        requested.push({ url, options });
        const source = RESEARCH_FEED_SOURCES.find(item => item.feed === url);
        return new Response(feedFor(source), { status: 200 });
      }
    });

    expect(requested).toHaveLength(4);
    expect(requested.every(item => item.options.method === "GET")).toBe(true);
    expect(requested.every(item => item.options.redirect === "error")).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      status: "read_only_research_discovery_complete",
      sources_checked: 4,
      sources_succeeded: 4,
      signal_count: 4
    });
    expect(result.latest_signals).toHaveLength(4);
    expect(result.safety).toEqual({
      read_only: true,
      catalog_modified: false,
      content_created: false,
      public_content_modified: false,
      deployment_performed: false
    });
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(8192);
  });

  it("does not count HTTP 200 HTML error pages as successful feed scans", async () => {
    const result = await discoverResearchSignals({
      now: NOW,
      fetchImpl: async () => new Response("<html><body>gateway error</body></html>", { status: 200 })
    });
    expect(result).toMatchObject({
      ok: false,
      status: "all_sources_failed",
      sources_checked: 4,
      sources_succeeded: 0,
      signal_count: 0
    });
    expect(result.sources_failed).toHaveLength(4);
    expect(result.sources_failed.every(item => item.error === "invalid_feed_document")).toBe(true);
  });

  it("filters future-dated feed entries before ranking the bounded result set", async () => {
    const result = await discoverResearchSignals({
      now: NOW,
      fetchImpl: async url => {
        const source = RESEARCH_FEED_SOURCES.find(item => item.feed === url);
        const future = Array.from({ length: 4 }, (_, index) =>
          entryFor(source, "future-" + index, new Date(NOW + 60 * 60 * 1000).toISOString())
        ).join("");
        const current = entryFor(source, "current", new Date(NOW - 60 * 1000).toISOString());
        return new Response(feedDocumentFor(source, future + current), { status: 200 });
      }
    });
    expect(result.signal_count).toBe(4);
    expect(result.latest_signals).toHaveLength(4);
    expect(result.latest_signals.every(item => item.url.includes("current"))).toBe(true);
  });

  it("rejects off-domain links and entries outside the lookback window", async () => {
    const result = await discoverResearchSignals({
      now: NOW,
      lookbackDays: 7,
      fetchImpl: async url => {
        const source = RESEARCH_FEED_SOURCES.find(item => item.feed === url);
        const unsafe = '<item><title>Unsafe</title><link>https://evil.example' + source.pathPrefix + 'x</link><pubDate>Tue, 18 Nov 2026 10:00:00 GMT</pubDate></item>';
        return new Response("<rss><channel>" + unsafe + feedFor(source, 2, "2026-10-01T00:00:00Z").replace("<rss><channel>", "").replace("</channel></rss>", "") + "</channel></rss>", { status: 200 });
      }
    });

    expect(result.ok).toBe(true);
    expect(result.signal_count).toBe(0);
    expect(result.latest_signals).toEqual([]);
  });

  it("decodes HTML entities only once in feed text", async () => {
    const result = await discoverResearchSignals({
      now: NOW,
      fetchImpl: async url => {
        const source = RESEARCH_FEED_SOURCES.find(item => item.feed === url);
        const entry = '<item><title>Safe &amp;lt;script&amp;gt;</title><link>https://' + source.host + source.pathPrefix + 'entity-test</link><pubDate>2026-11-18T10:00:00.000Z</pubDate></item>';
        return new Response('<rss><channel>' + entry + '</channel></rss>');
      }
    });
    expect(result.latest_signals[0].title).toBe('Safe &lt;script&gt;');
  });

  it("does not fabricate results when every source fails", async () => {
    const result = await discoverResearchSignals({ now: NOW, fetchImpl: async () => { throw new Error("offline"); } });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("all_sources_failed");
    expect(result.sources_failed).toHaveLength(4);
    expect(result.signal_count).toBe(0);
  });
  it("accepts valid trailing XML comments and processing instructions", async () => {
    const result = await discoverResearchSignals({
      now: NOW,
      fetchImpl: async url => {
        const source = RESEARCH_FEED_SOURCES.find(item => item.feed === url);
        return new Response(feedFor(source) + "<!-- generated by upstream --><?feed-stamp checked?>", { status: 200 });
      }
    });
    expect(result.ok).toBe(true);
    expect(result.sources_succeeded).toBe(4);
    expect(result.signal_count).toBe(4);
    expect(result.sources_failed).toEqual([]);
  });

  it("accepts namespace-equivalent Atom roots with prefixed root and unprefixed entries", async () => {
    const result = await discoverResearchSignals({
      now: NOW,
      fetchImpl: async url => {
        const source = RESEARCH_FEED_SOURCES.find(item => item.feed === url);
        if (source.name !== "Google DeepMind") return new Response(feedFor(source), { status: 200 });
        const entry = entryFor(source, "prefixed-root");
        return new Response(
          '<atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xmlns="http://www.w3.org/2005/Atom">' +
          entry + "</atom:feed>",
          { status: 200 }
        );
      }
    });
    expect(result.ok).toBe(true);
    expect(result.sources_succeeded).toBe(4);
    expect(result.sources_failed).toEqual([]);
    expect(result.latest_signals.some(item => item.url.endsWith("/research-update-prefixed-root"))).toBe(true);
  });

  it("rejects Atom feed roots bound to an unrelated namespace", async () => {
    const result = await discoverResearchSignals({
      now: NOW,
      fetchImpl: async url => {
        const source = RESEARCH_FEED_SOURCES.find(item => item.feed === url);
        if (source.name !== "Google DeepMind") return new Response(feedFor(source), { status: 200 });
        return new Response(
          '<atom:feed xmlns:atom="urn:untrusted:feed" xmlns="http://www.w3.org/2005/Atom">' +
          entryFor(source, "wrong-namespace") + "</atom:feed>",
          { status: 200 }
        );
      }
    });
    expect(result.ok).toBe(true);
    expect(result.sources_succeeded).toBe(3);
    expect(result.sources_failed).toEqual([{ source: "Google DeepMind", error: "invalid_feed_document" }]);
    expect(result.latest_signals.every(item => !item.url.endsWith("/wrong-namespace"))).toBe(true);
  });

  it("rejects unclosed or improperly nested XML elements", async () => {
    const malformed = ["<rss><channel></rss>", "<rss><channel><item></channel></item></rss>"];
    for (const document of malformed) {
      const result = await discoverResearchSignals({
        now: NOW,
        fetchImpl: async () => new Response(document, { status: 200 })
      });
      expect(result.ok).toBe(false);
      expect(result.sources_succeeded).toBe(0);
      expect(result.sources_failed.every(item => item.error === "invalid_feed_document")).toBe(true);
    }
  });

});