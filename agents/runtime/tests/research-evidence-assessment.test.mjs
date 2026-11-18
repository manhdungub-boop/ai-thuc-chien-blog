import { describe, expect, it } from "vitest";
import { assessResearchEvidence } from "../src/research-evidence-assessment.mjs";

const now = Date.parse("2026-11-18T12:00:00.000Z");
const item = (source, host, publishedAt = "2026-11-17T09:00:00.000Z") => ({
  source,
  title: source + " research update",
  url: "https://" + host + "/article/research-update",
  published_at: publishedAt,
  status: "source_retrieved_not_fact_checked",
  excerpt: "A bounded source excerpt describing research methods, results, limitations, and context. ".repeat(2).slice(0, 160)
});

describe("research evidence readiness assessment", () => {
  it("marks two fresh distinct publisher domains ready only for claim review", () => {
    const result = assessResearchEvidence([
      item("OpenAI", "openai.com"),
      item("DeepMind", "deepmind.google")
    ], { now });
    expect(result.status).toBe("evidence_packet_ready_for_claim_review");
    expect(result.ready_for_claim_review).toBe(true);
    expect(result.independent_source_count).toBe(2);
    expect(result.safety).toMatchObject({
      publication_authorized: false,
      draft_created: false,
      content_published: false
    });
    expect(result.limitations.join(" ")).toContain("do not prove");
  });

  it("rejects repeated publisher domains even when article URLs differ", () => {
    const first = item("OpenAI", "openai.com");
    const second = { ...item("OpenAI Blog", "openai.com"), url: "https://openai.com/index/another-update" };
    const result = assessResearchEvidence([first, second], { now });
    expect(result.ready_for_claim_review).toBe(false);
    expect(result.rejected_sources).toHaveLength(1);
    expect(result.rejected_sources[0].reason).toBe("duplicate_publisher_domain");
  });

  it("rejects stale, future-dated, malformed, and un-retrieved evidence", () => {
    const result = assessResearchEvidence([
      item("Old source", "old.example", "2026-09-01T00:00:00.000Z"),
      item("Future source", "future.example", "2026-12-01T00:00:00.000Z"),
      { ...item("Bad source", "bad.example"), published_at: "not-a-date" },
      { ...item("Failed source", "failed.example"), status: "http_403" }
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
    const first = item("OpenAI", "openai.com");
    const duplicate = { ...first, source: "Different label" };
    const result = assessResearchEvidence([
      { ...item("Bad URL", "bad.example"), url: "http://bad.example/article" },
      { ...item("", "empty.example"), title: "" },
      { ...item("Short", "short.example"), excerpt: "too short" },
      first,
      duplicate
    ], { now });
    expect(result.ready_for_claim_review).toBe(false);
    expect(result.rejected_sources.map(source => source.reason)).toContain("invalid_source_url");
    expect(result.rejected_sources.map(source => source.reason)).toContain("missing_source_metadata");
    expect(result.rejected_sources.map(source => source.reason)).toContain("invalid_excerpt");
    expect(result.rejected_sources.map(source => source.reason)).toContain("duplicate_source_url");
  });

  it("caps assessment at four items and clamps thresholds", () => {
    const result = assessResearchEvidence([
      item("A", "a.example"), item("B", "b.example"), item("C", "c.example"),
      item("D", "d.example"), item("E", "e.example")
    ], { now, minIndependentSources: 99, maxAgeDays: 999 });
    expect(result.accepted_sources).toHaveLength(4);
    expect(result.required_independent_sources).toBe(4);
    expect(result.max_source_age_days).toBe(90);
  });
});
