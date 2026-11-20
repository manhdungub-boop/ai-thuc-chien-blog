# Quy tắc xuất bản nội dung mạng xã hội — AI Thực Chiến

**Trạng thái:** Quy tắc vận hành bắt buộc; chưa kích hoạt đăng tự động.  
**Múi giờ điều phối:** Asia/Ho_Chi_Minh (UTC+07:00).

## 1. Nguyên tắc thời gian không cố định

- Không dùng một giờ cố định, một ngày cố định hoặc một chu kỳ đăng lặp lại dễ đoán cho bài đăng công khai.
- Khi có bộ lập lịch xuất bản được phê duyệt, phải xáo trộn độc lập ngày đăng, khoảng cách giữa các bài và thời điểm cụ thể trong khung giờ phù hợp.
- Không tái sử dụng lịch cũ theo mẫu tuần; không đăng dồn để bù các lần bỏ lỡ.
- Các khung giờ chỉ là giới hạn đủ điều kiện, không phải giờ hẹn cố định. Lựa chọn cuối cùng phải được ngẫu nhiên hóa trong khung đủ điều kiện.
- Dùng múi giờ địa phương của nhóm độc giả mục tiêu; mặc định Việt Nam nếu chưa có dữ liệu đáng tin cậy hơn.

## 2. Giới hạn tần suất và chống spam

- Mỗi nền tảng không quá một bài mới trong 24 giờ, trừ khi có phê duyệt biên tập riêng.
- Khoảng cách giữa các lần xuất bản liên tiếp trên cùng nền tảng phải được xáo trộn và không ngắn hơn 24 giờ; mặc định ưu tiên khoảng 24–72 giờ, điều chỉnh theo dữ liệu hiệu quả và sức chứa nội dung.
- Không đăng đồng loạt cùng một nội dung lên mọi nền tảng trong cùng một thời điểm; điều chỉnh định dạng, tiêu đề, mô tả và CTA phù hợp từng nền tảng.
- Nếu không có thời điểm phù hợp hoặc nội dung chưa đạt chuẩn, bỏ qua lượt đăng; không ép đăng cho đủ lịch.

## 3. Điều kiện nội dung trước khi xếp lịch

Chỉ đưa nội dung vào hàng chờ khi:
- Đã đọc và đối chiếu bài gốc; các tuyên bố có căn cứ và liên kết hoạt động.
- Đã biên tập tiếng Việt tự nhiên, đúng ngữ cảnh, không sao chép máy móc RSS.
- Hình ảnh, video, nhạc, giọng đọc và tư liệu có quyền sử dụng phù hợp.
- Đã kiểm tra dữ liệu cá nhân, bí mật, thông tin nội bộ và an toàn thương hiệu.
- Video phải qua kiểm tra nghe thực tế; không tự kết luận giọng đọc tự nhiên chỉ từ kiểm thử mã nguồn.
- Bài/video đã được duyệt theo quy trình biên tập hiện hành.

## 4. Tài khoản và quyền xuất bản

- Xác minh đúng tài khoản, Trang Facebook, kênh TikTok hoặc YouTube trước khi cấu hình bất kỳ kết nối xuất bản nào.
- Không dùng tài khoản/kênh không thuộc dự án hoặc tài khoản có tên/định danh không khớp.
- Không coi quyền truy cập quảng cáo là quyền đăng nội dung tự nhiên.
- Không lưu token, cookie, mật khẩu hoặc bí mật trong mã nguồn, log hay artifact.
- Không bật đăng tự động, gọi API xuất bản, hoặc đăng công khai cho đến khi tài khoản, quyền, cơ chế thu hồi và phương án dừng khẩn cấp được xác minh.

## 5. Điều chỉnh theo dữ liệu

- Theo dõi lượt tiếp cận, thời lượng xem, tỷ lệ xem hết, tương tác có ý nghĩa, lượt nhấp và phản hồi tiêu cực.
- Chỉ dùng dữ liệu phân tích hợp lệ của chính các tài khoản đã xác minh; không suy đoán giờ tốt nhất từ dữ liệu thiếu.
- Điều chỉnh khung giờ đủ điều kiện và tần suất theo chu kỳ đánh giá; vẫn giữ ngẫu nhiên hóa, không chuyển thành lịch cố định.
- Không mua tương tác, spam, lặp nội dung hoặc dùng thủ thuật gây hiểu nhầm.

## 6. Tách biệt lịch tạo bản nháp và lịch xuất bản

- Lịch chạy workflow nội bộ để tạo bản nháp có thể cố định.
- Lịch đăng công khai phải được xáo trộn theo các nguyên tắc ở trên.
- Workflow `free-social-content-pack.yml` hiện chỉ tạo artifact bản nháp, không đăng bài, không gọi API mạng xã hội và không cần bí mật xuất bản.
- Không được mô tả việc xáo trộn là đã vận hành cho đến khi có bộ lập lịch xuất bản thực tế, kiểm thử được và được phê duyệt riêng.

## 7. Kiểm soát phát hành

Mọi thay đổi bộ lập lịch phải phát triển trên nhánh riêng và kiểm thử trong môi trường không sản xuất. Không thay đổi Worker Production, DNS, D1, cấu hình đang phục vụ người dùng hoặc tài khoản mạng xã hội thật trong phạm vi quy tắc này. Chỉ xem xét kích hoạt sau khi kiểm tra đạt yêu cầu, xác minh tài khoản và quyền, có giới hạn tần suất, log an toàn, cơ chế tắt nhanh và phương án quay lui.
