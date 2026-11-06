# Báo cáo rà soát Ngân hàng AI — 31/10/2026

## Phạm vi và nguồn dữ liệu
- Repository: `manhdungub/ai-thuc-chien-blog`
- Branch: `staging/auth-worker-build`
- HEAD tại thời điểm rà soát: `d835c4bfa967ceb5ba63dd7de14e2431422d0594`
- Catalog gốc: `site-snapshot/data/ai-tools.json`
- Số bản ghi hiện có: 12; JSON parse thành công.
- Các thư mục Open Source Tools, AI Open Source, Open Tool Atlas, AI Kendra, AIUseFlow, Onei, Open Source AI Hub và Open Source AI Projects chỉ được dùng để khám phá ứng viên; không coi mô tả/giá từ các thư mục tổng hợp là bằng chứng cuối cùng.

## Kết quả
| Chỉ số | Kết quả |
|---|---:|
| Công cụ mới đề xuất | 7 |
| Bản ghi hiện tại được sửa | 0 |
| Link hỏng đã xác nhận | 0 |
| Link đã được kiểm tra đầy đủ bằng HTTP checker | Chưa thực hiện |
| Giá/hạn mức chưa được xác minh độc lập trong đợt này | 12/12 |
| Trùng ID/tên/domain chính xác với 12 bản ghi hiện tại | 0 |
| Ứng viên đưa vào hàng chờ duyệt | 7 |

**Lưu ý:** 0 link hỏng đã xác nhận không đồng nghĩa toàn bộ link đều sống; đợt rà soát này không chạy crawler/HTTP link checker trên toàn bộ 12 công cụ. Toàn bộ 12 bản ghi hiện tại vẫn giữ `verification_status=needs_review`, nên không thể gắn nhãn verified chỉ dựa trên lần cập nhật dữ liệu trước.

## Ứng viên mới
Tệp `site-snapshot/data/review/ai-tools-candidates-2026-10-31.json` chứa 7 hồ sơ theo schema catalog, tất cả đều gắn `needs_review`:
1. Ollama — local model runtime; local miễn phí, cloud có gói trả phí.
2. AnythingLLM — trợ lý tài liệu/agent chạy local và cloud.
3. OpenCode — coding agent; có mô hình miễn phí, dùng provider ngoài có thể phát sinh phí.
4. ComfyUI — workflow node cho ảnh/video/âm thanh/3D; core local GPL-3.0, cloud/partner nodes trả phí.
5. Qdrant — vector database; mã nguồn mở và cloud có free tier.
6. Dify — agent workflow/RAG; self-host Community Edition, Cloud có gói; giấy phép Dify có điều kiện bổ sung.
7. whisper.cpp — speech-to-text local, MIT.

## Phát hiện cần chú ý
- **Flowise không được thêm:** website chính thức công bố wind-down; code freeze 29/07/2026, repository archive 10/08/2026, EOL 31/08/2026. Không nên đưa Flowise vào danh sách công cụ đang hoạt động mới.
- **Open WebUI cần kiểm tra điều khoản branding:** từ v0.6.6 có điều khoản bảo vệ thương hiệu cho một số trường hợp triển khai lớn; không được mô tả đơn giản chỉ là BSD-3 cho toàn bộ bản mới.
- **Dify không nên gắn Apache-2.0 thuần:** giấy phép chính thức là Dify Open Source License dựa trên Apache-2.0 nhưng có điều kiện bổ sung, gồm giới hạn multi-tenant và branding.
- **ComfyUI phân biệt core với cloud:** core local miễn phí/GPL-3.0; Comfy Cloud và partner nodes có thể tính phí.
- **Ollama phân biệt local với cloud:** chạy mô hình local không cần thuê bao; cloud và gói Pro/Max có chi phí.

## Nguồn chính thức đã mở/đối chiếu
- Ollama: https://ollama.com/ ; https://ollama.com/pricing ; https://github.com/ollama/ollama
- AnythingLLM: https://anythingllm.com/ ; https://docs.anythingllm.com/ ; https://github.com/Mintplex-Labs/anything-llm
- OpenCode: https://opencode.ai/ ; https://opencode.ai/docs ; https://github.com/anomalyco/opencode
- ComfyUI: https://www.comfy.org/download/ ; https://support.comfy.org/articles/9806306061-about-comfy ; https://github.com/Comfy-Org/ComfyUI
- Qdrant: https://qdrant.tech/ ; https://qdrant.tech/pricing/ ; https://github.com/qdrant/qdrant
- Dify: https://dify.ai/ ; https://github.com/langgenius/dify ; https://github.com/langgenius/dify/blob/main/LICENSE
- whisper.cpp: https://github.com/ggml-org/whisper.cpp
- Flowise sunset notice: https://flowiseai.com/sunset
- Open WebUI license notice: https://docs.openwebui.com/license/

## Đề xuất biên tập
1. Duyệt thủ công 7 ứng viên, xác minh pricing theo khu vực Việt Nam, giấy phép từng phiên bản và giới hạn thực tế trước khi nhập vào catalog chính.
2. Chạy HTTP checker có rate limit cho toàn bộ website và pricing sources; không crawl sau đăng nhập.
3. Kiểm tra lại 12 bản ghi hiện hữu, đặc biệt các trang giá và tên sản phẩm thay đổi; giữ `unknown/stale/needs_review` khi chưa có bằng chứng.
4. Xây renderer từ JSON và phân trang trước khi tăng quy mô lên hàng trăm/hàng nghìn.
5. Không merge, deploy hoặc xuất bản công khai trong đợt này.

## Trạng thái an toàn
Chỉ tạo tệp đề xuất và báo cáo trên nhánh staging. Không sửa catalog chính, không merge MR, không deploy, không chạm D1/production, không tạo chi phí.
