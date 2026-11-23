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
function assessEditorialRelevance(title = "", source = "") {
  const text = clean(title + " " + source).toLowerCase();
  const rules = [
    { category: "model_or_product_release", points: 5, terms: ["introducing", "launch", "release", "available", "new model", "open model", "model card"] },
    { category: "practical_workflow_or_tutorial", points: 4, terms: ["how to", "guide", "tutorial", "build ", "workflow", "deploy", "integration"] },
    { category: "developer_tooling_or_open_source", points: 4, terms: ["open source", "github", "sdk", "api", "llama.cpp", "transformers", "mcp"] },
    { category: "security_privacy_or_safety", points: 4, terms: ["security", "privacy", "safety", "secure", "data protection", "scam detection"] },
    { category: "benchmark_or_evaluation", points: 3, terms: ["benchmark", "leaderboard", "evaluation", "performance", "accuracy"] },
    { category: "research_or_science", points: 2, terms: ["research", "science", "paper", "study"] },
    { category: "customer_case_study", points: -2, terms: ["customer story", "how .* uses", "doubles revenue", "case study", "customer"] }
  ];
  const matches = rules.filter(rule => rule.terms.some(term => {
    if (term.includes(".*")) return new RegExp(term, "i").test(text);
    return text.includes(term);
  }));
  const best = matches.filter(x => x.points > 0).sort((a, b) => b.points - a.points)[0];
  const score = matches.reduce((sum, item) => sum + item.points, 0);
  return { category: best?.category || "general_ai_news", score, signals: matches.map(x => x.category) };
}
function questionsFor(category) {
  const common = [
    "Nguồn chính thức xác nhận điều gì; nội dung nào chỉ là tuyên bố tiếp thị?",
    "Người dùng tại Việt Nam có thể truy cập không; cần tài khoản, khu vực, thiết bị hay cấu hình nào?",
    "Giá, hạn mức miễn phí, quota và điều kiện sử dụng hiện hành là gì?",
    "Dữ liệu đầu vào/đầu ra được xử lý, lưu trữ và dùng để huấn luyện ra sao?",
    "Điểm hạn chế, rủi ro bảo mật, bản quyền hoặc giấy phép nào cần cảnh báo?",
    "Thông tin nào chưa có nguồn chính thức xác nhận và phải để trạng thái chưa rõ?"
  ];
  const specific = {
    model_or_product_release: [
      "Model/sản phẩm nào được phát hành; ngày phát hành và kênh truy cập chính xác?",
      "Có model card, tài liệu kỹ thuật, giới hạn context, modality hoặc benchmark nào?",
      "Có thể dùng miễn phí trên giao diện web/app hay chỉ qua API trả phí?"
    ],
    practical_workflow_or_tutorial: [
      "Quy trình có thể tái hiện từ đầu đến cuối bằng công cụ miễn phí nào?",
      "Cần những bước, quyền truy cập, cấu hình và dữ liệu mẫu nào?",
      "Tiêu chí kiểm thử đầu ra, thời gian, độ chính xác và lỗi thường gặp là gì?"
    ],
    developer_tooling_or_open_source: [
      "Kho mã nguồn chính thức, giấy phép, phiên bản và trạng thái bảo trì hiện tại?",
      "Yêu cầu hệ điều hành, phần cứng, CUDA/RAM và phụ thuộc kỹ thuật?",
      "Có phát sinh phí hạ tầng, API, model weights hoặc dịch vụ bên ngoài không?"
    ],
    security_privacy_or_safety: [
      "Mối đe dọa hoặc rủi ro cụ thể nào được xử lý; phạm vi bảo vệ là gì?",
      "Dữ liệu nào được thu thập, thời hạn lưu trữ, vị trí lưu trữ và quyền kiểm soát?",
      "Những cấu hình sai hoặc tình huống nào vẫn có thể gây rủi ro?"
    ],
    benchmark_or_evaluation: [
      "Benchmark dùng bộ dữ liệu, baseline, phiên bản và phương pháp nào?",
      "Kết quả có độc lập, tái lập được và phù hợp tác vụ người dùng Việt Nam không?",
      "Chi phí, phần cứng và điều kiện thử nghiệm có làm sai lệch so sánh không?"
    ],
    research_or_science: [
      "Bài nghiên cứu gốc, tác giả, phương pháp và giới hạn thực nghiệm?",
      "Kết quả nào đã được kiểm chứng độc lập và kết quả nào còn sơ bộ?",
      "Có ứng dụng thực tiễn miễn phí nào phù hợp người dùng phổ thông?"
    ],
    general_ai_news: [
      "Tin này có tạo ra công cụ, tính năng hoặc cách làm mới mà người dùng có thể tự kiểm chứng không?",
      "Có trang sản phẩm/tài liệu hỗ trợ chính thức nào bổ sung cho bài thông báo?",
      "Có đủ giá trị thực hành để viết bài hướng dẫn thay vì chỉ tóm tắt tin tức không?"
    ]
  };
  return [...(specific[category] || specific.general_ai_news), ...common];
}
const [discoveryRaw, triageRaw] = await Promise.all([fs.readFile(discoveryPath, "utf8"), fs.readFile(triagePath, "utf8")]);
const discovery = JSON.parse(discoveryRaw), triage = JSON.parse(triageRaw);
if (!Array.isArray(discovery.leads) || !Array.isArray(triage.leads)) throw new Error("Invalid discovery or triage report schema.");
const triageByUrl = new Map(triage.leads.map(lead => [lead.url, lead]));
const leads = discovery.leads.map(lead => {
  const url = safeOfficialUrl(lead.url);
  const relevance = assessEditorialRelevance(lead.title, lead.source);
  return { ...lead, url, relevance };
}).filter(lead => lead.url && clean(lead.title))
  .sort((a, b) => b.relevance.score - a.relevance.score || dateValue(b.published) - dateValue(a.published))
  .slice(0, MAX_TOPICS);
