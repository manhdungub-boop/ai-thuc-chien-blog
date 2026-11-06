# Báo cáo rà soát bản thảo DUNG - AI — 31/10/2026

## Phạm vi

Rà soát 8 bản thảo trong `docs/content-drafts/` trên nhánh `staging/auth-worker-build`, tập trung vào tính đầy đủ của hướng dẫn, nguồn kỹ thuật, hình minh họa và khả năng đưa nội dung sang website.

## Kết quả đã xác minh

- Có 8 bản thảo, tất cả khai báo tác giả `DUNG - AI` và trạng thái `draft`.
- Mỗi bản thảo có liên kết tới một sơ đồ SVG trong `docs/content-drafts/assets/`; các SVG là tài sản tự thiết kế của dự án và có manifest ghi nguồn gốc.
- Hai bài công cụ AI local đã được mở rộng thành hướng dẫn thực hành:
  - `cong-cu-ai-mien-phi/chay-ai-local-ollama-open-webui.md`
  - `cong-cu-ai-mien-phi/chuyen-giong-noi-local-whisper-cpp.md`
- Hai bài trên có các bước cài đặt, lệnh kiểm tra, kết quả mong đợi, cách xử lý lỗi, cảnh báo bảo mật/giấy phép và liên kết tài liệu chính thức.
- Sáu bài còn lại đã được bổ sung bộ 20 test mẫu, quy trình RAG end-to-end, payload phê duyệt, ví dụ bảng idempotency/retry, mẫu SOW nghiệm thu và công thức/bảng tính TCO.
- Bài đánh giá AI đã cập nhật lưu ý rằng OpenAI Evals platform chuyển read-only ngày 31/10/2026 và dự kiến ngừng 30/11/2026; bộ test cần lưu ở định dạng có thể di chuyển.
- Quy tắc biên tập trong README đã được làm sạch để loại bỏ mục trùng lặp; giữ yêu cầu tự thiết kế hình/sơ đồ phù hợp trực tiếp với nội dung.
- Đã rà soát tài liệu chính thức của Ollama, Open WebUI và whisper.cpp để đối chiếu các lệnh/cảnh báo được nêu trong hai bài. Liên kết nguồn được lưu ngay trong từng bản thảo.

## Ma trận trạng thái biên tập

| Bản thảo | Nội dung/hướng dẫn | Minh họa gốc | Trạng thái |
|---|---|---|---|
| Bộ kiểm thử 20 câu hỏi AI | Có rubric và bộ 20 test mẫu; cần rà soát đáp án chuẩn theo use case thực tế | SVG có trong repo | Cần QA |
| RAG có trích dẫn | Có pipeline, metadata mẫu, ví dụ truy vấn và kiểm thử quyền | SVG có trong repo | Cần QA |
| Agent quyền tối thiểu | Có state machine, payload duyệt gắn hash và luồng kiểm tra phía server | SVG có trong repo | Cần QA |
| Workflow idempotency | Có schema trạng thái, quy trình chống trùng, lịch retry và lưu ý outbox | SVG có trong repo | Cần QA |
| Đóng gói dịch vụ AI | Có mẫu SOW một trang, phạm vi, KPI và tiêu chí nghiệm thu giả định | SVG có trong repo | Cần QA |
| Hòa vốn và TCO AI | Có cấu trúc sheet, công thức TCO/ROI và phân biệt lợi ích tiền mặt với năng lực giải phóng | SVG có trong repo | Cần QA |
| Ollama + Open WebUI | Đã mở rộng hướng dẫn; lệnh cần chạy thử trên OS đích | SVG có trong repo | Chờ kiểm thử thực tế |
| whisper.cpp | Đã mở rộng hướng dẫn; lệnh cần chạy thử trên OS đích | SVG có trong repo | Chờ kiểm thử thực tế |

## Giới hạn và điểm chặn phát hành

