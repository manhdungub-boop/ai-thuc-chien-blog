# AI Thực Chiến

Blog tiếng Việt về ứng dụng AI, công cụ miễn phí và tự động hóa trong công việc thực tế. Website dùng HTML/CSS/JavaScript thuần, ưu tiên tải nhanh, giao diện responsive và hiệu ứng cuộn nhẹ.

## Website đang hoạt động

- Bản chính: https://ai-thuc-chien-blog.manhdungub.workers.dev/
- Bản dự phòng GitHub Pages: https://manhdungub-boop.github.io/ai-thuc-chien-blog/
- RSS: https://ai-thuc-chien-blog.manhdungub.workers.dev/feed.xml
- Mã nguồn: https://github.com/manhdungub-boop/ai-thuc-chien-blog

## Chạy thử

Mở index.html trong trình duyệt. Website không cần bước build. Google Fonts là tùy chọn; CSS có font dự phòng.

## Cấu trúc

- index.html: trang chủ.
- ve-chung-toi.html: mục tiêu, nguyên tắc biên tập và cách gửi phản hồi.
- styles.css: giao diện responsive và hiệu ứng.
- script.js: menu di động, hiệu ứng cuộn và tìm kiếm bài viết theo từ khóa (hỗ trợ tìm tiếng Việt không dấu).
- scripts/test_homepage_search.cjs: kiểm thử hồi quy cho tìm kiếm có/không dấu, chữ Đ hoa, kết quả rỗng và xóa từ khóa; bộ kiểm thử tự lấy thẻ bài viết từ trang chủ nên không khóa vào một số lượng cố định.
- scripts/test_article_navigation.cjs: tự phát hiện toàn bộ tệp bài viết và kiểm tra mục bài viết liên quan, tối thiểu ba liên kết duy nhất, đích tồn tại và bố cục đáp ứng.
- scripts/test_homepage_article_coverage.cjs: so sánh URL bài viết trong sitemap với liên kết trên trang chủ; CI báo lỗi nếu có bài đã xuất bản nhưng không được khám phá từ trang chủ.
- articles/: các bài viết hướng dẫn về AI cơ bản, workflow có kiểm duyệt, kiểm chứng nội dung, SEO kỹ thuật và đo lường hiệu quả blog. Danh sách được CI tự phát hiện từ các tệp HTML trong thư mục này.
- sitemap.xml: danh sách URL chính dành cho công cụ tìm kiếm.
- feed.xml: RSS 2.0 để người đọc theo dõi bài viết mới.
- robots.txt: cho phép trình thu thập thông tin truy cập và trỏ đến sitemap.
- .github/workflows/health-check.yml: kiểm tra HTML/SEO, liên kết nội bộ, dữ liệu sitemap/RSS khớp canonical, tuyến bài viết và tính đồng nhất của các bản triển khai.
- .github/workflows/deploy-cloudflare-workers.yml: đóng gói các tệp website tĩnh cùng `_headers`, chỉ phát hành Worker khi có token triển khai riêng, rồi xác minh năm header bảo mật và các tuyến quan trọng.
- favicon.svg: biểu tượng website.
- _headers: chính sách HTTP security headers cho Cloudflare Workers Static Assets và Cloudflare Pages; không thay thế việc kiểm tra cấu hình runtime sau triển khai.
- 404.html: trang thông báo đường dẫn không tồn tại.

## Triển khai

### GitHub Pages
Repository được cấu hình để phục vụ từ nhánh main, thư mục /. Mỗi lần cập nhật lên main, GitHub Pages sẽ tự build lại. Kiểm tra mục Settings → Pages nếu trạng thái build bị lỗi.

### Cloudflare Workers (bản chính hiện tại)
Worker đang phục vụ website tĩnh. URL công khai ở phần đầu tài liệu. Quy trình triển khai chuẩn nằm tại [GitHub Actions — Deploy Cloudflare Workers](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/workflows/deploy-cloudflare-workers.yml); quy trình đóng gói cả `_headers` để Cloudflare Workers Static Assets áp dụng header trên nội dung tĩnh, đồng thời giữ nguyên kiến trúc không cần Worker entrypoint.

