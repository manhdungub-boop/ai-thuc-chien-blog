# AI Thực Chiến

Blog tiếng Việt về ứng dụng AI, công cụ miễn phí và tự động hóa trong công việc thực tế. Website dùng HTML/CSS/JavaScript thuần, ưu tiên tải nhanh, giao diện responsive và hiệu ứng cuộn nhẹ.

## Website đang hoạt động

- Bản chính: https://ai-thuc-chien-blog.manhdungub.workers.dev/
- Bản dự phòng Cloudflare Pages: https://ai-thuc-chien-blog.pages.dev/
- RSS: https://ai-thuc-chien-blog.manhdungub.workers.dev/feed.xml
- Sitemap: https://ai-thuc-chien-blog.manhdungub.workers.dev/sitemap.xml
- Mã nguồn: https://github.com/manhdungub-boop/ai-thuc-chien-blog

## Chạy thử

Mở index.html trong trình duyệt để xem bản nguồn. Quy trình triển khai tạo thư mục dist bằng npm run build để Workers và Pages dùng cùng một gói tài nguyên. Google Fonts là tùy chọn; CSS có font dự phòng.

## Cấu trúc

- index.html: trang chủ.
- ve-chung-toi.html: mục tiêu, nguyên tắc biên tập và cách gửi phản hồi.
- styles.css: giao diện responsive và hiệu ứng.
- script.js: menu di động, hiệu ứng cuộn, tìm kiếm tiếng Việt không dấu và nút sao chép mẫu prompt.
- scripts/build_static_site.cjs: build dùng chung cho Workers, Pages và CI; kiểm tra tệp bắt buộc, năm header, tệp xác minh Search Console và bài viết trước khi tạo dist/.
- package.json: lệnh npm run build cho Cloudflare Workers Builds và GitHub Actions.
- scripts/test_homepage_search.cjs: kiểm thử tìm kiếm có/không dấu, chữ Đ hoa, kết quả rỗng và xóa từ khóa.
- scripts/test_copy_prompt.cjs: kiểm thử nút sao chép prompt và thông báo dự phòng.
- scripts/test_article_navigation.cjs: kiểm tra liên kết bài viết liên quan, đích tồn tại và bố cục.
- scripts/test_homepage_article_coverage.cjs: xác nhận mọi bài đã xuất bản đều có liên kết khám phá từ trang chủ.
- scripts/test_seo_consistency.cjs: kiểm tra canonical, metadata, JSON-LD, sitemap/RSS và đầu ra build.
- articles/: bài hướng dẫn thực hành AI và tự động hóa.
- sitemap.xml, feed.xml, robots.txt: tài nguyên cho công cụ tìm kiếm và người đọc RSS.
- .github/workflows/ci-quality.yml: kiểm thử mã nguồn khi push, pull request và chạy thủ công.
- .github/workflows/health-check.yml: kiểm tra nội dung và các tuyến trên cả hai bản triển khai sau khi deploy.
- .github/workflows/lighthouse-audit.yml: đo hiệu năng mobile trên website chính, bản dự phòng và một trang bài viết; lưu báo cáo thành GitHub Actions artifacts.
- worker.mjs: lớp runtime mỏng gắn security headers vào phản hồi từ tài nguyên tĩnh.
- _headers: chính sách header cho Cloudflare Pages/static assets.
- 404.html: trang thông báo đường dẫn không tồn tại.

## Kiểm thử hiệu năng

Mở https://github.com/manhdungub-boop/ai-thuc-chien-blog/actions/workflows/lighthouse-audit.yml và chọn Run workflow để đo ngay, hoặc chờ lịch chạy hằng tuần. Báo cáo được lưu trong mục Artifacts của lần chạy.

Audit chạy ba lần mỗi URL trên cấu hình mô phỏng thiết bị di động, gồm trang chủ và một bài viết của cả Worker lẫn Pages. Đây là số đo phòng thí nghiệm, không thay thế dữ liệu Core Web Vitals thực tế của người dùng trong Search Console/CrUX. Chưa đặt ngưỡng làm build thất bại cho đến khi có baseline đủ tin cậy.

## Đồng bộ Cloudflare Workers Builds

Hai trigger production của Worker chính và bản phụ cần dùng chung lệnh npm run build. Nếu thay đổi cấu hình build ngoài repository, dùng workflow Configure Cloudflare Workers Builds và secret CLOUDFLARE_WORKERS_BUILDS_API_TOKEN đã được cấu hình trong GitHub Actions. Không đưa token vào mã nguồn hoặc cuộc trò chuyện.

## Triển khai

### Cloudflare Workers — bản chính

Workflow Deploy Cloudflare Workers build tài nguyên, kiểm tra lớp bảo mật và xác minh các tuyến sau khi triển khai. Secret CLOUDFLARE_WORKERS_API_TOKEN phải được lưu trong GitHub Actions secrets. Nếu secret chưa được cấu hình, workflow sẽ không thay đổi Worker đang hoạt động.

### Cloudflare Pages — bản dự phòng

Bản dự phòng là https://ai-thuc-chien-blog.pages.dev/. Kiểm tra workflow Deploy Cloudflare Pages và trạng thái deploy sau mỗi lần thay đổi.

## Bảo vệ trình duyệt

Tệp _headers giữ chính sách cho Cloudflare Pages và static assets. Vì quy tắc đó không tự áp dụng cho mọi phản hồi do Worker code tạo ra, worker.mjs chủ động gắn header trực tiếp sau khi gọi binding ASSETS. Content Security Policy chưa được bật để tránh vô tình chặn script inline, Google Fonts hoặc Cloudflare Web Analytics; chỉ bổ sung sau khi kiểm thử đầy đủ.

## Kiểm tra sau mỗi lần xuất bản

- Health check tự dò các bài viết và kiểm tra tuyến chính trên cả hai bản triển khai.
- Sitemap phải khớp canonical của trang chủ, trang giới thiệu và toàn bộ bài viết; RSS phải khớp các canonical bài viết.
- Kiểm tra trạng thái Google Search Console và Cloudflare Web Analytics trong dashboard. HTTP 200 hoặc sitemap không lỗi không chứng minh Google đã lập chỉ mục hay analytics đang nhận dữ liệu.
- Chạy Lighthouse audit định kỳ để phát hiện xu hướng chậm đi. Chỉ thay đổi hiệu năng sau khi xác định được nguyên nhân bằng báo cáo.

## Quy trình biên tập an toàn

Chủ đề → nghiên cứu nguồn → bản nháp AI → kiểm tra sự thật và liên kết → người quản trị duyệt → xuất bản → tạo bản rút gọn cho mạng xã hội. Không tự động đăng hoặc gửi tin nhắn cho đến khi quy trình được thử nghiệm thành công và được chủ dự án xác nhận.

## Trạng thái và giới hạn

- Đây là website tĩnh; chưa có CMS, lịch tự động hoặc tích hợp mạng xã hội.
- Các bài viết nền tảng là nội dung nhập môn; cần kiểm chứng lại nguồn và cập nhật trước khi dùng làm tư vấn chuyên môn.
- URL workers.dev đang là địa chỉ chính thức dùng cho canonical và sitemap. Khi chuyển sang tên miền riêng, cần cập nhật canonical, Open Graph URL, sitemap và robots.txt đồng bộ.
