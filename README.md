# AI Thực Chiến

Blog tiếng Việt về ứng dụng AI, công cụ miễn phí và tự động hóa trong công việc thực tế.

## Chạy thử

Mở `index.html` trong trình duyệt. Website sử dụng HTML/CSS/JavaScript thuần, không cần build step.

## Triển khai Cloudflare Pages

1. Đăng nhập Cloudflare: https://dash.cloudflare.com/
2. Vào **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. Chọn repository `manhdungub-boop/ai-thuc-chien-blog`.
4. Framework preset: **None**; Build command để trống; Build output directory: `/` (hoặc theo lựa chọn giao diện Cloudflare).
5. Deploy và kiểm tra URL được cấp.

## Cấu trúc

- `index.html`: trang chủ
- `styles.css`: giao diện responsive và hiệu ứng
- `script.js`: menu di động, hiệu ứng cuộn
- `articles/`: bài viết nền tảng

## Quy trình biên tập dự kiến

Chủ đề → nghiên cứu nguồn → bản nháp AI → kiểm tra sự thật/liên kết → người quản trị duyệt → xuất bản → tạo bản rút gọn cho mạng xã hội. Không bật tự đăng cho tới khi thử nghiệm thành công và được chủ dự án xác nhận.

## Lưu ý

- Website hiện là bản tĩnh; chưa có CMS, lịch tự động hoặc kết nối mạng xã hội.
- Google Fonts có thể cần Internet; các font dự phòng được khai báo trong CSS.
- Nội dung bài nền tảng cần được rà soát nguồn và cập nhật trước khi dùng làm tư vấn chuyên môn.
