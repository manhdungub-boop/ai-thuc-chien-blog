# Quy tắc vận hành dự án — GitHub là nền tảng duy nhất

**Hiệu lực:** 2026-11-09  
**Phạm vi:** Toàn bộ công việc phát triển, nội dung, kiểm thử, CI/CD và phát hành của dự án AI Thực Chiến Blog.

## 1. Nền tảng duy nhất

- GitHub repository `manhdungub-boop/ai-thuc-chien-blog` là nguồn dữ liệu và mã nguồn chuẩn duy nhất.
- Chỉ sử dụng GitHub cho source control, branches, commits, pull requests, code review, Issues, GitHub Actions, CI và lưu trữ bằng chứng kiểm thử.
- Không sử dụng GitLab cho bất kỳ hoạt động nào của dự án: không đăng nhập, không gọi GitLab API/connector, không đọc/ghi repository, không tạo hoặc cập nhật branch/Merge Request/Issue, không chạy pipeline, không đồng bộ hoặc đối chiếu mã nguồn.
- Không dùng GitLab làm phương án dự phòng khi GitHub Actions hoặc dịch vụ khác gặp giới hạn. Phải tìm phương án kiểm thử độc lập, miễn phí và an toàn nhưng không quay lại GitLab.
- Không đưa GitLab vào báo cáo trạng thái như một nguồn CI hoặc nguồn mã đang hoạt động. Nếu tài liệu lịch sử buộc phải nhắc đến GitLab, phải ghi rõ đó là lịch sử/di sản, không phải nền tảng hiện hành.

## 2. Ngắt sử dụng và bảo toàn dữ liệu GitLab cũ

- Từ thời điểm quy tắc này có hiệu lực, trợ lý phải coi mọi kết nối và repository GitLab cũ là ngoài phạm vi vận hành; tuyệt đối không sử dụng chúng.
- Không xóa repository, branch, dữ liệu, tài khoản, token hoặc cấu hình GitLab cũ một cách tự động. Việc xóa có thể không thể khôi phục và cần một yêu cầu riêng, rõ ràng.
- Nếu một tích hợp bên ngoài (ví dụ Cloudflare, Composio hoặc dịch vụ CI) vẫn còn liên kết GitLab, không được tiếp tục dùng liên kết đó. Chỉ tháo liên kết sau khi xác định đúng đối tượng, xác nhận GitHub đã là nguồn thay thế và thao tác không ảnh hưởng Production; nếu công cụ không hỗ trợ, báo rõ phần cần chủ tài khoản thao tác thủ công.
- Không được tuyên bố đã ngắt quyền OAuth/tích hợp GitLab ở cấp tài khoản khi chưa có bằng chứng xác nhận từ dịch vụ tương ứng. Việc ngừng sử dụng GitLab trong quy trình làm việc không đồng nghĩa với việc quyền OAuth đã bị thu hồi.

## 3. Quy trình GitHub bắt buộc

- Mọi thay đổi phải bắt đầu từ trạng thái GitHub được xác minh; ghi nhận branch, commit SHA, PR và các workflow liên quan.
- Thực hiện thay đổi trên branch riêng và mở Pull Request để review; không ghi trực tiếp lên `main`.
- Chỉ công nhận kết quả CI khi workflow đã hoàn tất trên đúng commit SHA đang được xem xét. Check đang chạy, cũ, thiếu hoặc thuộc SHA khác không được coi là PASS.
- Khi có nhiều PR hoặc branch liên quan, kiểm tra base/head SHA để tránh nhầm lẫn; không suy diễn rằng một PR đã nhận thay đổi từ PR khác nếu chưa xác minh.
- Nếu GitHub Actions bị giới hạn, ưu tiên kiểm thử cục bộ/độc lập miễn phí hoặc chờ quota; không chuyển lại GitLab.
- Báo cáo phải phân biệt rõ: đã kiểm tra bằng công cụ, đã được người dùng xác nhận thủ công, đang chờ, bị chặn và chưa thể xác minh.

## 4. An toàn triển khai

- Ưu tiên read-only, test, simulation và Preview/Staging.
- Không merge PR, triển khai Production, áp dụng migration D1 Production, thay đổi DNS, secrets hoặc dữ liệu thật nếu chưa đáp ứng quy tắc phê duyệt hiện hành.
- GitHub là nền tảng quản lý mã nguồn và CI; việc chuyển sang GitHub không tự động cho phép thay đổi Production hoặc tháo bỏ các kiểm soát bảo vệ.

## 5. Quy tắc chống nhầm lẫn

Trước mỗi thao tác kỹ thuật, xác nhận rõ repository GitHub, branch, commit SHA và môi trường mục tiêu. Nếu thông tin không khớp, dừng thao tác và kiểm tra lại. Không lấy tên branch, MR, pipeline hoặc trạng thái từ GitLab để áp dụng cho GitHub.

**Chỉ thị vận hành ngắn:** GitHub only. No GitLab access, no GitLab API, no GitLab CI, no GitLab fallback, no GitLab sync.
