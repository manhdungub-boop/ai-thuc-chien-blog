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


## Required email verification

New registrations remain pending until the member confirms the one-time link sent through the Google Apps Script mail relay. Links expire after 30 minutes; only a SHA-256 hash of each random token is stored in D1. Existing accounts are grandfathered as verified by migration `0002_email_verification.sql` so this feature does not lock out current members.

### Free-first setup without a custom domain (Google Apps Script + Gmail)

This relay sends mail from the Google account that owns the script, so no custom sender domain is required. Google Apps Script currently lists a 100-recipient/day quota for consumer Gmail accounts; quotas can change and are enforced by Google.

1. Open https://script.google.com/home and create a new project using a Google account you control.
2. Copy `email-relay/Code.gs` from this repository into the editor. In **Project Settings → Script properties**, set `COMMUNITY_EMAIL_RELAY_SECRET` to a long random secret (at least 32 random characters). Use the exact same secret in Cloudflare Worker Secrets; do not place it in Git or in a URL.
3. Deploy → **New deployment** → type **Web app**. Choose **Execute as: Me** and access **Anyone** so Cloudflare can call it server-to-server. The public URL is protected by the shared secret; never publish the secret. Authorize sending as your own Google account.
4. Copy the Web app `/exec` URL into the Cloudflare Worker variable `COMMUNITY_EMAIL_RELAY_URL`; add the matching secret as Worker secret `COMMUNITY_EMAIL_RELAY_SECRET`. Configure preview separately from production. Keep both values absent in production until the real-inbox test passes.
5. Apply `migrations/0002_email_verification.sql` to the preview D1 first. Test a new registration, email arrival (including Spam), token expiry/replay, and login gating on Preview. Only then apply the migration and configure the relay for production as a separate rollout.

The Apps Script endpoint checks the shared secret before sending and returns only a generic error code; the secret is never returned to the browser or logged. A missing relay configuration fails closed with HTTP 503 and removes the newly created pending account. The resend endpoint uses the same generic public response for known and unknown email addresses.
