import { describe, it } from "node:test";\nimport { expect } from "./test-compat.mjs";
import { retrieveResearchEvidence } from "../src/research-evidence.mjs";

const signal = {
  source: "OpenAI News",
  title: "Research update",
  url: "https://openai.com/index/research-update",
  published_at: "2026-11-18T10:00:00.000Z"
};
const html = "<html><body><nav>Menu</nav><main><h1>Research</h1><article><p>" +
  "Evidence text about AI systems and their evaluation. ".repeat(5) +
  "<script>secret()</script></p></article></main><footer>Footer</footer></body></html>";

describe("bounded research evidence retrieval", () => {
  it("fetches only allowlisted source pages and returns a provenance-bound excerpt", async () => {
    const requests = [];
    const result = await retrieveResearchEvidence([signal], {
      now: Date.parse("2026-11-18T12:00:00.000Z"),
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      }
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].options.method).toBe("GET");
    expect(requests[0].options.redirect).toBe("error");
    expect(result.retrieved).toBe(1);
    expect(result.evidence[0]).toMatchObject({
      source: "OpenAI News",
      url: signal.url,
      status: "source_retrieved_not_fact_checked",
      retrieved_at: "2026-11-18T12:00:00.000Z"
    });
    expect(result.evidence[0].excerpt).toContain("Evidence text");
    expect(result.evidence[0].excerpt).not.toContain("secret");
    expect(result.evidence[0].excerpt).not.toContain("Footer");
    expect(JSON.stringify(result)).not.toContain("<html>");
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(8192);
  });

  it("rejects off-domain, non-HTTPS and non-allowlisted paths before making requests", async () => {
    let calls = 0;
    const result = await retrieveResearchEvidence([
      { ...signal, url: "https://evil.example/index/x" },
      { ...signal, url: "http://openai.com/index/x" },
      { ...signal, url: "https://openai.com/account/profile" }
    ], { fetchImpl: async () => { calls++; return new Response(html); } });
    expect(calls).toBe(0);
    expect(result.retrieved).toBe(0);
    expect(result.evidence.every(item => item.status === "rejected_url")).toBe(true);
  });

  it("rejects redirects, non-HTML content and oversized bodies", async () => {
    const cases = [
      async () => new Response(html, { status: 200, headers: { "content-type": "text/html", "content-length": "120001" } }),
      async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      async () => ({ ok: true, status: 200, redirected: true, url: "https://evil.example/steal", headers: new Headers({ "content-type": "text/html" }), body: new Response(html).body })
    ];
    for (const fetchImpl of cases) {
      const result = await retrieveResearchEvidence([signal], { fetchImpl });
      expect(result.retrieved).toBe(0);
      expect(result.evidence[0].excerpt).toBe("");
    }
  });

  it("caps the number of retrieved pages and excerpt size", async () => {
    let calls = 0;
    const result = await retrieveResearchEvidence(Array.from({ length: 8 }, (_, i) => ({
      ...signal, title: "Item " + i
    })), { fetchImpl: async () => { calls++; return new Response(html, { headers: { "content-type": "text/html" } }); } });
    expect(calls).toBe(4);
    expect(result.attempts).toBe(4);
    expect(result.evidence.every(item => item.excerpt.length <= 600)).toBe(true);
  });
});
