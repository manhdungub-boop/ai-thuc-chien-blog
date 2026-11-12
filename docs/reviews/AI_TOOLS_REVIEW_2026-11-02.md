# Báo cáo rà soát Ngân hàng AI — 02/11/2026

## Phạm vi và mốc dữ liệu
- Repository: `manhdungub/ai-thuc-chien-blog`
- Branch: `staging/auth-worker-build`
- HEAD trước cập nhật: `898a9a094a3217690f8bf47edead713b8770d2d8`
- Catalog chính: `site-snapshot/data/ai-tools.json`
- Hàng chờ trước rà soát: 7 ứng viên; hàng chờ sau cập nhật: 9 ứng viên.

## Tóm tắt kết quả
| Chỉ số | Kết quả |
|---|---:|
| Công cụ trong catalog chính | 27 |
| Ứng viên mới đề xuất trong lần này | 2 |
| Bản ghi catalog được cập nhật | 4 |
| Link lỗi/ngừng hoạt động xác nhận trong các trang đã mở | 0 |
| Trang nguồn chính thức đã mở để rà soát | 20 |
| URL nguồn duy nhất được liệt kê trong catalog chính | 110 |
| Bản ghi quá 30 ngày tại mốc 02/11/2026 | 0 |
| Bản ghi có `pricing_status=unknown` sau cập nhật | 1 |
| Bản ghi còn `needs_review` sau cập nhật | 4 |
| Trùng ID/tên/nhà cung cấp/site identity giữa hàng chờ và catalog | 0 |
| Trùng giữa các ứng viên trong hàng chờ | 0 |

**Phạm vi link-check:** 20 trang nguồn chính thức đã được mở và đọc; không trang nào trả về lỗi 404/410 rõ ràng. Đây không phải lần kiểm tra HTTP toàn bộ 110 URL. Chưa chạy crawler/link-check toàn danh mục; các URL còn lại cần được kiểm tra bằng script có giới hạn tốc độ. Không kết luận các URL chưa kiểm tra là đang hoạt động.

## Bản ghi catalog đã cập nhật

1. **Flowise** — chuyển `status=deprecated`, `pricing_model=unknown`, `pricing_status=unknown`, `verification_status=needs_review`. Trang sunset chính thức xác nhận code freeze 29/07/2026, repository archive 10/08/2026, npm/Docker deprecated và EOL 31/08/2026. Không khuyến nghị triển khai mới; upstream source vẫn có thể fork theo Apache-2.0.
2. **Hugging Face Hub** — cập nhật `pricing_status=verified_free_tier`. Free account có public storage best-effort và 100GB private storage; trang giá công bố PRO $9/tháng, Team $20/tháng và Enterprise $50/tháng. Free users không có monthly Inference Provider credits; API inference trả theo usage/credits. Bảng rate-limit công khai ghi mốc September 2025 và quota Free có thể thay đổi. Giữ `needs_review` vì license phụ thuộc từng model/dataset/Space và cần rà soát thêm điều khoản dữ liệu.
3. **Adobe Firefly** — cập nhật theo FAQ được Adobe cập nhật 27/10/2026 và trang kế hoạch hiện hành: Free có lượt tạo hằng ngày giới hạn; gói trả phí 2.000/4.000/10.000/50.000 credits/tháng. Đã xác minh mô hình giá/credit từ nguồn chính thức, giữ `pricing_status=limited_credits`; toàn bộ record vẫn `needs_review` cho đến khi biên tập rà soát thêm điều khoản license, quyền sử dụng output và privacy/data terms. Không ghi một mức giá cố định do giá hiển thị phụ thuộc khu vực.
4. **EasyOCR** — xác nhận trang sản phẩm còn hoạt động, hỗ trợ 80+ ngôn ngữ; repository code là Apache-2.0. Model Hub liệt kê các checkpoint nhưng không cung cấp một license rõ ràng cho từng trọng số trên trang đó. Giữ `needs_review`; không suy rộng license của code sang model weights.

