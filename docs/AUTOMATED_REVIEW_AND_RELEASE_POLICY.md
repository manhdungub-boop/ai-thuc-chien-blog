# Chính sách review và phát hành tự động — AI Thực Chiến

**Ngày áp dụng:** 2026-11-27  
**Phạm vi:** PR, CI, Agent Runtime, AI Bank, nội dung website, tích hợp mạng xã hội và phát hành Production.

## 1. Quyết định quản trị

- Dự án không yêu cầu người phê duyệt độc lập hoặc chuyên gia bên ngoài cho PR, code review hay quyết định phát hành.
- Trợ lý AI được giao thực hiện technical review, kiểm tra bảo mật, tổng hợp bằng chứng và quyết định kỹ thuật dựa trên các cổng tự động được định nghĩa trong repository.
- Không giả mạo reviewer, không tạo tài khoản phụ để tự duyệt và không ghi nhận review tự động như một phê duyệt của con người.
- Chính sách này thay thế mọi câu chữ cũ yêu cầu reviewer độc lập trong tài liệu vận hành của dự án.

## 2. Cổng tự động bắt buộc

Tất cả điều kiện áp dụng phải đạt trên đúng commit SHA đang được phát hành:

1. **Tính toàn vẹn:** xác minh repository, PR, base/head SHA, branch, diff và dependency; không có thay đổi ngoài phạm vi.
2. **CI:** tất cả required jobs hoàn tất SUCCESS trên đúng HEAD SHA. SKIPPED, CANCELLED, WAITING, stale hoặc không có kết quả là BLOCKED/NOT RUN, không phải PASS.
3. **Kiểm thử theo tác động:** chạy unit, integration, contract, regression và E2E phù hợp với thay đổi; mock không được thay thế live E2E.
4. **Bảo mật:** kiểm tra secrets, quyền tối thiểu, OIDC claims, branch/ref pinning, injection, auth/session, dữ liệu cá nhân, dependency advisories và ranh giới môi trường. Không còn Critical/High chưa xử lý.
5. **Review tự động:** trợ lý đọc toàn bộ diff và các luồng liên quan; mọi phát hiện phải được sửa hoặc phân loại có lý do và bằng chứng. Không được tự đóng finding chỉ để đạt điều kiện.
6. **Preview:** triển khai và kiểm thử Preview cô lập khi thay đổi cần kiểm chứng runtime; xác nhận không chạm Production.
7. **Chi phí:** chỉ sử dụng gói miễn phí/hạn mức được cấp. Xác minh quota liên quan trước khi chạy; quota không đọc được hoặc không đủ thì BLOCKED, không thử dịch vụ có nguy cơ tính phí.
8. **Rollback:** xác định phiên bản tốt gần nhất, quy trình khôi phục và kiểm tra sau rollback trước khi phát hành.
9. **Audit:** lưu SHA, run ID, kết quả từng job, log an toàn, phạm vi test, findings và quyết định phát hành.

## 3. Quy tắc quyết định

- **PASS:** tất cả cổng bắt buộc đều đạt, bằng chứng đúng SHA và không còn blocker.
- **BLOCKED:** có cổng đang chờ, bị skip, thiếu bằng chứng, thiếu quota, không truy cập được cấu hình hoặc môi trường còn yêu cầu phê duyệt thủ công.
- **FAIL:** có kiểm thử thất bại hoặc finding bảo mật nghiêm trọng chưa xử lý.
- Chỉ khi PASS mới được merge hoặc phát hành theo phạm vi đã được ủy quyền.
- Không cần người độc lập ký duyệt; quyết định của trợ lý phải có căn cứ kiểm chứng được và được ghi vào GitHub.
- Không tự động biến BLOCKED/FAIL thành PASS bằng cách bỏ job, giảm assertion, tắt kiểm tra hoặc thay đổi ngưỡng.

## 4. Ranh giới Production không bị gỡ bỏ

Việc bỏ người duyệt độc lập không đồng nghĩa bỏ kiểm soát rủi ro:

- Không sửa Production Worker, DNS, D1 Production hoặc cấu hình đang phục vụ người dùng trước khi release gate PASS.
- Không chạy migration hoặc thao tác dữ liệu thật từ Preview.
- Không bật lịch Agent 24/7, RSS ingestion, AI Bank ingestion hay Facebook publishing khi quota, quyền và kiểm thử vận hành chưa được xác minh.
- Không xuất bản nội dung chưa qua kiểm chứng nguồn, chất lượng, trùng lặp và kiểm tra an toàn.
- Mọi thay đổi phải có phương án rollback và smoke test sau phát hành.

## 5. Đồng bộ cấu hình nền tảng

- Repository policy là quy tắc vận hành của dự án; nó không tự thay đổi GitHub branch protection, rulesets hoặc protected environment.
- Quản trị viên được phép cập nhật cấu hình GitHub/Cloudflare tương ứng để bỏ required independent reviewer, nhưng chỉ bỏ đúng yêu cầu reviewer; giữ nguyên các check bắt buộc, OIDC restrictions, environment isolation, Free-plan/quota gates và rollback controls.
- Nếu connector hiện tại không có quyền cập nhật cấu hình nền tảng, ghi BLOCKED và nêu chính xác thao tác cần thực hiện trong dashboard. Không tuyên bố đã gỡ gate khi chưa đọc lại cấu hình xác nhận.
- Sau khi cập nhật, đọc lại settings và chạy kiểm thử xác nhận rằng không còn yêu cầu independent reviewer nhưng toàn bộ kiểm soát kỹ thuật vẫn còn.

## 6. Ưu tiên khi tài liệu xung đột

Tài liệu này cùng với docs/PROJECT_RULES.md, docs/WORKING_RULES_ERROR_AND_PR_CONTROL.md và docs/RELEASE_CHECKLIST.md là bộ quy tắc hiện hành. Nếu tài liệu cũ còn yêu cầu reviewer độc lập, áp dụng chính sách mới và cập nhật tài liệu cũ trong nhánh tiếp theo. Không diễn giải chính sách mới thành quyền bỏ qua kiểm thử hoặc tự động triển khai bất kể rủi ro.