Thiết lập một lần để bật triển khai tự động:
1. Trong [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens), tạo token phù hợp với quyền chỉnh sửa Workers Scripts trong đúng tài khoản Cloudflare của website. Ưu tiên mẫu **Edit Cloudflare Workers** hoặc token tùy chỉnh giới hạn vào tài khoản này.
2. Trong [GitHub Actions secrets của repository](https://github.com/manhdungub-boop/ai-thuc-chien-blog/settings/secrets/actions), thêm repository secret tên chính xác `CLOUDFLARE_WORKERS_API_TOKEN` và dán token vào trường Value. Không đưa token vào mã nguồn, issue, log hoặc cuộc trò chuyện.
3. Mở [Deploy Cloudflare Workers](https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/workflows/deploy-cloudflare-workers.yml) và chọn **Run workflow** trên nhánh `main` để phát hành và kiểm tra ngay.

Nếu secret chưa có, workflow chỉ kiểm tra gói tĩnh rồi bỏ qua phát hành; Worker live không bị thay đổi. Sau khi phát hành, workflow yêu cầu đủ cả năm header bảo mật và HTTP 200 tại bài viết, sitemap, RSS và tệp xác minh Search Console.

### Cloudflare Pages
Có thể kết nối repository tại https://dash.cloudflare.com/ → Workers & Pages → Create → Pages → Connect to Git. Dùng branch main, framework preset None, để trống build command và đặt output directory là dấu chấm. Nếu giao diện báo lỗi GitHub integration, không xóa Worker đang hoạt động; hãy kiểm tra quyền cài đặt ứng dụng Cloudflare trong GitHub trước.

## Bảo vệ trình duyệt

Tệp `_headers` bật `nosniff`, chống nhúng trang bằng iframe, chính sách referrer giới hạn, vô hiệu hóa một số quyền trình duyệt và HSTS trên HTTPS. Content Security Policy chưa được bật để tránh vô tình chặn script inline, Google Fonts hoặc Cloudflare Web Analytics; chỉ bổ sung sau khi kiểm thử đầy đủ.

## Kiểm tra sau mỗi lần xuất bản

- Health check tự dò tất cả `articles/*.html`; khi thêm bài, vẫn phải thêm thẻ bài viết trên trang chủ, canonical vào sitemap, mục RSS và ít nhất ba liên kết đọc tiếp phù hợp.
- Sitemap phải khớp chính xác các canonical của trang chủ, trang giới thiệu và toàn bộ bài viết; RSS phải khớp toàn bộ canonical bài viết.
- Kiểm tra trạng thái Google Search Console và Cloudflare Web Analytics trong dashboard; HTTP 200 hoặc sitemap không lỗi không chứng minh Google đã lập chỉ mục hay analytics đang nhận dữ liệu.

## Quy trình biên tập an toàn

Chủ đề → nghiên cứu nguồn → bản nháp AI → kiểm tra sự thật và liên kết → người quản trị duyệt → xuất bản → tạo bản rút gọn cho mạng xã hội. Không tự động đăng hoặc gửi tin nhắn cho đến khi quy trình được thử nghiệm thành công và được chủ dự án xác nhận.

## Trạng thái và giới hạn

- Đây là website tĩnh; chưa có CMS, lịch tự động hoặc tích hợp mạng xã hội.
- Các bài viết nền tảng là nội dung nhập môn; cần kiểm chứng lại nguồn và cập nhật trước khi dùng làm tư vấn chuyên môn.
- URL workers.dev đang là địa chỉ chính thức được dùng cho canonical và sitemap. Khi chuyển sang tên miền riêng, cần cập nhật canonical, Open Graph URL, sitemap và robots.txt đồng bộ.
