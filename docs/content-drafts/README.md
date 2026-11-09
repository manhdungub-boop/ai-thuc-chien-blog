# Kho bản thảo nội dung AI Thực Chiến Blog

Các tệp trong thư mục này là bản thảo biên tập nội bộ, chưa phải bài HTML được website phục vụ và chưa được đưa vào sitemap, RSS hoặc trang chủ.

## Đợt nội dung 31/10/2026

Có 8 bản thảo, hai bài cho mỗi chủ đề. Mỗi bài có sơ đồ SVG tự thiết kế trong `assets/`; đây là tài sản biên tập gốc của dự án.

| Chủ đề | Bài viết | Minh họa |
|---|---|---|
| Kiến thức AI | Tạo bộ kiểm thử 20 câu hỏi để đánh giá AI trước khi dùng thật | `assets/bo-kiem-thu-ai.svg` |
| Kiến thức AI | RAG là gì? Xây kho tri thức AI có trích dẫn và kiểm chứng | `assets/rag-kho-tri-thuc.svg` |
| AI tự động hóa | Thiết kế AI Agent an toàn: quyền tối thiểu và điểm duyệt của con người | `assets/agent-human-approval.svg` |
| AI tự động hóa | Workflow AI bền vững: idempotency, retry và hàng đợi lỗi | `assets/workflow-idempotency.svg` |
| AI kiếm tiền | Đóng gói dịch vụ AI cho doanh nghiệp nhỏ: phạm vi, KPI và nghiệm thu | `assets/dong-goi-dich-vu-ai.svg` |
| AI kiếm tiền | Tính điểm hòa vốn cho dự án AI: TCO, chi phí mỗi kết quả và thời gian hoàn vốn | `assets/hoa-von-tco-ai.svg` |
| Công cụ AI miễn phí | Chạy AI trên máy cá nhân với Ollama và Open WebUI | `assets/ollama-openwebui-local.svg` |
| Công cụ AI miễn phí | Chuyển giọng nói thành văn bản offline với whisper.cpp | `assets/whisper-cpp-flow.svg` |

## Quy tắc biên tập bắt buộc cho tác giả DUNG - AI

Mọi nội dung mới hoặc được biên tập lại dưới tên tác giả **DUNG - AI** phải vượt qua toàn bộ tiêu chí sau trước khi được xem xét phát hành.

### 1. Bản quyền và tính nguyên bản
- Tự viết bằng cấu trúc, lập luận và cách diễn đạt riêng; không sao chép hoặc diễn đạt bám sát bài viết khác.
- Kiểm tra trùng lặp bằng tìm kiếm các cụm câu đặc trưng và đối chiếu với nguồn tham khảo; ghi nhận nguồn đã kiểm tra.
- Trích dẫn rõ tên nguồn, tác giả/tổ chức, tiêu đề và liên kết khi sử dụng dữ kiện, số liệu, ý tưởng hoặc phát biểu của bên khác.
- Không sử dụng tài sản không rõ quyền sử dụng; kiểm tra giấy phép, điều kiện ghi công, quyền sửa đổi và phạm vi thương mại.
- Không xóa watermark, không giả định nội dung Internet là miễn phí. Lưu nguồn và giấy phép cho từng tài sản hình ảnh.
- Với mã nguồn, mẫu lệnh và dữ liệu minh họa, ghi giấy phép/nguồn nếu không phải nội dung tự tạo; không đưa bí mật, khóa API hoặc dữ liệu cá nhân vào ví dụ.

### 2. Chất lượng và độ chính xác
- Nội dung phải giải quyết nhu cầu cụ thể, xác định đối tượng đọc, mục tiêu và kết quả mong đợi.
- Kiểm chứng thông tin kỹ thuật, giá, giới hạn gói miễn phí, phiên bản, ngày cập nhật và liên kết bằng tài liệu chính thức hoặc nguồn đáng tin cậy.
- Phân biệt sự kiện đã xác minh, nhận định, giả định và ví dụ mô phỏng; không bịa số liệu, trích dẫn, kết quả thử nghiệm hoặc lời chứng thực.
- Nêu điều kiện áp dụng, giới hạn, rủi ro, bảo mật, quyền riêng tư và trường hợp không nên sử dụng giải pháp.
- Không hứa hẹn thu nhập, hiệu suất hoặc kết quả chắc chắn khi không có bằng chứng đủ mạnh.