1. **Chưa xác minh hiển thị hình trên website.** Các bản thảo nằm trong thư mục tài liệu nội bộ. Snapshot website hiện có là tập HTML tĩnh; trong mã nguồn và CI được kiểm tra chưa tìm thấy pipeline Markdown-to-HTML dành cho `docs/content-drafts/`. Vì vậy đường dẫn `../assets/` mới chỉ được xác nhận trong cấu trúc bản thảo, chưa chứng minh rằng ảnh sẽ được phục vụ đúng khi chuyển sang bài HTML.
2. **Chưa chạy thử lệnh trên mọi nền tảng.** Hai bài công cụ ghi rõ giới hạn này; cần kiểm thử trên ít nhất một môi trường Linux/macOS và một môi trường Windows trước khi ghi nhận đã thử nghiệm.
3. **Chưa hoàn tất rà soát trùng lặp toàn văn.** Việc có nguồn tham khảo không thay thế bước tìm kiếm các cụm câu đặc trưng và so sánh nội dung trước phát hành.
4. **Sáu bài còn lại đã có phần thực hành mẫu nhưng chưa qua QA cuối.** Cần kiểm tra tính nhất quán của ví dụ, công thức, đáp án chuẩn và khả năng áp dụng trong từng use case.
5. **CI chưa được xác nhận chạy thành công trong phiên này.** Trạng thái quota GitLab CI trước đó bị chặn; không được xem việc cập nhật tệp là bằng chứng CI pass.

## Công việc tiếp theo

1. Rà soát đáp án chuẩn, ví dụ, công thức và giả định trong sáu bài vừa được mở rộng.
2. Xác định rõ nguồn HTML/template thật của website và quy tắc lưu asset công khai trước khi chuyển SVG khỏi kho bản thảo.
3. Tạo preview nội bộ, kiểm tra alt text, kích thước, khả năng co giãn trên di động và URL ảnh.
4. Chạy kiểm thử trên môi trường đích và QA nội dung/bản quyền toàn văn.
5. Chỉ chuyển trạng thái bài khi từng mục checklist có bằng chứng; chỉ phát hành công khai sau phê duyệt riêng của người dùng.

## Ranh giới an toàn và triển khai staging

- Cloudflare Workers Builds có trigger cho nhánh `staging/auth-worker-build`, chạy `wrangler deploy --config wrangler.staging.toml`. Đây là triển khai tự động tới Worker staging `ai-thuc-chien-blog-auth-app-preview`, không phải production.
- Tệp `wrangler.staging.toml` trỏ D1 tới database preview `c8b301f0-afcf-4f36-9b8e-8194c01bbbc8` và assets tới `./site-snapshot`. Thư mục `docs/content-drafts/` không nằm trong thư mục assets này nên các bản thảo không được phục vụ bởi Worker staging chỉ vì commit.
- Sau các commit cập nhật tài liệu, Cloudflare Workers Build mới nhất cho commit `393556943a2667fce6014d01741b07be437a4944` là `9467d49b-1610-4afc-b612-4364010eb597`; log xác nhận `Success: Build completed` và Worker staging version 80 được triển khai 100% lúc 08:00:17 UTC ngày 31/10/2026. Script ETag vẫn là `0c2c1dd5...`, giống các version staging ngay trước đó; thay đổi trong loạt commit này chỉ nằm ở `docs/`, không thay mã Worker.
- Production Worker `ai-thuc-chien-blog` vẫn ở deployment `51587fe9-266d-4c54-a04d-7441de83b445`, version `3713d7c4-ca28-470a-b0bc-33c8e3712877`, 100% traffic, tạo ngày 24/10/2026. Không thấy deployment production mới trong lần đối chiếu.
- GitLab MR pipeline mới nhất được kiểm tra là `3011408888` cho commit `393556943a2667fce6014d01741b07be437a4944`; cả 7 job đều dừng với `ci_quota_exceeded`. Đây là chặn quota, không phải kết quả test code. Không được ghi nhận CI pass. Cloudflare staging build thành công là một kiểm tra riêng, không thay thế GitLab CI.
- Rà soát trigger hiện tại: trigger `auth-app-preview` chủ động bao gồm nhánh `staging/auth-worker-build` và chạy `wrangler.staging.toml`; `auth-preview` vẫn giới hạn ở nhánh release với lệnh chặn deploy; `content-preview` và `article-fallback-preview` giới hạn ở các nhánh riêng; trigger `logo-candidate-preview` đã bị xóa. Nội dung cảnh báo cũ trong mô tả MR về năm trigger cùng chạy trên nhánh staging không còn khớp hoàn toàn với cấu hình trigger hiện tại.
- Báo cáo này chỉ ghi nhận thay đổi tài liệu trên nhánh staging và lần redeploy staging nêu trên. Không có thay đổi production, D1 production, DNS, dữ liệu người dùng, sitemap/RSS công khai hoặc bài viết đang phục vụ. Không có bài nào được xuất bản.
