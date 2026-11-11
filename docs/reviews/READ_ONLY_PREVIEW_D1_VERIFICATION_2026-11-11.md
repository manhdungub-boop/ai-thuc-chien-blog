# Xác minh bổ sung Preview D1 — 11/11/2026

## Phạm vi

- Repository: `manhdungub-boop/ai-thuc-chien-blog`
- PR: #96
- HEAD trước addendum: `55c5aa5071f88e9bb8718b67f9348c034cd0de24`
- Preview Worker: `ai-thuc-chien-blog-auth-app-preview`
- Preview D1: `ai-thuc-chien-community-preview`
- Database UUID: `51d814c8-a3fc-4481-a5f1-60bc67617f3c`
- Chỉ thực hiện đọc metadata, cấu hình binding và truy vấn `sqlite_master`; không đọc dữ liệu thành viên/tin nhắn, không ghi dữ liệu, không chạy migration.

## Kết quả xác minh trực tiếp

1. Cloudflare Worker settings xác nhận Auth App Preview có binding D1 `DB` trỏ đúng UUID Preview nêu trên; có `AI`, `ASSETS`, `COMMUNITY_EMAIL_RELAY_URL`, `GOOGLE_OAUTH_CLIENT_ID`.
2. Secret binding metadata có `GOOGLE_OAUTH_CLIENT_SECRET`, nhưng không có `COMMUNITY_EMAIL_RELAY_SECRET`. Không đọc bất kỳ secret value nào.
3. D1 metadata xác nhận database Preview tồn tại, vùng APAC, có 9 bảng theo metadata dịch vụ.
4. Read-only SQL:
   `SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY type, name`
   hoàn tất thành công; trả về các bảng cộng đồng:
   - `community_email_verification_status`
   - `community_email_verification_tokens`
   - `community_members`
   - `community_messages`
   - `community_oauth_accounts`
   - `community_password_reset_tokens`
   - `community_rate_limits`
   - `community_sessions`
   cùng `d1_migrations` và các bảng SQLite nội bộ.
5. Một truy vấn chỉ đọc bổ sung lấy định nghĩa bảng từ `sqlite_master` và đối chiếu các cột cần thiết cho thành viên, phiên, tin nhắn và rate-limit; kiểm tra cấu trúc đã đạt các cột bắt buộc được khai báo trong chẩn đoán.
6. D1 response báo `success=true`, `changed_db=false`, `rows_written=0`. Đây là bằng chứng schema/metadata read-only, không phải bằng chứng CRUD hoặc E2E của ứng dụng.

## Trạng thái sau xác minh

| Hạng mục | Trạng thái |
|---|---|
| Preview D1 tồn tại và truy cập được bằng quyền đọc hiện có | PASS |
| Worker Preview binding trỏ đúng Preview D1 UUID | PASS |
| Bảng/cột cộng đồng bắt buộc được kiểm tra | PASS |
| Không ghi dữ liệu / không migration | PASS |
| Email relay secret binding trên Auth App Preview | BLOCKED — chưa có |
| Live email verification / password reset | NOT RUN — thiếu relay secret |
| Live Google OAuth callback/session trên Worker này | NOT VERIFIED — CI mock không thay thế live E2E |
| Independent security review | BLOCKED — chưa có review độc lập mới |
| Production release | NOT AUTHORIZED |

## Giới hạn và hành động tiếp theo

- Không thêm, xoay vòng, sao chép hoặc xóa secret tự động. Cần credential Preview riêng được chủ sở hữu cấp qua secret manager; không gửi secret trong chat.
- Không sửa Production Worker, DNS, D1 Production hoặc dữ liệu người dùng.
- Khi Preview relay secret được cấp hợp lệ, chỉ chạy E2E với tài khoản thử nghiệm và hộp thư thử nghiệm; không gửi email tới người dùng thật.
- Giữ PR #96 Draft/open; không merge hoặc deploy Production khi các gate còn BLOCKED/NOT VERIFIED.

## Bằng chứng thao tác

- Cloudflare Worker settings/secrets: chỉ đọc tên binding, không đọc giá trị secret.
- Cloudflare D1: chỉ đọc metadata và `sqlite_master`; `rows_written=0`.
- Không có thay đổi Worker, D1, DNS, secret, tài khoản hoặc dữ liệu người dùng trong đợt xác minh này.
