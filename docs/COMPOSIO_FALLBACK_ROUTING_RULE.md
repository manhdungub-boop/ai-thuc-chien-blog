# Quy tắc dự phòng kết nối ứng dụng qua Composio

**Phạm vi:** Áp dụng cho mọi ứng dụng, dịch vụ và công cụ được AI Agent sử dụng trong dự án AI Thực Chiến.

## Quy tắc bắt buộc

1. **Phát hiện lỗi kết nối:** Khi một ứng dụng/công cụ bị mất kết nối, phiên xác thực hết hạn, lỗi quyền truy cập hoặc thao tác qua kết nối hiện tại thất bại, phải ghi nhận đúng ứng dụng, thao tác, thời điểm và lỗi trả về. Không suy đoán rằng dịch vụ đã ngừng hoạt động.
2. **Chuyển tuyến qua Composio:** Tự động tìm công cụ tương ứng trong Composio và kiểm tra trạng thái kết nối. Trước khi thử lại, phải xác minh kết nối ACTIVE thuộc đúng tài khoản, tổ chức hoặc workspace mà tác vụ gốc nhắm tới. Ưu tiên đối chiếu định danh ổn định (account/workspace/tenant ID), không chỉ dựa vào tên hiển thị hoặc trạng thái ACTIVE. Nếu không chứng minh được phạm vi tài khoản khớp, dừng; tuyệt đối không thực hiện tác vụ trên tài khoản khác. Khi đã xác minh, chỉ dùng công cụ và tham số đã được khám phá, đúng schema; không tự tạo tên công cụ, tham số hoặc endpoint.
3. **Xác thực lại khi cần:** Nếu Composio không có kết nối hoạt động hoặc không xác định được đúng tài khoản/workspace, chỉ khởi tạo quy trình kết nối đúng toolkit và yêu cầu chủ dự án hoàn tất xác thực qua liên kết chính thức. Chỉ tiếp tục sau khi trạng thái ACTIVE và phạm vi tài khoản/workspace đã được xác minh. Không yêu cầu gửi mật khẩu, API key, access token hoặc secret trong chat.
4. **Quyền tối thiểu và an toàn:** Ưu tiên thao tác read-only. Chỉ dùng quyền ghi khi tác vụ được cho phép rõ ràng và cần thiết. Quy tắc chuyển tuyến không phải là sự cho phép vượt quyền, bỏ qua phê duyệt, thay đổi Production, branch protection, secrets, DNS, Worker, D1 hoặc cấu hình đang phục vụ người dùng.
5. **Giới hạn chi phí:** Chỉ thử Composio/toolkit trong hạn mức miễn phí hoặc quota đã được xác nhận không phát sinh phí. Không mua credit, bật overage, nâng cấp gói hoặc tiếp tục khi chi phí không rõ ràng. Không dùng công cụ có số dư âm hoặc nguy cơ tính phí chưa được xác minh.
6. **Thử lại có kiểm soát và chống trùng lặp:** Sau lỗi hoặc timeout, trước tiên phải truy vấn trạng thái thực tế của yêu cầu gốc và dữ liệu đích. Nếu thao tác ghi đã hoàn tất thành công, báo thành công và tuyệt đối không gửi lại. Nếu chỉ hoàn tất một phần, chỉ xử lý phần việc còn thiếu; không lặp lại phần đã commit. Chỉ thử lại tối đa 1 lần qua tuyến Composio cho cùng lỗi/tác vụ trong một chu kỳ khi đã xác minh phần việc đó chưa được thực hiện và yêu cầu gốc không còn pending/processing hoặc khả năng commit. Với thao tác ghi không idempotent, phải dùng cùng idempotency key cho yêu cầu gốc và lần thử lại nếu hệ thống hỗ trợ. Nếu không có idempotency key hoặc không thể chứng minh chắc chắn trạng thái hoàn tất/chưa hoàn tất, dừng và báo NOT VERIFIED; không gửi lại để tránh tạo dữ liệu hoặc giao dịch trùng lặp.
7. **Khi Composio cũng thất bại:** Dừng chuyển tuyến; phân loại rõ BLOCKED, NOT VERIFIED hoặc FAILED, lưu lỗi và phạm vi ảnh hưởng, nêu phương án dự phòng an toàn. Không tuyên bố hoàn tất nếu chưa có bằng chứng xác nhận.
8. **Ghi nhận và học từ sự cố:** Ghi lại ứng dụng gốc, lỗi, toolkit/công cụ Composio đã thử, định danh tài khoản/workspace đã đối chiếu (không ghi secrets), trạng thái kết nối, idempotency key hoặc bằng chứng trạng thái tác vụ, kết quả, quota/chi phí đã xác minh và bước tiếp theo. Dùng lịch sử này cho lần xử lý sau để tránh lặp lại cùng lỗi.

## Thứ tự xử lý chuẩn

Kết nối gốc lỗi → kiểm tra lỗi → xác minh đúng tài khoản/workspace → đối chiếu trạng thái yêu cầu gốc và dữ liệu đích → tìm công cụ Composio đúng schema → chỉ thử lại phần chưa commit (tối đa một lần) → xác minh kết quả → ghi nhật ký.

Nếu không đủ quyền, không có kết nối ACTIVE, tài khoản/workspace không khớp, yêu cầu gốc còn có thể commit, schema không phù hợp hoặc chi phí chưa rõ: dừng và báo đúng điểm nghẽn; không tìm cách lách quyền hoặc chuyển sang một tích hợp khác trái với quy tắc riêng của dự án.
