# Quy tắc xuất bản nội dung Facebook — AI Thực Chiến

**Trạng thái:** Quy tắc vận hành bắt buộc; đăng tự động hiện chưa được kích hoạt.  
**Phạm vi hiện tại:** Chỉ Facebook. TikTok và YouTube không thuộc phạm vi kết nối hoặc xuất bản trong giai đoạn này.  
**Múi giờ điều phối:** Asia/Ho_Chi_Minh (UTC+07:00).

## 1. Lịch đăng phải được xáo trộn

- Không dùng một giờ cố định, một ngày cố định hoặc chu kỳ đăng lặp lại dễ đoán.
- Khi bộ lập lịch Facebook được phê duyệt, phải xáo trộn độc lập ngày đăng, khoảng cách giữa các bài và thời điểm cụ thể trong khung giờ phù hợp.
- Mặc định ưu tiên khoảng cách 24–72 giờ; không đăng quá một bài mới trong 24 giờ.
- Khung giờ chỉ là giới hạn đủ điều kiện, không phải giờ hẹn. Lựa chọn cuối cùng phải được ngẫu nhiên hóa trong khung đủ điều kiện.
- Không đăng dồn để bù lượt bị bỏ lỡ; nếu nội dung chưa đạt chuẩn thì bỏ qua lượt đăng.

## 2. Chỉ đăng nội dung đã qua kiểm tra

Chỉ đưa nội dung vào hàng chờ Facebook khi:
- Đã đọc và đối chiếu bài gốc; tuyên bố có căn cứ và liên kết hoạt động.
- Đã biên tập tiếng Việt tự nhiên, không sao chép máy móc RSS.
- Hình ảnh, video, nhạc, giọng đọc và tư liệu có quyền sử dụng phù hợp.
- Đã kiểm tra dữ liệu cá nhân, bí mật, thông tin nội bộ và an toàn thương hiệu.
- Video phải qua kiểm tra nghe/xem thực tế; không kết luận giọng tự nhiên chỉ từ benchmark hoặc mã nguồn.
- Bài đăng đã được duyệt theo quy trình biên tập hiện hành.

## 3. Tài khoản và quyền Facebook

- Chỉ sử dụng đúng Trang Facebook thuộc dự án sau khi xác minh quyền quản trị và phạm vi quyền đăng.
- Không dùng tài khoản cá nhân hoặc Trang không thuộc dự án.
- Không coi quyền quảng cáo là quyền đăng nội dung tự nhiên.
- Không lưu token, cookie, mật khẩu hoặc bí mật trong mã nguồn, log hay artifact.
- Không bật API xuất bản hoặc đăng công khai cho đến khi quyền, cơ chế thu hồi, giới hạn tần suất, log an toàn, nút dừng khẩn cấp và phương án quay lui được xác minh.

## 4. Ngoài phạm vi

- Không kết nối hoặc xuất bản lên TikTok/YouTube trong giai đoạn hiện tại.
- Không đăng video công khai cho đến khi giọng đọc tiếng Việt đạt nghe thử thực tế, xác minh quyền của đúng voice/nhạc/tư liệu và được duyệt riêng.
- Không mua tương tác, spam, đăng lặp hoặc dùng thủ thuật gây hiểu nhầm.

## 5. Theo dõi và điều chỉnh

- Chỉ dùng dữ liệu phân tích hợp lệ từ Trang Facebook đã xác minh; không suy đoán giờ tốt từ dữ liệu thiếu.
- Theo dõi lượt tiếp cận, tương tác có ý nghĩa, lượt nhấp và phản hồi tiêu cực.
- Điều chỉnh khung giờ đủ điều kiện theo dữ liệu nhưng vẫn giữ ngẫu nhiên hóa, không chuyển thành lịch cố định.

## 6. Tách biệt tạo bản nháp và xuất bản

- Lịch chạy workflow nội bộ để tạo bản nháp có thể cố định.
- Lịch đăng Facebook công khai phải được xáo trộn theo quy tắc trên.
- Workflow `free-social-content-pack.yml` chỉ tạo artifact bản nháp; không đăng bài, không gọi API mạng xã hội và không cần bí mật xuất bản.
- Không được mô tả việc xáo trộn là đã vận hành cho đến khi có bộ lập lịch thực tế và được kiểm thử.

## 7. Kiểm soát phát hành

Mọi thay đổi bộ lập lịch phải phát triển trên nhánh riêng và kiểm thử trong môi trường không sản xuất. Không thay đổi Worker Production, DNS, D1, cấu hình đang phục vụ người dùng hoặc tài khoản mạng xã hội thật trong phạm vi quy tắc này. Chỉ xem xét kích hoạt sau khi mọi kiểm tra đạt yêu cầu, có quyền truy cập hợp lệ, giới hạn tần suất, cơ chế tắt nhanh và phương án quay lui.
