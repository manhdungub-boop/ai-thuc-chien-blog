# Kiểm tra tác giả và ghi công 66 bài HTML — 31/10/2026

## Phạm vi
- Repository: `manhdungub/ai-thuc-chien-blog`
- Nguồn trước chỉnh sửa: nhánh `staging/auth-worker-build`
- Phạm vi: 66 tệp HTML trong `site-snapshot/articles/`
- Mục tiêu biên tập đã được chủ dự án yêu cầu: dùng tên tác giả `DUNG - AI` và nhắc độc giả ghi rõ tác giả khi trích dẫn/sử dụng lại bài.

## Kết quả kiểm tra trước chỉnh sửa
- 66/66 tệp có `<meta name="author" content="AI Thực Chiến">`.
- 66/66 dữ liệu có cấu trúc BlogPosting ghi tác giả là tổ chức `AI Thực Chiến`.
- Không phát hiện dòng byline chuẩn hiển thị tác giả `DUNG - AI`.
- Không phát hiện ghi chú chuẩn ở cuối bài yêu cầu ghi công tác giả.
- 66/66 có thẻ `<title>` và canonical.
- Kiểm tra cấu trúc HTML tĩnh không phát hiện thẻ `<img>` trong 66 bài; điều này không kết luận về SVG inline hoặc hình nền CSS.
- Một số trang chưa phát hiện mục/đường dẫn nguồn hiển thị qua phép dò cấu trúc đơn giản. Đây là tín hiệu cần rà soát nguồn thủ công, không phải kết luận nội dung không có nguồn hoặc đạo văn.

## Nội dung chỉnh sửa trong nhánh riêng
Với từng tệp trong phạm vi:
1. Đổi meta author thành `DUNG - AI`.
2. Đổi tác giả BlogPosting trong JSON-LD thành `Person: DUNG - AI`.
3. Giữ nguyên publisher `AI Thực Chiến` vì đây là tên website/nhà xuất bản, không phải tác giả.
4. Thêm byline hiển thị ở đầu nội dung: `Tác giả: DUNG - AI`.
5. Thêm ghi chú cuối bài: khi trích dẫn, chia sẻ hoặc sử dụng lại, vui lòng ghi rõ tác giả DUNG - AI và dẫn liên kết về bài gốc; tài sản bên thứ ba vẫn theo giấy phép/điều kiện riêng.

## Giới hạn quan trọng
- Đây là rà soát metadata/byline/ghi công và một số dấu hiệu nguồn trong HTML, không phải ý kiến pháp lý.
- Chưa hoàn thành đối chiếu đạo văn/toàn văn với nguồn bên ngoài cho 66 bài.
- Chưa xác minh quyền sử dụng đối với từng ảnh, biểu trưng, trích đoạn hoặc tài sản bên thứ ba.
- Chưa chạy Node.js 22 validator, trình duyệt mobile hoặc GitLab CI vì CI đang bị `ci_quota_exceeded`.
- Chưa kiểm tra trực quan từng trang bằng trình duyệt; cần staging preview và QA hiển thị.
- Không thêm hình ảnh vào 66 bài trong đợt này. Các SVG bản thảo trong `docs/content-drafts/assets/` chưa được tích hợp vào HTML website.

## Trạng thái phát hành
Các thay đổi chỉ được ghi vào nhánh `editorial/author-attribution-66-articles-20261031` và MR Draft. Không merge, không deploy, không xuất bản công khai; không sửa catalog chính, Worker, D1, DNS, secrets hoặc dữ liệu production.


## Phụ lục cập nhật bằng chứng — 01/11/2026
Phần dưới đây cập nhật các giới hạn và ghi chú lịch sử phía trên sau khi nhánh nguồn hoàn tất đợt tích hợp SVG. Không xóa kết quả kiểm tra ban đầu; các kết luận trước chỉnh sửa vẫn là ảnh chụp trạng thái của staging tại thời điểm audit.

### Trạng thái nội dung trên nhánh MR hiện tại
- Bộ kiểm tra `scripts/verify-article-diagrams.mjs` yêu cầu mỗi bài HTML có đúng một sơ đồ SVG inline, slug duy nhất khớp tên tệp, `title`/`desc` gắn ARIA, `role=img`, `figcaption`, ba bước sơ đồ và không phụ thuộc ảnh ngoài.
- Bộ kiểm tra `scripts/verify-article-attribution.mjs` xác minh meta author, JSON-LD BlogPosting Person author, publisher Organization, byline và ghi chú ghi công trên toàn bộ tệp bài; đồng thời kiểm tra author và số lượng 66 bài trên homepage.
- CircleCI pipeline #30 đã nhận đúng branch `editorial/author-attribution-66-articles-20261031` và checkout chính xác SHA `c64e3275625c7c9b455c6195489ac282ab42058c`. Workflow `circleci_fallback_mr_65` có trạng thái **success**.
- Workflow chạy Node.js 22: syntax checks và offline test suite, bao gồm `verify-article-diagrams`, `verify-article-attribution`, static snapshot, release safety, catalog validators/UI audit; job Python 3.12 chạy migration checks trên in-memory SQLite, `generate-article-diagrams.py --check` và internal similarity audit. Đây là kiểm thử tự động trên commit MR, không phải kiểm thử production.
- Do đó, hai ghi chú cũ “chưa chạy Node.js 22 validator” và “SVG bản thảo chưa tích hợp” không còn mô tả trạng thái hiện tại của nhánh MR; chúng chỉ phản ánh trạng thái trước khi các commit nội dung và kiểm thử được thêm.

### QA còn mở
- Trang staging hiện đang phục vụ nhánh đích `staging/auth-worker-build`, không phải commit MR !65; vì vậy không thể dùng trang đó để xác nhận thay đổi NotebookLM hoặc SVG của MR.
- Chưa có preview riêng được xác nhận cho SHA `c64e327...`; chưa thực hiện kiểm tra trực quan đầy đủ trên desktop và mobile.
- Kiểm tra similarity nội bộ 66 bài không thay thế việc đối chiếu toàn văn với nguồn bên ngoài. External originality review, fact-check từng bài và kiểm tra quyền tài sản bên thứ ba vẫn là release gates.
- Không merge, không deploy, không thay đổi Worker/D1/DNS/secrets hoặc dữ liệu production.
