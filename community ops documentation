# Cộng đồng thành viên AI Thực Chiến

## Tính năng

- Đăng ký và đăng nhập bằng email, tên thành viên và mật khẩu.
- Mật khẩu được băm bằng PBKDF2-HMAC-SHA-256 với salt ngẫu nhiên; mật khẩu gốc không được lưu.
- Phiên đăng nhập dùng cookie `__Host-ai_community` với `HttpOnly`, `Secure`, `SameSite=Lax` và token chỉ lưu dưới dạng SHA-256 trong D1.
- Bốn phòng thảo luận: `tools`, `automation`, `content`, `earning`.
- Tin nhắn là văn bản thuần, tối đa 800 ký tự; thành viên chỉ xóa tin nhắn của chính mình.
- Giới hạn tần suất đăng ký, đăng nhập và gửi tin nhắn. Không lưu IP gốc trong bảng giới hạn tần suất; khóa giới hạn dùng hash.

## Triển khai

Workflow `Deploy Cloudflare Workers` tìm hoặc tạo D1 có tên cố định `ai-thuc-chien-community`, áp dụng các migration trong `migrations/`, tạo cấu hình Wrangler tạm có binding `DB`, rồi deploy Worker. Dữ liệu database hiện có được giữ nguyên khi deploy tiếp theo.

GitHub Actions secret `CLOUDFLARE_WORKERS_API_TOKEN` phải có quyền **D1: Edit** và **Workers Scripts: Edit** trong đúng Cloudflare account được cấu hình trong `wrangler.jsonc`. Nếu thiếu quyền, bước provisioning sẽ thất bại trước bước deploy; không đưa token vào mã nguồn hoặc tin nhắn.

## Kiểm thử cục bộ

```bash
node --check worker.mjs
node --check script.js
node scripts/test_community_api.mjs
python3 scripts/test_community_schema.py
```

## Giới hạn của bản đầu

- Chưa có xác minh email, đặt lại mật khẩu, công cụ kiểm duyệt quản trị viên, báo cáo tin nhắn hoặc khôi phục tài khoản.
- Danh sách phòng cập nhật định kỳ khoảng 15 giây khi người dùng đang xem; đây chưa phải WebSocket/push thời gian thực.
- Email không hiển thị cho thành viên khác; tên hiển thị và nội dung tin nhắn được chia sẻ trong phòng tương ứng.
- Trước khi mở rộng công khai, cần bổ sung quy trình kiểm duyệt/báo cáo, điều khoản cộng đồng và chính sách quyền riêng tư đầy đủ.
