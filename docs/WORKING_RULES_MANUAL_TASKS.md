# Quy tắc phối hợp và hướng dẫn thao tác thủ công

## Quy tắc bắt buộc khi giao việc cho người dùng

1. Khi công việc cần người dùng thao tác trên một dịch vụ bên ngoài, luôn cung cấp **đường link trực tiếp** đến đúng trang hoặc đúng khu vực cần mở. Ưu tiên link chính thức và đã kiểm tra; không chỉ nêu tên dịch vụ.
2. Hướng dẫn theo thiết bị người dùng đang sử dụng. Mặc định ưu tiên iPhone/iOS nếu chưa có thông tin mới; mô tả từng bước, tên menu/nút cần chạm và thứ tự thao tác.
3. Ghi rõ chính xác dữ liệu cần nhập hoặc chọn: tên trường, giá trị, kiểu dữ liệu, nơi lấy giá trị và phân biệt giá trị công khai với bí mật. Cung cấp nội dung có thể sao chép khi phù hợp.
4. Nêu kết quả mong đợi sau mỗi bước và cách người dùng xác nhận đã hoàn thành. Nếu giao diện có thể khác theo tài khoản/phiên bản, nêu đường đi dự phòng thay vì khẳng định nút chắc chắn có ở vị trí cố định.
5. Chia công việc thành các bước nhỏ, ưu tiên hoàn thành một thao tác quan trọng mỗi lần; không yêu cầu người dùng tự tìm kiếm hoặc tự suy đoán.
6. Chỉ yêu cầu người dùng làm những thao tác thực sự cần quyền đăng nhập, xác thực cá nhân hoặc thao tác bí mật mà trợ lý không thể thực hiện an toàn. Tự thực hiện các bước đọc/kiểm tra/chuẩn bị còn lại khi có công cụ phù hợp.
7. Không bao giờ yêu cầu người dùng gửi mật khẩu, OAuth client secret, API token, recovery code hoặc thông tin xác thực nhạy cảm vào cuộc trò chuyện, email hay ảnh chụp màn hình. Hướng dẫn nhập trực tiếp vào trang quản trị chính thức dưới dạng Secret.
8. Không tuyên bố thao tác đã hoàn thành chỉ dựa trên lời hướng dẫn. Chỉ xác nhận sau khi có bằng chứng đọc/kiểm tra được; nếu chưa thể xác minh, ghi rõ trạng thái chờ người dùng hoặc chưa kiểm chứng.
9. Với dự án AI Thực Chiến Blog, quản lý mã nguồn và PR hoàn toàn trên GitHub. OAuth, kiểm thử và deploy ứng dụng phải tách biệt Preview/staging với Production. Không tự ý thay đổi Worker Production, D1 Production, DNS, secrets Production, hoặc chạy workflow phát hành Production khi chưa có phê duyệt rõ ràng. Nội dung/bài viết và mục Ngân hàng AI chỉ được đưa vào lô phát hành công khai sau khi vượt qua toàn bộ cổng chất lượng; điều này không tự động cho phép merge hoặc deploy Production.

## Quy tắc liên tục công việc khi hết quota hoặc hết thời hạn miễn phí

1. Khi công cụ hiện tại hết quota, giới hạn tốc độ, hết lượt chạy hoặc tạm ngừng phục vụ, tự xác định chính xác công đoạn bị chặn và tìm ứng dụng/công cụ thay thế có chức năng tương đương.
2. Khi gói miễn phí hết thời hạn, bị giảm quyền sử dụng hoặc tính năng cần thiết chuyển sang gói trả phí, chủ động tìm phương án miễn phí khác trước khi yêu cầu người dùng can thiệp.
3. Ưu tiên theo thứ tự: công cụ đã kết nối và còn quota; công cụ miễn phí chính thức khác đã có sẵn; ứng dụng/plugin có thể kết nối; phương án mã nguồn mở hoặc tự chạy miễn phí nếu khả thi và an toàn.
4. Trước khi chuyển đổi, so sánh phạm vi chức năng, giới hạn miễn phí, độ tin cậy, quyền truy cập, bảo mật, quyền riêng tư, khả năng xuất/nhập dữ liệu và nguy cơ phát sinh chi phí. Chỉ chọn phương án đáp ứng đủ yêu cầu và có rủi ro thấp nhất.
5. Giữ nguyên trạng thái công việc: repository, nhánh, commit SHA, PR, tệp, kết quả kiểm thử và dữ liệu. Khi thay CI hoặc công cụ, ưu tiên chạy lại đúng commit hiện tại; không tạo thay đổi mã nguồn chỉ để né quota và không làm trùng lặp hoặc mất kết quả.
6. Với dự án này, GitHub là nền tảng duy nhất cho mã nguồn, nhánh và PR. Nếu quota GitHub Actions bị giới hạn, tìm CI miễn phí độc lập hoặc kiểm thử offline/read-only; kết quả thay thế phải gắn với đúng commit SHA và không tự nó cấp quyền merge hoặc phát hành.
7. Không tìm cách lách quota, giới hạn gói, cơ chế dùng thử, điều khoản dịch vụ hoặc kiểm soát bảo mật. Không tự nâng cấp, đăng ký trả phí, bật thanh toán, thêm thẻ hoặc tạo chi phí phát sinh.
8. Nếu công cụ thay thế yêu cầu OAuth, đăng nhập, cấp quyền hoặc xác nhận kết nối, tự tìm đúng ứng dụng và chuẩn bị hướng dẫn/liên kết chính thức; chỉ yêu cầu người dùng thực hiện bước xác thực mà nền tảng bắt buộc. Không yêu cầu người dùng gửi token/mật khẩu trong chat và không tự ý cấp quyền vượt quá phạm vi cần thiết.
9. Nếu không còn phương án miễn phí an toàn, lưu lại trạng thái, commit, kết quả và bước tiếp theo; tạm dừng riêng công đoạn bị chặn, tiếp tục các phần độc lập có thể làm được và báo rõ điều kiện để tiếp tục. Không đánh đổi an toàn hoặc dữ liệu để duy trì tiến độ.

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

Không thêm các secret này vào mã nguồn, biến Plain text hoặc Production. Sau khi người dùng cấu hình, trợ lý phải kiểm tra endpoint readiness và xác minh staging trước khi đề xuất triển khai; CI dry-run không được coi là triển khai thật.
