import { describe, expect, it } from "vitest";
import { assessResearchEvidence } from "../src/research-evidence-assessment.mjs";

const now = Date.parse("2026-11-18T12:00:00.000Z");
const item = (source, host, publishedAt = "2026-11-17T09:00:00.000Z") => ({
  source,
  title: source + " research update",
  url: "https://" + host + (host === "openai.com" ? "/index/" : host === "arxiv.org" ? "/abs/" : "/blog/") + "research-update",
  published_at: publishedAt,
  status: "source_retrieved_not_fact_checked",
  excerpt: "A bounded source excerpt describing research methods, results, limitations, and context. ".repeat(2).slice(0, 160)
});

describe("research evidence readiness assessment", () => {
  it("marks two fresh distinct publisher domains ready only for claim review", () => {
    const result = assessResearchEvidence([
      item("OpenAI News", "openai.com"),
      item("Google DeepMind", "deepmind.google")
    ], { now });
    expect(result.status).toBe("evidence_packet_ready_for_claim_review");
    expect(result.ready_for_claim_review).toBe(true);
    expect(result.distinct_publisher_count).toBe(2);
    expect(result.independent_source_count).toBe(0);
    expect(result.independence_assessment).toBe("not_assessed_requires_human_review");
    expect(result.safety).toMatchObject({
      publication_authorized: false,
      draft_created: false,
      content_published: false
    });
    expect(result.limitations.join(" ")).toContain("do not prove");
  });

  it("rejects repeated publisher domains even when article URLs differ", () => {
    const first = item("OpenAI News", "openai.com");
    const second = { ...item("OpenAI News", "openai.com"), url: "https://openai.com/index/another-update" };
    const result = assessResearchEvidence([first, second], { now });
    expect(result.ready_for_claim_review).toBe(false);
    expect(result.rejected_sources).toHaveLength(1);
    expect(result.rejected_sources[0].reason).toBe("duplicate_publisher_domain");
  });

  it("rejects stale, future-dated, malformed, and un-retrieved evidence", () => {
    const result = assessResearchEvidence([
      item("OpenAI News", "openai.com", "2026-09-01T00:00:00.000Z"),
      item("Google DeepMind", "deepmind.google", "2026-12-01T00:00:00.000Z"),
      { ...item("Hugging Face", "huggingface.co"), published_at: "not-a-date" },
      { ...item("arXiv cs.AI", "arxiv.org"), status: "http_403" }
    ], { now });
    expect(result.ready_for_claim_review).toBe(false);
    expect(result.rejected_sources.map(source => source.reason)).toEqual([
      "stale_source",
      "future_publication_date",
      "invalid_publication_date",
      "source_not_retrieved"
    ]);
  });

  it("rejects invalid URL, missing metadata, short excerpts, and duplicate URLs", () => {
    const first = item("OpenAI News", "openai.com");
    const duplicate = { ...first };
    const result = assessResearchEvidence([
      { ...item("OpenAI News", "openai.com"), url: "http://openai.com/index/article" },
      { ...item("Google DeepMind", "deepmind.google"), source: "", title: "" },
      first,
      duplicate
    ], { now });
    expect(result.ready_for_claim_review).toBe(false);
    expect(result.rejected_sources.map(source => source.reason)).toContain("invalid_source_url");
    expect(result.rejected_sources.map(source => source.reason)).toContain("missing_source_metadata");
    expect(result.rejected_sources.map(source => source.reason)).toContain("duplicate_source_url");

    const shortExcerpt = assessResearchEvidence([
      { ...item("arXiv cs.AI", "arxiv.org"), excerpt: "too short" }
    ], { now });
    expect(shortExcerpt.rejected_sources[0].reason).toBe("invalid_excerpt");
  });

  it("caps assessment at four items and clamps thresholds", () => {
    const result = assessResearchEvidence([
      item("OpenAI News", "openai.com"), item("Google DeepMind", "deepmind.google"), item("Hugging Face", "huggingface.co"),
      item("arXiv cs.AI", "arxiv.org"), item("OpenAI News", "openai.com")
    ], { now, minIndependentSources: 99, maxAgeDays: 999 });
    expect(result.accepted_sources).toHaveLength(4);
    expect(result.required_distinct_publishers).toBe(4);
    expect(result.max_source_age_days).toBe(90);
  });

  it("rejects unrecognized publisher domains and mismatched publisher labels", () => {
    const unknown = assessResearchEvidence([
      item("OpenAI News", "openai.com"),
      item("Unknown Publisher", "unknown.example")
    ], { now });
    expect(unknown.rejected_sources.map(source => source.reason)).toContain("publisher_identity_not_allowlisted");

    const spoofed = assessResearchEvidence([
      { ...item("OpenAI News", "openai.com"), url: "https://deepmind.google/blog/not-openai" }
    ], { now });
    expect(spoofed.rejected_sources[0].reason).toBe("publisher_identity_not_allowlisted");
  });

});
