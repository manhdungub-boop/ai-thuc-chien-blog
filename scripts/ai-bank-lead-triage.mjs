import fs from "node:fs/promises";

const catalogPath = "data/ai-tools.json";
const discoveryPath = "reports/ai-bank/discovery.json";
const outputPath = "reports/ai-bank/triage.json";
const markdownPath = "reports/ai-bank/triage.md";

function hostOf(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.hostname.toLowerCase().replace(/^www\\./, "") : null;
  } catch { return null; }
}
function normalize(value = "") {
  return String(value).normalize("NFKD").replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function tokenSet(value) {
  return new Set(normalize(value).split(/\\s+/).filter(token => token.length >= 3));
}
function overlap(a, b) {
  const left = tokenSet(a), right = tokenSet(b);
  return [...left].some(token => right.has(token));
}

const [catalogRaw, discoveryRaw] = await Promise.all([
  fs.readFile(catalogPath, "utf8"), fs.readFile(discoveryPath, "utf8")
]);
const catalog = JSON.parse(catalogRaw);
const discovery = JSON.parse(discoveryRaw);
if (!Array.isArray(catalog.tools) || !Array.isArray(discovery.leads)) {
  throw new Error("Invalid AI Bank catalog or discovery report schema");
}

const entries = catalog.tools.map(tool => {
  const hosts = [tool.website, ...(tool.official_sources || [])].map(hostOf).filter(Boolean);
  return { id: tool.id, name: tool.name, vendor: tool.vendor || "", hosts };
});
const seenUrls = new Set();
const seenTitles = new Set();
const results = discovery.leads.map(lead => {
  const url = hostOf(lead.url);
  const titleKey = normalize(lead.title);
  const duplicateUrl = seenUrls.has(lead.url);
  const duplicateTitle = titleKey && seenTitles.has(titleKey);
  seenUrls.add(lead.url);
  if (titleKey) seenTitles.add(titleKey);

  const matches = entries.filter(tool =>
    (url && tool.hosts.some(host => url === host || url.endsWith("." + host) || host.endsWith("." + url))) ||
    overlap(lead.title, tool.vendor) || overlap(lead.title, tool.name)
  );
  return {
    ...lead,
    triage_status: duplicateUrl || duplicateTitle ? "duplicate_lead" :
      matches.length ? "existing_catalog_vendor_or_source" : "manual_product_identification_required",
    possible_catalog_matches: matches.map(({ id, name, vendor }) => ({ id, name, vendor })),
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
  schema_version: "1.0.0",
  generated_at: new Date().toISOString(),
  catalog_generated_at: catalog.generated_at || null,
  discovery_generated_at: discovery.generated_at || null,
  catalog_tool_count: catalog.tools.length,
  discovery_lead_count: results.length,
  triage_counts: counts,
  policy: "Heuristic triage only. A source/vendor match is not proof that an announcement describes an AI product. No tool identity, pricing, license, quota or verification status is inferred. No catalog writes or public publishing.",
  leads: results
};
await fs.writeFile(outputPath, JSON.stringify(report, null, 2) + "\\n");
const lines = [
  "# AI Bank — discovery triage",
  "",
  "- Catalog entries compared: " + report.catalog_tool_count,
  "- Discovery leads reviewed: " + report.discovery_lead_count,
  "- Classification counts: " + Object.entries(counts).map(([key, value]) => key + "=" + value).join("; "),
  "- A match means only that the announcement may relate to an existing vendor/source; it does not establish product identity.",
  "- All leads remain unverified. No catalog write or public publishing is permitted by this report.",
  "",
  "## Leads requiring product identification",
  ...results.filter(x => x.triage_status === "manual_product_identification_required")
    .map(x => "- [" + String(x.title).replace(/[\\[\\]()*_]/g, "") + "](" + x.url + ") — " + x.source),
  "",
  "## Possible existing-vendor overlap",
  ...results.filter(x => x.triage_status === "existing_catalog_vendor_or_source")
    .map(x => "- [" + String(x.title).replace(/[\\[\\]()*_]/g, "") + "](" + x.url + ") — " +
      x.possible_catalog_matches.map(m => m.name).join(", ")),
  ""
];
await fs.writeFile(markdownPath, lines.join("\\n"));
console.log("AI Bank triage: " + results.length + " leads; " +
  (counts.manual_product_identification_required || 0) + " need product identification; no catalog changes.");