## Ứng viên mới được thêm — chưa duyệt công khai

- **Pydantic AI** — Python agent SDK, tool calling và structured output; repository MIT. SDK chạy local không mất phí license; phí inference phụ thuộc model provider. Trạng thái `needs_review`.
- **Haystack** — framework Python cho agent/RAG/pipeline, Apache-2.0. deepset Studio có gói $0 giới hạn 1 workspace, 1 user, 100 pipeline hours, 50 files (tối đa 10MB) và 2 development pipelines; Enterprise báo giá riêng. Trạng thái `needs_review`.

Hai ứng viên được lưu theo đúng schema catalog trong:
`site-snapshot/data/review/ai-tools-candidates-2026-11-02.json`.
Không nhập hai bản ghi vào catalog chính và không tự đánh dấu verified.

## Nguồn chính thức đã mở
- Flowise sunset: https://flowiseai.com/sunset
- Hugging Face pricing, billing, storage limits, rate limits và Inference Providers pricing:
  https://huggingface.co/pricing
  https://huggingface.co/docs/hub/billing
  https://huggingface.co/docs/hub/main/en/storage-limits
  https://huggingface.co/docs/hub/rate-limits
  https://huggingface.co/docs/inference-providers/en/pricing
- Adobe Firefly plans và generative credits FAQ:
  https://www.adobe.com/products/firefly/plans.html
  https://helpx.adobe.com/creative-cloud/apps/generative-ai/generative-credits-faq.html
- EasyOCR overview, Model Hub và code license:
  https://www.jaided.ai/easyocr/
  https://www.jaided.ai/easyocr/modelhub/
  https://github.com/JaidedAI/EasyOCR/blob/master/LICENSE
- Pydantic AI docs, repository và MIT license:
  https://ai.pydantic.dev/
  https://github.com/pydantic/pydantic-ai
  https://github.com/pydantic/pydantic-ai/blob/main/LICENSE
- Haystack docs, repository, Apache-2.0 license và deepset pricing:
  https://docs.haystack.deepset.ai/docs/intro
  https://github.com/deepset-ai/haystack
  https://github.com/deepset-ai/haystack/blob/main/LICENSE
  https://www.deepset.ai/pricing

- Nguồn khám phá đã mở nhưng chưa đưa vào hàng chờ: https://lmstudio.ai/pricing (trang giá hiện mang tên Bionic, cần làm rõ định danh sản phẩm trước khi tạo hồ sơ riêng); https://www.llamaindex.ai/pricing (nội dung là dịch vụ LlamaParse, không đồng nhất với framework LlamaIndex OSS nên không thêm nhầm sản phẩm).

## Kiểm soát và việc cần biên tập
- Audit script đã phân biệt rõ `pricing_status_unknown` với `records_needing_editorial_review`; không gộp tình trạng giá chưa rõ với vấn đề license/pháp lý.
- Audit script nhận diện GitHub/GitLab/Bitbucket/Codeberg theo owner/repository path để tránh báo trùng giả do nhiều sản phẩm dùng chung host.
- Link checker được hạ xuống tuần tự: 10 giây timeout, 1,2 giây giữa request, không retry khi nhận 429.
- Cần biên tập: xác minh license từng model weight của EasyOCR; rà soát privacy/data terms của Hugging Face; xác minh tình trạng/pricing Flowise Cloud sau EOL; xác minh điều kiện khu vực của deepset Studio và từng provider mà Pydantic AI kết nối.
- Chạy validator, audit và link checker trong môi trường Node.js/CI khi có hạn mức phù hợp; lần này chưa tuyên bố các script đã chạy thực tế.

## An toàn
Chỉ cập nhật catalog và công cụ kiểm toán trên staging. Không merge, không deploy, không sửa D1/production, không công bố công khai, không tạo tài khoản/gói trả phí và không phát sinh chi phí.
