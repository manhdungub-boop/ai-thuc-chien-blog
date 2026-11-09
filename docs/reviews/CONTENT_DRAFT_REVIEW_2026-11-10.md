# Rà soát biên tập nội dung DUNG - AI — 10/11/2026

## Phạm vi và ranh giới

- Nhánh ứng viên: `fix/release-blockers-20261109` (PR #91 Draft, base `main`).
- Snapshot nhánh ứng viên có 69 bài HTML hiện hữu và 8 bản thảo nội bộ trong `docs/content-drafts/`.
- Không chỉnh sửa `main`, không xuất bản bài mới lên Production, không thay đổi D1, DNS, secrets hoặc cấu hình Worker Production.

## Kết luận biên tập

### 1. Hai bài AI kiếm tiền có tiềm năng thành bài mới

- `dong-goi-dich-vu-ai-cho-doanh-nghiep-nho.md` — hướng dẫn đóng gói dịch vụ AI, xác định phạm vi, KPI, SOW, human approval và nghiệm thu. Nội dung không cam kết thu nhập; ví dụ 100 yêu cầu và ngưỡng 90/100 được ghi rõ là giả định thử nghiệm, không phải chuẩn chung.
- `phan-tich-hoa-von-va-tco-du-an-ai.md` — phân biệt TCO, chi phí trên đầu ra đạt chuẩn, giờ công được giải phóng, lợi ích tiền mặt, điểm hòa vốn và thời gian hoàn vốn. Kiểm tra phép tính mẫu: 2.550.000 / 850 = 3.000 đồng/đầu ra; 6.000.000 / (20.000 - 8.000) = 500 đầu ra/tháng; 12 / 3 = 4 tháng hoàn vốn đơn giản. Các số liệu đều được ghi rõ là giả định.
- Hai bài có sơ đồ SVG tự thiết kế, có `<title>`/`<desc>`, không có thẻ script; manifest ghi tác giả, mục đích và nguồn gốc tài sản.
- Nguồn trong bản thảo: NIST AI RMF, OECD AI Principles, FinOps Foundation Unit Economics và Google Cloud Pricing Calculator. Đã đối chiếu trang nguồn: NIST ghi AI RMF 1.0 đang được sửa đổi; OECD xác nhận Principles được cập nhật tháng 05/2024; FinOps Unit Economics liên hệ chi phí công nghệ với giá trị sản phẩm/dịch vụ; Google Cloud Pricing Calculator chỉ ước tính dịch vụ Google Cloud. Bài Google Cloud adoption framework được ghi rõ ngày 30/06/2020 và chỉ dùng làm khung tham khảo, không dùng để khẳng định chính sách sản phẩm 2026.
- Không thấy bài HTML có cùng slug. Hai bài hiện hữu `quan-ly-rui-ro-du-an-kiem-tien-ai.html` và `tinh-loi-nhuan-thuc-tu-affiliate.html` có chủ đề liên quan nhưng khác trọng tâm (quản trị rủi ro và lợi nhuận affiliate), không phải bản trùng trực tiếp.
- **Trạng thái:** nội dung và phép tính mẫu đã qua rà soát ban đầu; chưa được coi là sẵn sàng xuất bản cho đến khi hoàn tất kiểm tra trùng lặp toàn văn, chuyển đổi HTML, tích hợp ảnh và kiểm tra Preview/mobile.

### 2. Bốn bản thảo kỹ thuật nên tích hợp vào bài hiện hữu, không tạo bài trùng

| Bản thảo | Bài hiện hữu phù hợp để cập nhật |
|---|---|
| Bộ kiểm thử 20 câu hỏi đánh giá AI | `xay-bo-danh-gia-chat-luong-ai.html`, `kiem-thu-chat-luong-dau-ra-ai.html` |
| RAG có trích dẫn | `xay-dung-kho-tri-thuc-ai-co-nguon.html` |
| Agent quyền tối thiểu và human approval | `ai-agent-thuc-hanh-tu-thiet-ke-den-kiem-soat.html`, `human-in-the-loop-trong-workflow.html` |
| Idempotency, retry và dead-letter queue | `chong-trung-va-idempotency-workflow.html`, `workflow-ai-chong-loi-va-chay-lai-an-toan.html`, `xu-ly-loi-retry-workflow.html` |

Chỉ chọn các đoạn mới có giá trị bổ sung, giữ canonical và cấu trúc bài hiện tại; không tạo URL mới nếu nội dung chủ yếu lặp lại.

### 3. Hai hướng dẫn công cụ local vẫn bị chặn bởi kiểm thử thực tế

- Ollama + Open WebUI: cần kiểm thử cài đặt và lệnh trên ít nhất Linux/macOS và Windows; chưa được ghi nhận là đã thử trên máy thật.
- whisper.cpp: tương tự, cần kiểm thử build/chạy trên OS đích; phải tiếp tục phân biệt giấy phép code với model/dependency và quyền xử lý bản ghi âm.

Không tự tuyên bố đã kiểm thử trên thiết bị của người dùng.

## Cổng kỹ thuật còn thiếu trước khi phát hành

1. `docs/content-drafts/assets/` không được static build phục vụ công khai. Cần chuyển các SVG được duyệt sang thư mục asset công khai phù hợp và kiểm tra URL thực tế.
2. Chưa có pipeline Markdown-to-HTML cho thư mục bản thảo; cần dùng template HTML hiện hữu và cập nhật metadata, canonical, JSON-LD, liên kết nội bộ, trang chủ, thư viện, sitemap và RSS.
3. Chưa hoàn tất tìm kiếm trùng lặp toàn văn và kiểm tra link nguồn trong môi trường CI.
4. Chưa kiểm tra hiển thị Preview trên iPhone/mobile, alt text và kích thước hình sau khi đưa vào HTML.

## Quy tắc phát hành hiện hành

Khi một bài hoặc một mục Ngân hàng AI vượt qua toàn bộ tiêu chí chất lượng, tự động đưa vào lô phát hành công khai; không yêu cầu phê duyệt riêng từng bài. Tuy nhiên, không tự ý merge hoặc deploy Production khi chưa có phê duyệt phát hành chung theo guardrail của dự án. Các bước rà soát này không được phép sửa bản công khai.

## Kết quả của lượt rà soát này

- Không xuất bản bài mới và không sửa HTML đang phục vụ.
- Hai bài kinh doanh được xếp ưu tiên chuyển đổi HTML sau khi hoàn tất kiểm tra trùng lặp và asset Preview.
- Bốn bài kỹ thuật được định hướng cập nhật vào bài hiện hữu.
- Hai bài công cụ local tiếp tục chờ kiểm thử OS thực tế.

- **Nguồn đã đối chiếu ngày 10/11/2026:** NIST AI RMF (đang sửa đổi) https://www.nist.gov/itl/ai-risk-management-framework ; OECD AI Principles (cập nhật 05/2024) https://oecd.ai/en/ai-principles ; FinOps Unit Economics https://www.finops.org/framework/capabilities/unit-economics/ ; Google Cloud Pricing Calculator https://cloud.google.com/products/calculator .
