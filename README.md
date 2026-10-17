# AI Thực Chiến

Blog tiếng Việt về ứng dụng AI, công cụ miễn phí và tự động hóa trong công việc thực tế. Website dùng HTML/CSS/JavaScript thuần, ưu tiên tải nhanh, giao diện responsive và hiệu ứng cuộn nhẹ.

## Website đang hoạt động

- Bản chính: https://ai-thuc-chien-blog.manhdungub.workers.dev/
- Bản dự phòng GitHub Pages: https://manhdungub-boop.github.io/ai-thuc-chien-blog/
- Mã nguồn: https://github.com/manhdungub-boop/ai-thuc-chien-blog

## Chạy thử

Mở index.html trong trình duyệt. Website không cần bước build. Google Fonts là tùy chọn; CSS có font dự phòng.

## Cấu trúc

- index.html: trang chủ.
- styles.css: giao diện responsive và hiệu ứng.
- script.js: menu di động và hiệu ứng cuộn.
- articles/: bốn bài viết nền tảng.
- sitemap.xml: danh sách URL chính dành cho công cụ tìm kiếm.
- robots.txt: cho phép trình thu thập thông tin truy cập và trỏ đến sitemap.
- favicon.svg: biểu tượng website.
- 404.html: trang thông báo đường dẫn không tồn tại.

## Triển khai

### GitHub Pages
Repository được cấu hình để phục vụ từ nhánh main, thư mục /. Mỗi lần cập nhật lên main, GitHub Pages sẽ tự build lại. Kiểm tra mục Settings → Pages nếu trạng thái build bị lỗi.

### Cloudflare Workers (bản chính hiện tại)
Worker đang phục vụ website tĩnh. URL công khai ở phần đầu tài liệu.

### Cloudflare Pages
Có thể kết nối repository tại https://dash.cloudflare.com/ → Workers & Pages → Create → Pages → Connect to Git. Dùng branch main, framework preset None, để trống build command và đặt output directory là dấu chấm. Nếu giao diện báo lỗi GitHub integration, không xóa Worker đang hoạt động; hãy kiểm tra quyền cài đặt ứng dụng Cloudflare trong GitHub trước.

## Quy trình biên tập an toàn

Chủ đề → nghiên cứu nguồn → bản nháp AI → kiểm tra sự thật và liên kết → người quản trị duyệt → xuất bản → tạo bản rút gọn cho mạng xã hội. Không tự động đăng hoặc gửi tin nhắn cho đến khi quy trình được thử nghiệm thành công và được chủ dự án xác nhận.

## Trạng thái và giới hạn

- Đây là website tĩnh; chưa có CMS, lịch tự động hoặc tích hợp mạng xã hội.
- Các bài viết nền tảng là nội dung nhập môn; cần kiểm chứng lại nguồn và cập nhật trước khi dùng làm tư vấn chuyên môn.
- URL workers.dev đang là địa chỉ chính thức được dùng cho canonical và sitemap. Khi chuyển sang tên miền riêng, cần cập nhật canonical, Open Graph URL, sitemap và robots.txt đồng bộ.
