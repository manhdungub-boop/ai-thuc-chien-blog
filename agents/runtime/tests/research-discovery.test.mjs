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

  it("parses single-quoted Atom link attributes", async () => {
    const result = await discoverResearchSignals({
      now: NOW,
      fetchImpl: async url => {
        const source = RESEARCH_FEED_SOURCES.find(item => item.feed === url);
        const atom = source.name === "Google DeepMind" || source.name === "Hugging Face";
        if (!atom) return new Response(feedFor(source), { status: 200 });
        const link = "https://" + source.host + source.pathPrefix + "single-quoted-link";
        const entry = "<entry><title>AI agent research update</title>" +
          "<link rel='alternate' href='" + link + "'/>" +
          "<updated>2026-11-18T10:00:00.000Z</updated>" +
          "<summary>Research on AI agents and automation.</summary></entry>";
        return new Response("<feed>" + entry + "</feed>", { status: 200 });
      }
    });
    expect(result.sources_succeeded).toBe(4);
    expect(result.latest_signals.filter(item => item.url.endsWith("/single-quoted-link"))).toHaveLength(2);
  });

  it("does not extract fake entries embedded in XML comments or CDATA", async () => {
    const result = await discoverResearchSignals({
      now: NOW,
      fetchImpl: async url => {
        const source = RESEARCH_FEED_SOURCES.find(item => item.feed === url);
        const fakeInComment = "<!-- " + entryFor(source, "comment-fake") + " -->";
        const fakeInCdata = "<description><![CDATA[" + entryFor(source, "cdata-fake") + "]]></description>";
        return new Response(feedDocumentFor(source, fakeInComment + fakeInCdata + entryFor(source, "real")));
      }
    });
    expect(result.ok).toBe(true);
    expect(result.sources_succeeded).toBe(4);
    expect(result.signal_count).toBe(4);
    expect(result.latest_signals.every(item => item.url.endsWith("/research-update-real"))).toBe(true);
  });

  it("ignores nested item and entry elements that are not direct feed entries", async () => {
    const result = await discoverResearchSignals({
      now: NOW,
      fetchImpl: async url => {
        const source = RESEARCH_FEED_SOURCES.find(item => item.feed === url);
        const real = entryFor(source, "real");
        const nested = entryFor(source, "nested-fake");
        const wrapped = source.name === "Google DeepMind" || source.name === "Hugging Face"
          ? real.replace("</entry>", "<content type=\"xhtml\"><div xmlns=\"http://www.w3.org/1999/xhtml\"><feed>" + nested + "</feed></div></content></entry>")
          : real.replace("</item>", "<description><channel>" + nested + "</channel></description></item>");
        return new Response(feedDocumentFor(source, wrapped));
      }
    });
    expect(result.ok).toBe(true);
    expect(result.sources_succeeded).toBe(4);
    expect(result.signal_count).toBe(4);
    expect(result.latest_signals.every(item => item.url.endsWith("/research-update-real"))).toBe(true);
  });

  it("restores CDATA payloads before cleaning title and summary markup", async () => {
    const result = await discoverResearchSignals({
      now: NOW,
      fetchImpl: async url => {
        const source = RESEARCH_FEED_SOURCES.find(item => item.feed === url);
        const atom = source.name === "Google DeepMind" || source.name === "Hugging Face";
        const entryName = atom ? "entry" : "item";
        const link = atom
          ? '<link href="https://' + source.host + source.pathPrefix + 'cdata-cleanup"/>'
          : '<link><![CDATA[https://' + source.host + source.pathPrefix + 'cdata-cleanup]]></link>';
        const date = atom ? "updated" : "pubDate";
        const summary = atom ? "summary" : "description";
        const entry = '<' + entryName + '><title><![CDATA[<em>Research Update</em>]]></title>' +
          link + '<' + date + '><![CDATA[2026-11-18T10:00:00.000Z]]></' + date + '>' +
          '<' + summary + '><![CDATA[<p>Useful <strong>AI agent</strong> summary.</p>]]></' + summary + '></' + entryName + '>';
        return new Response(feedDocumentFor(source, entry), { status: 200 });
      }
    });
    expect(result.sources_succeeded).toBe(4);
    expect(result.latest_signals).toHaveLength(4);
    expect(result.latest_signals.every(item => item.title === "Research Update")).toBe(true);
    expect(result.latest_signals.every(item => item.summary === "Useful AI agent summary.")).toBe(true);
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

  it("rejects malformed UTF-8 feed bytes instead of silently replacing them", async () => {
    const result = await discoverResearchSignals({
      now: NOW,
      fetchImpl: async url => {
        const source = RESEARCH_FEED_SOURCES.find(item => item.feed === url);
        if (source.name !== "OpenAI News") return new Response(feedFor(source), { status: 200 });
        const prefix = new TextEncoder().encode("<rss><channel><item><title>");
        const suffix = new TextEncoder().encode(
          "</title><link>https://openai.com/index/invalid-utf8</link>" +
          "<pubDate>2026-11-18T10:00:00.000Z</pubDate></item></channel></rss>"
        );
        const bytes = new Uint8Array(prefix.length + 2 + suffix.length);
        bytes.set(prefix);
        bytes[prefix.length] = 0xc3;
        bytes[prefix.length + 1] = 0x28;
        bytes.set(suffix, prefix.length + 2);
        return new Response(bytes, { status: 200, headers: { "content-type": "application/rss+xml" } });
      }
    });

    expect(result.ok).toBe(true);
    expect(result.sources_succeeded).toBe(3);
    expect(result.sources_failed).toEqual([{ source: "OpenAI News", error: "invalid_utf8_feed" }]);
    expect(result.latest_signals.every(item => !item.url.endsWith("/invalid-utf8"))).toBe(true);
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

  it("rejects prefixed Atom roots bound to an empty namespace", async () => {
    const result = await discoverResearchSignals({
      now: NOW,
      fetchImpl: async url => {
        const source = RESEARCH_FEED_SOURCES.find(item => item.feed === url);
        if (source.name !== "Google DeepMind") return new Response(feedFor(source), { status: 200 });
        return new Response(
          '<atom:feed xmlns:atom="">'+
          entryFor(source, "empty-prefix-namespace") + "</atom:feed>",
          { status: 200 }
        );
      }
    });
    expect(result.ok).toBe(true);
    expect(result.sources_succeeded).toBe(3);
    expect(result.sources_failed).toEqual([{ source: "Google DeepMind", error: "invalid_feed_document" }]);
    expect(result.latest_signals.every(item => !item.url.endsWith("/empty-prefix-namespace"))).toBe(true);
  });

  it("rejects unclosed or improperly nested XML elements", async () => {
    const malformed = [
      "<rss><channel></rss>",
      "<rss><channel><item></channel></item></rss>",
      "<rss><channel></ channel></rss>",
      "<rss><channel></\tchannel></rss>"
    ];
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

  it("rejects bare ampersands and undeclared entity references in XML text and attributes", async () => {
    const malformed = [
      "<rss><channel>A & B</channel></rss>",
      '<rss label="A & B"><channel/></rss>',
      "<rss><channel>A &unknown;</channel></rss>",
      "<rss><channel>A &#0; B</channel></rss>"
    ];
    for (const document of malformed) {
      const result = await discoverResearchSignals({
        now: NOW,
        fetchImpl: async () => new Response(document, { status: 200 })
      });
      expect(result.ok).toBe(false);
      expect(result.sources_succeeded).toBe(0);
      expect(result.sources_failed).toHaveLength(4);
      expect(result.sources_failed.every(item => item.error === "invalid_feed_document")).toBe(true);
    }
  });

  it("accepts a valid XML declaration only at the beginning of a feed", async () => {
    const result = await discoverResearchSignals({
      now: NOW,
      fetchImpl: async url => {
        const source = RESEARCH_FEED_SOURCES.find(item => item.feed === url);
        return new Response('<?xml version="1.0" encoding="UTF-8"?>' + feedFor(source), { status: 200 });
      }
    });
    expect(result.ok).toBe(true);
    expect(result.sources_succeeded).toBe(4);
    expect(result.signal_count).toBe(4);
    expect(result.sources_failed).toEqual([]);
  });

  it("rejects XML declarations after the root, inside the root, or with invalid grammar", async () => {
    const malformed = [
      '<rss><channel/></rss><?xml version="1.0"?>',
      '<?xml version="1.0"?><rss><?xml version="1.0"?><channel/></rss>',
      '<?xml encoding="UTF-8" version="1.0"?><rss><channel/></rss>',
      '<?xml version="2.0"?><rss><channel/></rss>',
      '<?XML version="1.0"?><rss><channel/></rss>'
    ];
    for (const document of malformed) {
      const result = await discoverResearchSignals({
        now: NOW,
        fetchImpl: async () => new Response(document, { status: 200 })
      });
      expect(result.ok).toBe(false);
      expect(result.sources_succeeded).toBe(0);
      expect(result.sources_failed).toHaveLength(4);
      expect(result.sources_failed.every(item => item.error === "invalid_feed_document")).toBe(true);
    }
  });

});