# Quy tắc làm việc — kiểm soát lỗi, PR và phát hành

Ngày hiệu lực: 11/11/2026
Phạm vi: toàn bộ repository `manhdungub-boop/ai-thuc-chien-blog`.

## 1. Nguyên tắc bắt buộc: sửa dứt điểm trước khi mở rộng

1. Khi phát hiện bất kỳ lỗi nào trong source, CI, test, Preview, bảo mật, nội dung hoặc dữ liệu, phải ghi nhận lỗi, xác định nguyên nhân gốc (root cause), sửa trên nhánh phù hợp và chạy lại đúng kiểm thử bị ảnh hưởng.
2. Không bỏ qua lỗi, không đổi tên job/skip test/giảm assertion/nới điều kiện để biến đỏ thành xanh. Chỉ đánh dấu PASS khi workflow/job đã hoàn tất thành công trên đúng commit SHA được ghi nhận.
3. Nếu lần sửa tạo ra lỗi mới hoặc làm hỏng kiểm thử trước đó, dừng mở rộng phạm vi; sửa lỗi phát sinh và chạy lại các kiểm thử liên quan trước khi tiếp tục.
4. Mỗi đợt sửa phải cập nhật hồ sơ kiểm toán: lỗi, nguyên nhân, thay đổi, kiểm thử trước/sau, SHA, link workflow và kết quả. Phân biệt rõ PASS, FAIL, BLOCKED, NOT RUN và NOT VERIFIED.

## 2. Hạn chế PR mới và hợp nhất công việc

1. Trước khi tạo PR/branch mới, bắt buộc kiểm tra các PR đang mở, nhánh, commit, CI, review và phụ thuộc hiện có; tìm xem lỗi hoặc hạng mục đã được xử lý ở PR nào.
2. Ưu tiên sửa tiếp trên PR/branch hiện hữu phù hợp, đặc biệt PR #96 và chuỗi phụ thuộc của nó. Không tạo PR mới chỉ để tách một phần nhỏ, lặp lại thay đổi, né CI đỏ hoặc tạo thêm một nhánh kiểm thử.
3. Chỉ tạo PR mới khi có lý do kỹ thuật rõ ràng: phạm vi độc lập, không thể tích hợp an toàn vào PR hiện tại, hoặc cần tách biệt rủi ro/ủy quyền. Ghi rõ lý do và quan hệ phụ thuộc trong mô tả PR.
4. Trước khi đề xuất merge, phải rà soát PR cũ có thay đổi trùng lặp, lỗi CI, xung đột, phụ thuộc lỗi thời hoặc nội dung đã được PR khác thay thế. Không để PR cũ lỗi bị bỏ quên hoặc tiếp tục được coi là bằng chứng phát hành.
5. Không đóng/xóa PR, branch hoặc commit cũ một cách tùy tiện. Chỉ đề xuất đóng khi đã xác định rõ PR thay thế, không còn thay đổi độc nhất cần giữ và có thể truy vết lịch sử.

## 3. Cổng kiểm thử sau mỗi thay đổi

1. Xác định phạm vi ảnh hưởng từ diff và dependency trước khi chạy test.
2. Chạy kiểm thử nhỏ nhất có khả năng bắt lỗi trực tiếp, sau đó chạy regression tests cho các luồng bị ảnh hưởng.
3. Nếu sửa auth/session/OAuth/email, phải kiểm tra các luồng đăng nhập/đăng ký/reset tương ứng bằng tài khoản thử nghiệm riêng; mock không được ghi nhận là live E2E.
4. Nếu sửa workflow/deployment/security, kiểm tra guard, quyền tối thiểu, ref/branch, secrets boundary và không tác động Production.
5. Nếu sửa D1/schema, chỉ dùng Preview DB được xác minh; không chạy migration hoặc ghi dữ liệu Production.
6. Không chạy lại toàn bộ test suite khi thay đổi không ảnh hưởng đến các phần đã được xác nhận; phải ghi lý do chọn phạm vi kiểm thử.
7. Khi test thất bại, phân loại lỗi (code, test harness, quota, dịch vụ ngoài, quyền, môi trường), lưu log không chứa secret/PII, khắc phục nguyên nhân và chạy lại. Quota hoặc dịch vụ miễn phí bị giới hạn không được đổi thành PASS; tìm phương án miễn phí thay thế hoặc ghi BLOCKED.

## 4. Kiểm soát PR stack và bằng chứng

1. Mỗi kết quả CI phải gắn với commit SHA chính xác; commit mới làm kết quả cũ mất hiệu lực đối với SHA mới.
2. Với PR xếp chồng, ghi rõ base/head SHA và thứ tự phụ thuộc. Không dùng kết quả của PR cha/nhánh khác để tuyên bố PR hiện tại PASS.
3. Theo dõi các PR cũ có job thất bại, thiếu workflow hoặc không còn chạy trên HEAD hiện tại. Lập danh sách xử lý; không suy diễn “không có run” là PASS.
4. Mọi lỗi tái diễn phải có regression test hoặc guard phù hợp trước khi coi là khắc phục xong.
5. Không tạo PR bổ sung khi PR hiện tại đang có CI đỏ hoặc chưa rõ nguyên nhân, trừ khi việc tách nhánh là điều kiện bắt buộc để cô lập rủi ro; trường hợp đó phải giải thích trong audit.

## 5. Giới hạn an toàn không thay đổi

- Chỉ dùng GitHub repository nêu trên; không sử dụng GitLab.
- Không đọc, sao chép, in log, so sánh hoặc tiết lộ secret Production.
- Không thay đổi Production Worker, DNS, D1, dữ liệu người dùng thật hoặc cấu hình đang phục vụ người dùng.
- Không mở rộng Google OAuth allowlist cho hostname Preview tùy ý.
- Dùng tài khoản thử nghiệm riêng và credential Preview độc lập đã xác minh.
- Không trả phí, nâng cấp, thiết lập thanh toán hoặc sử dụng trial có rủi ro phát sinh phí.
- Ưu tiên read-only, offline, mock và Preview; mock không thay thế kiểm chứng live.
- Không merge hoặc triển khai Production khi chưa đạt đầy đủ release gate và chưa có phê duyệt cần thiết.

## 6. Trình tự làm việc mặc định

1. Đọc biên bản bàn giao và trạng thái PR/branch/commit/CI/review mới nhất.
2. Lập bản đồ PR stack; xác định PR trùng lặp, PR cũ lỗi, job thiếu và blocker thực tế.
3. Chọn một nhánh/PR hiện hữu làm nơi xử lý chính; tránh tạo PR mới.
4. Sửa theo nhóm nguyên nhân gốc; thêm regression test.
5. Chạy test có mục tiêu; sửa tiếp cho đến khi pass hoặc ghi rõ blocker ngoài quyền kiểm soát.
6. Đối chiếu kết quả trên đúng SHA; cập nhật audit sau mỗi đợt.
7. Chỉ chuyển trạng thái release khi mọi gate đều có bằng chứng và reviewer độc lập đã hoàn tất.

Quy tắc ưu tiên: **Không mở rộng công việc khi lỗi cũ chưa được xử lý; không tạo thêm PR để che khuất lỗi; không tuyên bố hoàn tất nếu bằng chứng chưa đủ.**
