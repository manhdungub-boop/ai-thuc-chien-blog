import fs from "node:fs/promises";
const discoveryPath = "reports/ai-bank/discovery.json";
const triagePath = "reports/ai-bank/triage.json";
const outputPath = "reports/editorial/weekly-topic-research-briefs.md";
const jsonPath = "reports/editorial/weekly-topic-research-briefs.json";
const MAX_TOPICS = 15;
function clean(value = "") { return String(value).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim(); }
function escapeMarkdown(value = "") { return clean(value).replace(/([\\*_{}\[\]()#+.!|>])/g, "\\$1"); }
function safeOfficialUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
function dateValue(value) { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? parsed : 0; }
const [discoveryRaw, triageRaw] = await Promise.all([fs.readFile(discoveryPath, "utf8"), fs.readFile(triagePath, "utf8")]);
const discovery = JSON.parse(discoveryRaw), triage = JSON.parse(triageRaw);
if (!Array.isArray(discovery.leads) || !Array.isArray(triage.leads)) throw new Error("Invalid discovery or triage report schema.");
const triageByUrl = new Map(triage.leads.map(lead => [lead.url, lead]));
const leads = discovery.leads.map(lead => ({ ...lead, url: safeOfficialUrl(lead.url) }))
  .filter(lead => lead.url && clean(lead.title))
  .sort((a, b) => dateValue(b.published) - dateValue(a.published)).slice(0, MAX_TOPICS);
const questions = [
  "Thông báo này nói chính xác về sản phẩm, tính năng hoặc nghiên cứu nào?",
  "Người dùng tại Việt Nam có thể truy cập hay chưa; có yêu cầu tài khoản, khu vực hoặc thiết bị nào?",
  "Giá, hạn mức miễn phí, quota và điều kiện sử dụng hiện hành là gì?",
  "Dữ liệu đầu vào/đầu ra được xử lý và lưu trữ ra sao; có rủi ro riêng tư hoặc bảo mật nào?",
  "Có thể tái hiện một quy trình thực tế, đo thời gian/chi phí/chất lượng bằng tiêu chí nào?",
  "Thông tin nào chưa được nguồn chính thức xác nhận và cần ghi rõ là chưa biết?"
];
const briefs = leads.map((lead, index) => {
  const matched = triageByUrl.get(lead.url);
  return {
    priority: index + 1, source_title: clean(lead.title), source_url: lead.url,
    source_name: clean(lead.source || "Official source"), published_at: clean(lead.published || ""),
    ai_bank_triage_status: matched?.triage_status || "not_triaged",
    possible_catalog_matches: (matched?.possible_catalog_matches || []).map(x => ({id: clean(x.id), name: clean(x.name), vendor: clean(x.vendor)})),
    proposed_editorial_angle: "Đánh giá tác động thực tế đối với người dùng Việt Nam; chỉ kết luận sau khi đọc tài liệu gốc.",
    research_questions: questions,
    publication_gate: "HOLD — research lead only; not a verified article or AI Bank entry."
  };
});
const report = {
  schema_version: "1.0.0", generated_at: new Date().toISOString(),
  source_count: discovery.sources_checked, discovery_lead_count: discovery.leads.length,
  topic_brief_count: briefs.length,
  policy: "Research briefs only. No publication or AI Bank writes until all claims pass official-source verification.",
  briefs
};
await fs.mkdir("reports/editorial", { recursive: true });
await fs.writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
const lines = [
  "# AI Thực Chiến — weekly editorial research shortlist", "",
  "- Generated: " + report.generated_at,
  "- Official-feed leads scanned: " + report.discovery_lead_count,
  "- Research briefs created: " + report.topic_brief_count,
  "- Status: research queue only; no article publication and no AI Bank writes.",
  "- Proposed angles are questions to investigate, not verified claims.", ""
];
for (const brief of briefs) {
  lines.push("## " + brief.priority + ". " + escapeMarkdown(brief.source_title), "");
  lines.push("- **Official source:** [" + escapeMarkdown(brief.source_name) + "](" + brief.source_url + ")");
  if (brief.published_at) lines.push("- **Published:** " + escapeMarkdown(brief.published_at));
  lines.push("- **AI Bank triage:** " + brief.ai_bank_triage_status);
  if (brief.possible_catalog_matches.length) lines.push("- **Possible catalog overlap (not proof):** " + brief.possible_catalog_matches.map(x => escapeMarkdown(x.name)).join(", "));
  lines.push("- **Proposed angle:** " + brief.proposed_editorial_angle, "", "**Research before drafting**", "");
  for (const question of brief.research_questions) lines.push("- " + question);
  lines.push("", "**Publication gate:** HOLD — research lead only; not a verified article or AI Bank entry.", "", "---", "");
}
lines.push("## Mandatory editorial quality gate", "");
for (const item of [
  "Read the full official source and at least one relevant official product/help/pricing document.",
  "Verify product identity, release status and date; do not infer from vendor-name overlap.",
  "Verify Vietnam availability, free tier, quotas, pricing, license and platform support on the review date.",
  "Test important steps where practical; label untested claims and limitations.",
  "Assess privacy, data retention, security, copyright and user safety.",
  "Add citations next to factual claims and record the checked date.",
  "Use original examples and visuals or assets with compatible licenses; include attribution.",
  "Run editorial, SEO, link, duplication and factual checks before public release."
]) lines.push("- [ ] " + item);
lines.push("", "No automatic publication. No catalog mutation. No paid API or external AI generation.", "");
await fs.writeFile(outputPath, lines.join("\n"), "utf8");
console.log("Editorial research briefs: " + briefs.length + " created; all held for verification; no publishing.");
