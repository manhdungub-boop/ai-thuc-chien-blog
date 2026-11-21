import { describe, it } from "node:test";\nimport { expect } from "./test-compat.mjs";
import { RESEARCH_FEED_SOURCES, discoverResearchSignals } from "../src/research-discovery.mjs";

const NOW = Date.parse("2026-11-18T12:00:00.000Z");

function feedFor(source, index = 0, date = "2026-11-18T10:00:00.000Z") {
  const path = source.pathPrefix + "research-update-" + index;
  const link = "https://" + source.host + path;
  const item = source.name === "Google DeepMind" || source.name === "Hugging Face"
    ? '<entry><title>AI agent research update</title><link href="' + link + '"/><updated>' + date + '</updated><summary>Research on AI agents and automation.</summary></entry>'
    : '<item><title>AI agent research update</title><link>' + link + '</link><pubDate>' + date + '</pubDate><description>Research on AI agents and automation.</description></item>';
  return source.name === "Google DeepMind" || source.name === "Hugging Face"
    ? "<feed>" + item + "</feed>"
    : "<rss><channel>" + item + "</channel></rss>";
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

  it("does not fabricate results when every source fails", async () => {
    const result = await discoverResearchSignals({ now: NOW, fetchImpl: async () => { throw new Error("offline"); } });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("all_sources_failed");
    expect(result.sources_failed).toHaveLength(4);
    expect(result.signal_count).toBe(0);
  });
});
