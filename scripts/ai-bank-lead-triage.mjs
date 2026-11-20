import fs from "node:fs/promises";

const catalogPath = "data/ai-tools.json";
const discoveryPath = "reports/ai-bank/discovery.json";
const outputPath = "reports/ai-bank/triage.json";
const markdownPath = "reports/ai-bank/triage.md";

function hostOf(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.hostname.toLowerCase().replace(/^www\./, "") : null;
  } catch { return null; }
}
function normalize(value = "") {
  return String(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function containsPhrase(text, phrase) {
  const haystack = " " + normalize(text) + " ";
  const needle = " " + normalize(phrase) + " ";
  return needle.length > 2 && haystack.includes(needle);
}
function classifyLead(lead, entries) {
  const itemHost = hostOf(lead.url);
  const title = normalize(lead.title);
  const nameMatches = entries.filter(tool => containsPhrase(title, tool.name));
  const domainMatches = entries.filter(tool => itemHost && tool.hosts.includes(itemHost));
  const vendorMatches = entries.filter(tool => tool.vendor && containsPhrase(title, tool.vendor));
  if (nameMatches.length) return {
    triage_status: "catalog_tool_name_mentioned",
    possible_catalog_matches: nameMatches.map(tool => ({ id: tool.id, name: tool.name, vendor: tool.vendor, match_reason: "exact_tool_name_phrase_in_title" }))
  };
  if (domainMatches.length) return {
    triage_status: "source_domain_overlap_manual_review",
    possible_catalog_matches: domainMatches.map(tool => ({ id: tool.id, name: tool.name, vendor: tool.vendor, match_reason: "same_official_domain_not_product_identity" }))
  };
  if (vendorMatches.length) return {
    triage_status: "vendor_mentioned_manual_review",
    possible_catalog_matches: vendorMatches.map(tool => ({ id: tool.id, name: tool.name, vendor: tool.vendor, match_reason: "vendor_phrase_only_not_product_identity" }))
  };
  return { triage_status: "manual_product_identification_required", possible_catalog_matches: [] };
}

async function selfTest() {
  const entries = [{ id: "chatgpt", name: "ChatGPT", vendor: "OpenAI", hosts: ["openai.com"] }];
  const product = classifyLead({ title: "Introducing ChatGPT Projects", url: "https://openai.com/news/projects" }, entries);
  if (product.triage_status !== "catalog_tool_name_mentioned") throw new Error("Exact product-name match fixture failed");
  const domainOnly = classifyLead({ title: "A research update", url: "https://openai.com/news/research" }, entries);
  if (domainOnly.triage_status !== "source_domain_overlap_manual_review") throw new Error("Domain overlap must remain manual review");
  const vendorOnly = classifyLead({ title: "OpenAI announces a research partnership", url: "https://example.org/news" }, entries);
  if (vendorOnly.triage_status !== "vendor_mentioned_manual_review") throw new Error("Vendor-only match must remain manual review");
  const unrelated = classifyLead({ title: "An unrelated open model release", url: "https://example.org/news" }, entries);
  if (unrelated.triage_status !== "manual_product_identification_required") throw new Error("Unrelated lead fixture failed");
  console.log("PASS: product-name, domain-overlap, vendor-only and unrelated triage fixtures.");
}

if (process.argv.includes("--self-test")) {
  await selfTest();
} else {
  const [catalogRaw, discoveryRaw] = await Promise.all([
    fs.readFile(catalogPath, "utf8"), fs.readFile(discoveryPath, "utf8")
  ]);
  const catalog = JSON.parse(catalogRaw);
  const discovery = JSON.parse(discoveryRaw);
  if (!Array.isArray(catalog.tools) || !Array.isArray(discovery.leads)) {
    throw new Error("Invalid AI Bank catalog or discovery report schema");
  }

  const entries = catalog.tools.map(tool => ({
    id: tool.id, name: tool.name, vendor: tool.vendor || "",
    hosts: [tool.website, ...(tool.official_sources || [])].map(hostOf).filter(Boolean)
  }));
  const seenUrls = new Set();
  const seenTitles = new Set();
  const results = discovery.leads.map(lead => {
    const titleKey = normalize(lead.title);
    const duplicateUrl = seenUrls.has(lead.url);
    const duplicateTitle = titleKey && seenTitles.has(titleKey);
    seenUrls.add(lead.url);
    if (titleKey) seenTitles.add(titleKey);
    const classification = classifyLead(lead, entries);
    return {
      ...lead,
      triage_status: duplicateUrl || duplicateTitle ? "duplicate_lead" : classification.triage_status,
      possible_catalog_matches: duplicateUrl || duplicateTitle ? [] : classification.possible_catalog_matches,
      verification_status: "unverified",
      catalog_write_allowed: false,
      public_publish_allowed: false
    };
  });
  const counts = results.reduce((out, item) => {
    out[item.triage_status] = (out[item.triage_status] || 0) + 1;
    return out;
  }, {});
  const report = {
    schema_version: "1.1.0",
    generated_at: new Date().toISOString(),
    catalog_generated_at: catalog.generated_at || null,
    discovery_generated_at: discovery.generated_at || null,
    catalog_tool_count: catalog.tools.length,
    discovery_lead_count: results.length,
    triage_counts: counts,
    policy: "Heuristic triage only. Exact tool-name mentions, source-domain overlap and vendor mentions are separate signals; none verifies that an announcement describes the catalog product. No pricing, quota, license or verification status is inferred. No catalog writes or public publishing.",
    leads: results
  };
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + "\n");
  const sections = [
    ["Leads mentioning an exact catalog tool name", "catalog_tool_name_mentioned"],
    ["Leads sharing a catalog source domain — manual review", "source_domain_overlap_manual_review"],
    ["Leads mentioning a catalog vendor only — manual review", "vendor_mentioned_manual_review"],
    ["Leads requiring product identification", "manual_product_identification_required"],
    ["Duplicate leads", "duplicate_lead"]
  ];
  const lines = [
    "# AI Bank — discovery triage", "",
    "- Catalog entries compared: " + report.catalog_tool_count,
    "- Discovery leads reviewed: " + report.discovery_lead_count,
    "- Classification counts: " + Object.entries(counts).map(([key, value]) => key + "=" + value).join("; "),
    "- Domain/vendor overlap is only a review signal, never proof of product identity.",
    "- All leads remain unverified. No catalog write or public publishing is permitted by this report.", ""
  ];
  for (const [heading, status] of sections) {
    lines.push("## " + heading, "");
    for (const item of results.filter(x => x.triage_status === status)) {
      const names = item.possible_catalog_matches.map(match => match.name + " (" + match.match_reason + ")").join(", ");
      lines.push("- [" + String(item.title).replace(/[\[\]()*_]/g, "") + "](" + item.url + ")" +
        (names ? " — " + names : "") + " — " + item.source);
    }
    lines.push("");
  }
  await fs.writeFile(markdownPath, lines.join("\n"));
  console.log("AI Bank triage: " + results.length + " leads; classifications separated by exact product name, source domain and vendor. No catalog changes.");
}
