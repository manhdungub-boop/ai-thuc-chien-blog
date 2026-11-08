import fs from "node:fs";

const file = process.argv[2] || "data/ai-tools.json";
const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
const errors = [];
const warnings = [];
const allowedPricing = new Set(["free","freemium","paid","trial_or_credits","self_hosted_free_and_cloud_paid","unknown"]);
const allowedPricingStatus = new Set(["verified_free","verified_free_tier","limited_credits","paid_only","self_hosted_free","unknown"]);
const allowedVerification = new Set(["verified","needs_review","stale","disputed"]);
const allowedStatus = new Set(["active","deprecated","closed","rejected"]);
const ids = new Set(), names = new Map(), domains = new Map();
const required = ["id","name","vendor","website","categories","pricing_model","pricing_status","license","platforms","description","free_tier_summary","official_sources","last_verified","verification_status","status","tags"];
const normalized = value => String(value || "").trim().toLocaleLowerCase("en").replace(/\s+/g," ");
const hostOf = value => {
  const u = new URL(value);
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (["github.com", "gitlab.com", "bitbucket.org", "codeberg.org"].includes(host)) {
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return host + "/" + parts[0].toLowerCase() + "/" + parts[1].toLowerCase();
  }
  return host;
};

if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.tools)) {
  console.error("Catalog must be an object with a tools array."); process.exit(1);
}
for (const [i, tool] of catalog.tools.entries()) {
  const at = `tools[${i}]`;
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) { errors.push(`${at}: must be an object`); continue; }
  for (const key of required) if (!(key in tool)) errors.push(`${at}: missing ${key}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tool.id || "")) errors.push(`${at}: invalid stable id`);
  if (ids.has(tool.id)) errors.push(`${at}: duplicate id ${tool.id}`);
  ids.add(tool.id);
  for (const key of ["name","vendor","description","license"]) if (typeof tool[key] !== "string" || !tool[key].trim()) errors.push(`${at}: ${key} must be a non-empty string`);
  for (const field of [tool.website, ...(Array.isArray(tool.official_sources) ? tool.official_sources : [])]) {
    try { const u = new URL(field); if (!["https:","http:"].includes(u.protocol)) throw new Error(); }
    catch { errors.push(`${at}: invalid URL ${field}`); }
  }
  if (!Array.isArray(tool.categories) || !tool.categories.length || tool.categories.some(x => typeof x !== "string" || !x.trim())) errors.push(`${at}: categories must be a non-empty string array`);
  if (!Array.isArray(tool.platforms) || !Array.isArray(tool.official_sources) || !tool.official_sources.length || !Array.isArray(tool.tags)) errors.push(`${at}: platforms, official_sources and tags must be arrays (sources non-empty)`);
  if (!allowedPricing.has(tool.pricing_model)) errors.push(`${at}: unsupported pricing_model`);
  if (!allowedPricingStatus.has(tool.pricing_status)) errors.push(`${at}: unsupported pricing_status`);
  if (!allowedVerification.has(tool.verification_status)) errors.push(`${at}: unsupported verification_status`);
  if (!allowedStatus.has(tool.status)) errors.push(`${at}: unsupported status`);
  const checkedDate = new Date((tool.last_verified || "") + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tool.last_verified || "") || Number.isNaN(checkedDate.getTime()) || checkedDate.toISOString().slice(0,10) !== tool.last_verified) errors.push(`${at}: last_verified must be a real YYYY-MM-DD calendar date`);
  if (tool.verification_status === "verified" && tool.pricing_status === "unknown") errors.push(`${at}: unknown pricing cannot be fully verified`);
  if (["verified_free","verified_free_tier","paid_only","limited_credits","self_hosted_free"].includes(tool.pricing_status) && tool.verification_status !== "verified") warnings.push(`${at}: pricing status is asserted but record is not verified; retain review label`);
  const nameKey = normalized(tool.name) + "::" + normalized(tool.vendor);
  if (names.has(nameKey)) errors.push(`${at}: duplicate name/vendor with ${names.get(nameKey)}`);
  else names.set(nameKey, tool.id);
  try {
    const domain = hostOf(tool.website);
    if (domains.has(domain)) warnings.push(`${at}: shared vendor domain ${domain} also used by ${domains.get(domain)}; review product-level duplication`);
    else domains.set(domain, tool.id);
  } catch {}
}
if (errors.length) { console.error("ERRORS:\n" + errors.join("\n")); process.exit(1); }
console.log(`Catalog structure OK: ${catalog.tools.length} records; ${ids.size} unique IDs.`);
if (warnings.length) console.warn(`REVIEW WARNINGS (${warnings.length}):\n` + warnings.join("\n"));
