# Quy tắc phối hợp và hướng dẫn thao tác thủ công

## Quy tắc bắt buộc khi giao việc cho người dùng

1. Khi công việc cần người dùng thao tác trên một dịch vụ bên ngoài, luôn cung cấp **đường link trực tiếp** đến đúng trang hoặc đúng khu vực cần mở. Ưu tiên link chính thức và đã kiểm tra; không chỉ nêu tên dịch vụ.
2. Hướng dẫn theo thiết bị người dùng đang sử dụng. Mặc định ưu tiên iPhone/iOS nếu chưa có thông tin mới; mô tả từng bước, tên menu/nút cần chạm và thứ tự thao tác.
3. Ghi rõ chính xác dữ liệu cần nhập hoặc chọn: tên trường, giá trị, kiểu dữ liệu, nơi lấy giá trị và phân biệt giá trị công khai với bí mật. Cung cấp nội dung có thể sao chép khi phù hợp.
4. Nêu kết quả mong đợi sau mỗi bước và cách người dùng xác nhận đã hoàn thành. Nếu giao diện có thể khác theo tài khoản/phiên bản, nêu đường đi dự phòng thay vì khẳng định nút chắc chắn có ở vị trí cố định.
5. Chia công việc thành các bước nhỏ, ưu tiên hoàn thành một thao tác quan trọng mỗi lần; không yêu cầu người dùng tự tìm kiếm hoặc tự suy đoán.
6. Chỉ yêu cầu người dùng làm những thao tác thực sự cần quyền đăng nhập, xác thực cá nhân hoặc thao tác bí mật mà trợ lý không thể thực hiện an toàn. Tự thực hiện các bước đọc/kiểm tra/chuẩn bị còn lại khi có công cụ phù hợp.
7. Không bao giờ yêu cầu người dùng gửi mật khẩu, OAuth client secret, API token, recovery code hoặc thông tin xác thực nhạy cảm vào cuộc trò chuyện, email, ảnh chụp màn hình hay GitLab. Hướng dẫn nhập trực tiếp vào trang quản trị chính thức dưới dạng Secret.
8. Không tuyên bố thao tác đã hoàn thành chỉ dựa trên lời hướng dẫn. Chỉ xác nhận sau khi có bằng chứng đọc/kiểm tra được; nếu chưa thể xác minh, ghi rõ trạng thái chờ người dùng hoặc chưa kiểm chứng.
9. Với dự án AI Thực Chiến Blog, mọi thao tác OAuth/deploy phải giới hạn ở staging cho đến khi có kiểm thử thực tế và phê duyệt riêng. Không tự ý thay đổi Production, D1 production, DNS, secrets production, merge hoặc phát hành công khai.

## Mẫu trình bày bắt buộc cho mỗi việc người dùng phải làm

- **Mục đích:** thao tác này giải quyết điều gì.
- **Link trực tiếp:** URL chính thức tới đúng trang.
- **Các bước trên iPhone:** hướng dẫn tuần tự, cụ thể.
- **Giá trị cần nhập:** tên trường và giá trị chính xác; chỉ hiển thị dữ liệu không bí mật.
- **Kết quả mong đợi:** nội dung/trạng thái cần thấy sau khi lưu.
- **Cách báo hoàn thành:** yêu cầu người dùng trả lời ngắn gọn hoặc gửi ảnh đã che thông tin nhạy cảm.
- **Bước tiếp theo của trợ lý:** nêu rõ trợ lý sẽ tự kiểm tra/thực hiện gì sau khi người dùng xong.

## Áp dụng ngay: Google/Facebook OAuth cho staging

Worker mục tiêu: `ai-thuc-chien-blog-auth-app-preview`.

Bốn secret phải được tạo trực tiếp trong Cloudflare Worker staging:
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `FACEBOOK_OAUTH_CLIENT_ID`
- `FACEBOOK_OAUTH_CLIENT_SECRET`

Callback Google:
`https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev/api/community/oauth/google/callback`

Callback Facebook:
`https://ai-thuc-chien-blog-auth-app-preview.manhdungub.workers.dev/api/community/oauth/facebook/callback`

Không thêm các secret này vào GitLab, mã nguồn, biến Plain text hoặc Production. Sau khi người dùng cấu hình, trợ lý phải kiểm tra endpoint readiness và xác minh staging trước khi đề xuất triển khai; CI dry-run không được coi là triển khai thật.