### 3. Hướng dẫn thực hành chi tiết
- Nêu yêu cầu trước khi bắt đầu, công cụ/phiên bản, chuẩn bị, từng bước thao tác, cấu hình và ví dụ cụ thể.
- Mỗi bước cần có thao tác, kết quả mong đợi và cách xác nhận thành công; bổ sung xử lý lỗi thường gặp.
- Có ví dụ đầu vào/đầu ra hoặc tình huống thực tế; cảnh báo thao tác có thể gây mất dữ liệu, phát sinh chi phí hoặc ảnh hưởng hệ thống.
- Không viết kiểu liệt kê khái quát rồi gọi là hướng dẫn hoàn chỉnh. Nếu chưa kiểm chứng thao tác trên môi trường thực, phải ghi rõ chưa thử nghiệm.

### 4. Hình ảnh và sơ đồ minh họa
- **Bắt buộc tự thiết kế/tạo hình ảnh và sơ đồ minh họa phù hợp trực tiếp với nội dung bài viết.** Không dùng ảnh chung chung, ảnh trang trí hoặc sao chép hình từ bài khác.
- Mỗi hình phải giải thích một nội dung cụ thể; nhãn, số liệu và trình tự trong hình phải khớp với văn bản. Tạo đủ hình cho các quy trình/khái niệm quan trọng.
- Hình tự thiết kế phải là tài sản gốc có thể chỉnh sửa/lưu cùng mã nguồn (SVG, Mermaid hoặc định dạng phù hợp); ghi tác giả thiết kế, mục đích, bài viết sử dụng và nguồn dữ liệu trong metadata/manifest.
- Chỉ dùng tài sản bên ngoài khi thật sự cần thiết; phải xác minh giấy phép, ghi công, quyền sửa đổi và phạm vi thương mại.
- Mỗi hình phải có chú thích và alt text mô tả đúng nội dung; ảnh chụp màn hình phải che thông tin nhạy cảm và ghi phiên bản/giao diện khi cần.
- Bài kỹ thuật/quy trình phải có sơ đồ khi sơ đồ giúp hiểu kiến trúc, luồng dữ liệu, thao tác hoặc điểm quyết định.
- Nếu chưa có hình/sơ đồ đạt chuẩn, bài giữ trạng thái **chưa đạt phát hành**.

### 5. Kiểm tra trước khi chuyển trạng thái
- Checklist gồm: bản quyền, độ chính xác, độ sâu, khả năng làm theo, hình ảnh/sơ đồ, nguồn tham khảo, SEO, hiển thị di động và liên kết nội bộ.
- Người kiểm tra đánh dấu từng mục đạt/chưa đạt; bản quyền, độ chính xác và quyền sử dụng hình ảnh là điều kiện chặn phát hành.
- Cuối bài nhắc người sử dụng lại nội dung ghi rõ tác giả **DUNG - AI**.
- Chỉ chuyển bài sang HTML/preview sau khi hoàn tất kiểm tra; chỉ phát hành công khai sau phê duyệt riêng của người dùng.

## Cổng phát hành

1. Kiểm tra tính nguyên bản và trùng lặp.
2. Kiểm tra nguồn, độ chính xác kỹ thuật và cảnh báo an toàn.
3. Kiểm tra hướng dẫn từng bước và kết quả mong đợi.
4. Kiểm tra hình ảnh, sơ đồ, chú thích, alt text, nguồn và giấy phép.
5. Chuyển Markdown sang HTML theo template website.
6. Kiểm tra preview, canonical, JSON-LD, RSS, sitemap, liên kết và hiển thị di động.
7. Chờ phê duyệt riêng trước khi phát hành công khai.
