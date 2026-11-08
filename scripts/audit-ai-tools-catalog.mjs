import fs from "node:fs";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const asOfArg = args.find(x => x.startsWith("--as-of="))?.slice(8);
const positionalArgs = args.filter(x => !x.startsWith("--"));
const mainPath = positionalArgs[0] || "data/ai-tools.json";
const candidatePath = positionalArgs[1] || "docs/reviews/ai-tools-candidates-2026-11-02.json";
const asOfDate = asOfArg || new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());

const validDate = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
if (!validDate(asOfDate)) throw new Error("Invalid --as-of date");

const readTools = path => {
  const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
  if (!parsed || !Array.isArray(parsed.tools)) throw new Error(path + ": expected tools[]");
  return parsed.tools;
};
const main = readTools(mainPath);
const candidates = fs.existsSync(candidatePath) ? readTools(candidatePath) : [];
const norm = value => String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const domainOf = value => {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    // For code-hosting URLs, compare owner/repository identity instead of
    // treating every project on github.com or gitlab.com as the same domain.
    if (["github.com", "gitlab.com", "bitbucket.org", "codeberg.org"].includes(host)) {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) return host + "/" + parts[0].toLowerCase() + "/" + parts[1].toLowerCase();
    }
    return host;
  } catch { return ""; }
};
const indexBy = (items, keyFn) => {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
};
const mainIds = indexBy(main, t => norm(t.id));
const mainNames = indexBy(main, t => norm(t.name) + "::" + norm(t.vendor));
const mainDomains = indexBy(main, t => domainOf(t.website));
const duplicateCandidates = candidates.map(tool => ({
  id: tool.id,
  id_matches: (mainIds.get(norm(tool.id)) || []).map(x => x.id),
  name_matches: main.filter(x => norm(x.name) === norm(tool.name)).map(x => x.id),
  name_vendor_matches: (mainNames.get(norm(tool.name) + "::" + norm(tool.vendor)) || []).map(x => x.id),
  domain_matches: (mainDomains.get(domainOf(tool.website)) || []).map(x => x.id)
})).filter(x => x.id_matches.length || x.name_matches.length || x.name_vendor_matches.length || x.domain_matches.length);
const hardDuplicateCandidates = duplicateCandidates.filter(x =>
  x.id_matches.length || x.name_matches.length || x.name_vendor_matches.length
);
const domainOnlyCandidateWarnings = duplicateCandidates.filter(x =>
  !x.id_matches.length && !x.name_matches.length && !x.name_vendor_matches.length && x.domain_matches.length
);
const candidatePairDuplicates = [];
for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
  const a = candidates[i], b = candidates[j], reasons = [];
  if (norm(a.id) === norm(b.id)) reasons.push("same_id");
  if (norm(a.name) === norm(b.name)) reasons.push("same_name");
  if (norm(a.name) === norm(b.name) && norm(a.vendor) === norm(b.vendor)) reasons.push("same_name_and_vendor");
  if (domainOf(a.website) && domainOf(a.website) === domainOf(b.website)) reasons.push("same_official_domain");
  if (reasons.length) candidatePairDuplicates.push({ first: a.id, second: b.id, reasons });
}

const ageDays = value => (Date.parse(asOfDate + "T00:00:00Z") - Date.parse(value + "T00:00:00Z")) / 86400000;
const stale = main.filter(tool => !validDate(tool.last_verified) || ageDays(tool.last_verified) > 30)
  .map(tool => ({ id: tool.id, name: tool.name, last_verified: tool.last_verified }));
const invalidDates = main.filter(tool => !validDate(tool.last_verified)).map(tool => tool.id);
const futureDates = main.filter(tool => validDate(tool.last_verified) && ageDays(tool.last_verified) < 0)
  .map(tool => ({ id: tool.id, name: tool.name, last_verified: tool.last_verified }));
const pricingUnknown = main.filter(tool => tool.pricing_status === "unknown").map(tool => tool.id);
const recordsNeedingEditorialReview = main.filter(tool => tool.verification_status !== "verified").map(tool => tool.id);
const verifiedUnknownPricing = main.filter(tool => tool.verification_status === "verified" && tool.pricing_status === "unknown")
  .map(tool => tool.id);
const missingSources = main.filter(tool => !Array.isArray(tool.official_sources) || tool.official_sources.length === 0)
  .map(tool => tool.id);
const candidateStatusWarnings = candidates.filter(tool => tool.verification_status !== "needs_review").map(tool => tool.id);

const strictBlockers = [
  ...stale.map(x => ({ type: "stale_over_30_days", id: x.id })),
  ...invalidDates.map(id => ({ type: "invalid_date", id })),
  ...futureDates.map(x => ({ type: "future_verification_date", id: x.id })),
  ...missingSources.map(id => ({ type: "missing_official_sources", id })),
  ...candidateStatusWarnings.map(id => ({ type: "candidate_not_needs_review", id })),
  ...hardDuplicateCandidates.map(x => ({ type: "candidate_matches_main_catalog", id: x.id, matches: x })),
  ...candidatePairDuplicates.map(x => ({ type: "duplicate_candidates", pair: x })),
  ...verifiedUnknownPricing.map(id => ({ type: "verified_record_has_unknown_pricing", id }))
];

const report = {
  as_of: asOfDate,
  strict_mode: strict,
  main_catalog: {
    count: main.length,
    stale_over_30_days: stale,
    future_verification_dates: futureDates,
    invalid_dates: invalidDates,
    pricing_status_unknown: pricingUnknown,
    records_needing_editorial_review: recordsNeedingEditorialReview,
    verified_with_unknown_pricing: verifiedUnknownPricing,
    missing_official_sources: missingSources
  },
  candidate_queue: {
    count: candidates.length,
    matches_against_main: duplicateCandidates,
    hard_duplicates_against_main: hardDuplicateCandidates,
    domain_only_warnings: domainOnlyCandidateWarnings,
    duplicate_pairs_inside_queue: candidatePairDuplicates,
    not_needs_review: candidateStatusWarnings
  },
  strict_blockers: strictBlockers,
  note: "Needs-review records remain visible as review warnings and do not fail strict mode by themselves. Strict mode fails stale or invalid verification dates, missing official sources, duplicate candidates, candidate status drift, future dates, or verified records with unknown pricing. Domain matches are review warnings, not automatic duplicates. No network requests are performed."
};
console.log(JSON.stringify(report, null, 2));

const baselineFailures = invalidDates.length || missingSources.length || candidateStatusWarnings.length ||
  hardDuplicateCandidates.length || candidatePairDuplicates.length;
if ((strict && strictBlockers.length) || (!strict && baselineFailures)) process.exitCode = 1;
