# Quy trình biên tập và xuất bản — AI Thực Chiến

## Quy trình
1. **Đề xuất:** xác định độc giả, nhu cầu và kết quả mong muốn.
2. **Nghiên cứu:** ưu tiên tài liệu chính thức và nguồn gốc; đặt liên kết cạnh nhận định liên quan.
3. **Soạn nháp:** vấn đề → từng bước thực hiện → ví dụ → giới hạn/rủi ro → checklist.
4. **Kiểm chứng:** mở nguồn, kiểm tra phiên bản công cụ; phân biệt dữ kiện, suy luận và điều chưa xác minh.
5. **Tạo pull request:** thêm bài HTML; cập nhật thẻ bài viết trên trang chủ, `sitemap.xml`, `feed.xml` và mục bài viết liên quan; hoàn thành checklist pull request.
6. **Kiểm tra tự động:** `Content Quality Gate` rà soát metadata, H1, canonical, JSON-LD, nguồn HTTPS, văn bản hiển thị và sự hiện diện trong sitemap/RSS. `Verify Website Health` tự phát hiện các tệp `articles/*.html`, kiểm tra điều hướng, xác nhận sitemap khớp tất cả canonical và RSS khớp toàn bộ bài viết; không khóa theo số lượng bài cố định.
7. **Duyệt người thật:** đọc toàn bài trên điện thoại, thử liên kết, kiểm tra quyền sử dụng hình ảnh và quyết định có merge hay không. CI xanh không có nghĩa mọi thông tin đều đúng.
8. **Xuất bản:** chỉ merge vào `main` sau khi duyệt; sau triển khai, kiểm tra URL công khai, HTTP, sitemap/RSS và các bản dự phòng.
9. **Theo dõi:** chỉ báo trạng thái lập chỉ mục và analytics khi đã nhìn thấy bằng chứng trong dashboard tương ứng.

## Tiêu chí tối thiểu
- Một title, một meta description, đúng một H1 và một canonical trên hostname chính.
- JSON-LD hợp lệ, không thêm dữ liệu cấu trúc không có bằng chứng.
- Ít nhất một liên kết HTTPS ngoài website tới nguồn có liên quan.
- Không để URL kỹ thuật bị chèn nhầm vào văn bản hiển thị.
- Bài mới phải có trong sitemap và RSS.
- Không tuyên bố đã lập chỉ mục, có traffic hoặc tăng trưởng nếu chưa xác minh.

## Giới hạn hiện tại
- Cổng kiểm tra chạy trên pull request; không tự bảo đảm có người duyệt và không tự xuất bản nội dung mạng xã hội.
- Chưa bật branch protection vì chưa xác minh được quyền quản trị; tránh thay đổi có thể khóa chủ dự án khỏi quyền cập nhật.
- Website vẫn là site tĩnh, chưa có CMS, lịch xuất bản tự động hay tích hợp mạng xã hội.
