import { reviewArticleDraft } from "./article-quality-gate.mjs";
import { classifyResearchPublisher } from "./research-publisher-policy.mjs";

const MAX_SOURCES = 4;
function blocked(reason) {
  return { prepared: false, status: "authoring_brief_blocked", reason, draft_created: false, publication_authorized: false };
}
function slugify(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "");
}
/**
 * Builds a human-authoring scaffold from retrieved research metadata only.
 * It never converts source excerpts into article prose or factual claims.
 * The result intentionally fails the article quality gate until human authorship
 * and claim-level evidence review are complete.
 */
export function buildArticleAuthoringBrief({ topic, researchEvidence, now = Date.now() }) {
  if (typeof topic !== "string" || topic.trim().length < 5 || topic.length > 200 ||
      !Array.isArray(researchEvidence) || !Number.isFinite(now)) return blocked("invalid_authoring_brief_input");

  const unique = new Map();
  for (const item of researchEvidence) {
    if (item?.status !== "source_retrieved_not_fact_checked" ||
        typeof item.title !== "string" || !item.title.trim() ||
        typeof item.source !== "string" || typeof item.url !== "string" ||
        typeof item.retrieved_at !== "string" || !Number.isFinite(Date.parse(item.retrieved_at)) ||
        typeof item.excerpt !== "string" || item.excerpt.length < 80) continue;
    const provenance = classifyResearchPublisher(item.source, item.url);
    if (!provenance.accepted || unique.has(item.url)) continue;
    unique.set(item.url, {
      title: item.title.slice(0, 200), publisher: provenance.publisher.name,
      url: item.url, accessed_at: item.retrieved_at
    });
    if (unique.size === MAX_SOURCES) break;
  }
  if (unique.size < 3) return blocked("at_least_three_allowlisted_retrieved_sources_required");

  const safeTopic = topic.trim();
  const slug = slugify(safeTopic);
  if (!slug) return blocked("topic_slug_unavailable");
  const sources = [...unique.values()];
  const body = [
    "## Mục tiêu và phạm vi",
    "[TÁC GIẢ BỔ SUNG: xác định vấn đề thực tế, đối tượng độc giả và phạm vi bài viết. Không suy diễn từ trích đoạn nguồn.]",
    "",
    "## Bối cảnh và khái niệm",
    "[TÁC GIẢ BỔ SUNG: giải thích khái niệm bằng hiểu biết đã được kiểm chứng; gắn trích dẫn [1]–[3] đúng với từng luận điểm.]",
    "",
    "## Phân tích bằng chứng",
    "[TÁC GIẢ BỔ SUNG: đối chiếu các nguồn độc lập, nêu rõ điểm thống nhất, khác biệt và giới hạn của bằng chứng.]",
    "",
    "## Quy trình áp dụng thực tế",
    "[TÁC GIẢ BỔ SUNG: cung cấp các bước thực hiện, điều kiện tiên quyết, ví dụ đã kiểm tra và cảnh báo rủi ro.]",
    "",
    "## Kết luận và khuyến nghị",
    "[TÁC GIẢ BỔ SUNG: chỉ kết luận những điều được bằng chứng hỗ trợ; phân biệt rõ nhận định và dữ kiện.]",
    "",
    "## Tài liệu tham khảo",
    ...sources.map((source, index) => `[${index + 1}] ${source.title} — ${source.publisher}`),
    "",
    "## Ghi chú biên tập",
    "[BẮT BUỘC: kiểm tra sự thật, đối chiếu từng tuyên bố với nguồn, rà soát tính nguyên bản và quyền sử dụng trước khi gửi duyệt.]"
  ].join("\n");
  const draft = {
    title: safeTopic.slice(0, 70), slug,
    meta_description: `Đề cương biên tập về ${safeTopic}. Nội dung cần được tác giả bổ sung, kiểm chứng nguồn và rà soát trước khi duyệt.`.slice(0, 160),
    author: "DUNG - AI", language: "vi", body_markdown: body, sources,
    copyright_notice: "© DUNG - AI. Bản nháp nội bộ; trích dẫn nguồn theo danh mục, cần rà soát quyền sử dụng trước khi công bố."
  };
  return {
    prepared: true, status: "human_authoring_required", draft,
    quality_review: reviewArticleDraft(draft), draft_created: false,
    claims_generated: false, publication_authorized: false,
    notice: "Đây chỉ là đề cương biên tập. Trích đoạn nghiên cứu không được chuyển thành nội dung khẳng định; tác giả phải tự viết, kiểm chứng và lập claim manifest."
  };
}
