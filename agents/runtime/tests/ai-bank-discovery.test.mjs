import { describe, expect, it } from "vitest";
import { AI_BANK_RELEASE_SOURCES, discoverAiBankReleaseSignals } from "../src/ai-bank-discovery.mjs";

const NOW = Date.parse("2026-11-18T12:00:00.000Z");

function feedFor(source, publishedAt = "2026-11-18T10:00:00.000Z") {
  return `<feed><entry><title><![CDATA[Release v1.2.3 &amp; notes]]></title><link href="https://github.com/${source.repo}/releases/tag/v1.2.3"/><updated>${publishedAt}</updated><id>https://github.com/${source.repo}/releases/tag/v1.2.3</id></entry></feed>`;
}

describe("read-only AI Bank release discovery", () => {
  it("checks only the ten allowlisted GitHub release feeds and returns bounded signals", async () => {
    const requested = [];
    const result = await discoverAiBankReleaseSignals({
      now: NOW,
      fetchImpl: async (url, options) => {
        requested.push({ url, options });
        const source = AI_BANK_RELEASE_SOURCES.find(item => item.feed === url);
        return new Response(feedFor(source), { status: 200 });
      }
    });

    expect(requested).toHaveLength(10);
    expect(requested.every(item => item.options.method === "GET")).toBe(true);
    expect(requested.every(item => item.options.redirect === "error")).toBe(true);
    expect(result).toMatchObject({ ok: true, sources_checked: 10, sources_succeeded: 10, signal_count: 10 });
    expect(result.latest_signals).toHaveLength(10);
    expect(result.safety).toEqual({
      catalog_modified: false,
      public_content_modified: false,
      deployment_performed: false,
      secrets_used: false,
      external_submission: false
    });
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(8192);
  });

  it("rejects off-domain links and ignores entries outside the lookback window", async () => {
    const result = await discoverAiBankReleaseSignals({
      now: NOW,
      lookbackDays: 7,
      fetchImpl: async url => {
        const source = AI_BANK_RELEASE_SOURCES.find(item => item.feed === url);
        const unsafe = `<entry><title>Unsafe</title><link href="https://evil.example/${source.repo}/releases/tag/x"/><updated>2026-11-18T10:00:00Z</updated></entry>`;
        return new Response(`<feed>${unsafe}${feedFor(source, "2026-10-01T00:00:00Z").replace("<feed>", "").replace("</feed>", "")}</feed>`, { status: 200 });
      }
    });

    expect(result.ok).toBe(true);
    expect(result.signal_count).toBe(0);
    expect(result.latest_signals).toEqual([]);
  });

  it("reports all-source failure without fabricating discovery results", async () => {
    const result = await discoverAiBankReleaseSignals({
      now: NOW,
      fetchImpl: async () => { throw new Error("offline"); }
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("all_sources_failed");
    expect(result.sources_failed).toHaveLength(10);
    expect(result.signal_count).toBe(0);
    expect(result.latest_signals).toEqual([]);
  });
});
