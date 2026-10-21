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

New registrations remain pending until the member confirms the one-time link sent through SMTP2GO. Links expire after 30 minutes; only a SHA-256 hash of each random token is stored in D1. Existing accounts are grandfathered as verified by migration `0002_email_verification.sql` so this feature does not lock out current members.

### Free-first setup (SMTP2GO)

1. Create a free SMTP2GO account: https://www.smtp2go.com/ (free plan: 1,000 emails/month and 200/day; without a verified sender domain, the account is limited to 25 emails/hour).
2. Open **Sending → Verified Senders → Single sender emails** and try to verify an email address you control. SMTP2GO sends a confirmation link to that inbox. No custom domain is needed if the provider accepts that sender address.
3. Important limitation: SMTP2GO does not permit single-sender verification when the sender's domain has DMARC configured, and a single-sender identity does not align SPF/DKIM, so delivery to spam or quarantine is more likely. If your existing mailbox is rejected under this rule, there is no safe guarantee of reliable, arbitrary-recipient sending without a sender domain; do not spoof `gmail.com`/`outlook.com`. Use a domain you control (potentially a no-cost subdomain only if its DNS supports the required records and SMTP2GO accepts it), or postpone production enforcement until a valid sender is available.
4. Create a restricted SMTP2GO API key and add it to the Cloudflare Worker as secret `SMTP2GO_API_KEY`. Set `COMMUNITY_EMAIL_FROM` to the exact verified sender address (a non-secret Worker variable is suitable). Never commit either value to Git.
5. Apply `migrations/0002_email_verification.sql` separately to production and preview D1 databases before deploying Worker code.
6. Verify that a message reaches a real inbox (including spam-folder checks) on a staging deployment before enabling email verification in production.

If either `SMTP2GO_API_KEY` or `COMMUNITY_EMAIL_FROM` is absent, registration fails closed with HTTP 503 and no pending account is left behind. Verification resend requests use the same generic public response for known and unknown email addresses.