const briefs = leads.map((lead, index) => {
  const matched = triageByUrl.get(lead.url);
  return {
    priority: index + 1, source_title: clean(lead.title), source_url: lead.url,
    source_name: clean(lead.source || "Official source"), published_at: clean(lead.published || ""),
    relevance_category: lead.relevance.category, relevance_score: lead.relevance.score,
    relevance_signals: lead.relevance.signals,
    ai_bank_triage_status: matched?.triage_status || "not_triaged",
    possible_catalog_matches: (matched?.possible_catalog_matches || []).map(x => ({id: clean(x.id), name: clean(x.name), vendor: clean(x.vendor), match_reason: clean(x.match_reason)})),
    proposed_editorial_angle: "Phân tích và kiểm chứng giá trị thực hành của chủ đề này đối với người dùng Việt Nam; không suy diễn tính năng hoặc mức miễn phí từ tiêu đề.",
    research_questions: questionsFor(lead.relevance.category),
    publication_gate: "HOLD — research lead only; not a verified article or AI Bank entry."
  };
});
const report = {
  schema_version: "1.1.0", generated_at: new Date().toISOString(),
  source_count: discovery.sources_checked, discovery_lead_count: discovery.leads.length,
  topic_brief_count: briefs.length,
  policy: "Ranked research briefs only. Relevance scores are transparent title-keyword heuristics, not factual verification. No publication or AI Bank writes until all claims pass official-source review.",
  briefs
};
await fs.mkdir("reports/editorial", { recursive: true });
await fs.writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
const lines = [
  "# AI Thực Chiến — ranked weekly editorial research shortlist", "",
  "- Generated: " + report.generated_at,
  "- Official-feed leads scanned: " + report.discovery_lead_count,
  "- Research briefs created: " + report.topic_brief_count,
  "- Ranking: title-keyword relevance + recency; ranking is not verification.",
  "- Status: research queue only; no article publication and no AI Bank writes.", ""
];
for (const brief of briefs) {
  lines.push("## " + brief.priority + ". " + escapeMarkdown(brief.source_title), "");
  lines.push("- **Official source:** [" + escapeMarkdown(brief.source_name) + "](" + brief.source_url + ")");
  if (brief.published_at) lines.push("- **Published:** " + escapeMarkdown(brief.published_at));
  lines.push("- **Research priority:** " + brief.relevance_category + " (heuristic score " + brief.relevance_score + ")");
  lines.push("- **AI Bank triage:** " + brief.ai_bank_triage_status);
  if (brief.possible_catalog_matches.length) lines.push("- **Possible catalog overlap (not proof):** " + brief.possible_catalog_matches.map(x => escapeMarkdown(x.name + " — " + x.match_reason)).join("; "));
  lines.push("- **Proposed angle:** " + brief.proposed_editorial_angle, "", "**Research questions**", "");
  for (const question of brief.research_questions) lines.push("- " + question);
  lines.push("", "**Publication gate:** HOLD — research lead only; not a verified article or AI Bank entry.", "", "---", "");
}
lines.push("## Mandatory editorial quality gate", "");
for (const item of [
  "Read the full official source and at least one relevant official product/help/pricing document.",
  "Verify product identity, release status and date; source/vendor overlap is not product identity.",
  "Verify Vietnam availability, free tier, quotas, pricing, license and platform support on the review date.",
  "Test important steps where practical; label untested claims and limitations.",
  "Assess privacy, data retention, security, copyright and user safety.",
  "Add citations next to factual claims and record the checked date.",
  "Use original examples and visuals or assets with compatible licenses; include attribution.",
  "Run editorial, SEO, link, duplication and factual checks before public release."
]) lines.push("- [ ] " + item);
lines.push("", "No automatic publication. No catalog mutation. No paid API or external AI generation.", "");
await fs.writeFile(outputPath, lines.join("\n"), "utf8");
console.log("Editorial research briefs: " + briefs.length + " ranked; all held for source verification; no publishing.");
