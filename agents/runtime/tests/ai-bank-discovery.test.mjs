import { describe, it } from "node:test";
import { expect } from "./test-compat.mjs";
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
    expect(result.latest_signals).toHaveLength(5);
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

  it("enforces the saved From now on cursor and excludes earlier releases", async () => {
    const now = Date.parse("2026-11-24T12:00:00.000Z");
    const startAt = "2026-11-22T03:04:52.000Z";
    const requested = [];
    const result = await discoverAiBankReleaseSignals({
      now,
      startAt,
      lookbackDays: 90,
      fetchImpl: async url => {
        requested.push(url);
        const source = AI_BANK_RELEASE_SOURCES.find(item => item.feed === url);
        const before = feedFor(source, "2026-11-22T03:04:51.000Z")
          .replace("<feed>", "").replace("</feed>", "");
        const after = feedFor(source, "2026-11-22T03:04:53.000Z")
          .replace("<feed>", "").replace("</feed>", "");
        return new Response("<feed>" + before + after + "</feed>", { status: 200 });
      }
    });

    expect(requested).toHaveLength(10);
    expect(result.start_at).toBe(new Date(startAt).toISOString());
    expect(result.effective_cutoff).toBe(new Date(startAt).toISOString());
    expect(result.signal_count).toBe(10);
    expect(result.latest_signals.every(item => item.published_at === "2026-11-22T03:04:53.000Z")).toBe(true);
    expect(result.catalog_candidates.every(item => item.latest_release.published_at >= startAt)).toBe(true);
  });

  it("fails closed for an invalid persisted start cursor before requesting feeds", async () => {
    let requests = 0;
    let failure;
    try {
      await discoverAiBankReleaseSignals({
        now: NOW,
        startAt: "not-a-date",
        fetchImpl: async () => {
          requests += 1;
          return new Response("<feed />", { status: 200 });
        }
      });
    } catch (error) {
      failure = error;
    }

    expect(failure?.message).toBe("invalid_start_at");
    expect(requests).toBe(0);
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
  it("normalizes release activity into deduplicated review-only catalog candidates", async () => {
    const result = await discoverAiBankReleaseSignals({
      now: NOW,
      fetchImpl: async url => {
        const source = AI_BANK_RELEASE_SOURCES.find(item => item.feed === url);
        const duplicateReleases = source.repo === AI_BANK_RELEASE_SOURCES[0].repo
          ? `<entry><title>Older release</title><link href="https://github.com/${source.repo}/releases/tag/v1.2.2"/><updated>2026-11-17T10:00:00Z</updated></entry>`
          : "";
        return new Response(feedFor(source).replace("</feed>", duplicateReleases + "</feed>"), { status: 200 });
      }
    });

    const candidates = result.catalog_candidates;
    expect(candidates).toHaveLength(5);
    expect(new Set(candidates.map(item => item.candidate_id)).size).toBe(candidates.length);
    const first = candidates.find(item => item.repository === AI_BANK_RELEASE_SOURCES[0].repo);
    const mixedCaseCandidate = candidates.find(item => item.repository === "Comfy-Org/ComfyUI");
    expect(mixedCaseCandidate?.candidate_id).toBe("github:Comfy-Org/ComfyUI");
    expect(first).toMatchObject({
      candidate_id: "github:" + AI_BANK_RELEASE_SOURCES[0].repo,
      name: "Ollama",
      provider: "Ollama",
      review_status: "needs_official_source_review",
      pricing_status: "unverified",
      free_limits_status: "unverified",
      license_status: "unverified",
      privacy_status: "unverified",
      catalog_write_authorized: false,
      public_publication_authorized: false
    });
    expect(first.latest_release.title).toContain("Release v1.2.3");
    expect(first.required_checks).toContain("privacy_and_data_handling");
  });

  it("returns no catalog candidates when all discovery sources fail", async () => {
    const result = await discoverAiBankReleaseSignals({
      now: NOW,
      fetchImpl: async () => { throw new Error("offline"); }
    });
    expect(result.catalog_candidates).toEqual([]);
  });

});