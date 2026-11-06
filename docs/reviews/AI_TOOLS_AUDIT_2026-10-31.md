# Rà soát kỹ thuật danh mục AI — 31/10/2026

## Phạm vi
- Nhánh: `staging/auth-worker-build`
- Catalog chính: `site-snapshot/data/ai-tools.json`
- Hàng chờ: `site-snapshot/data/review/ai-tools-candidates-2026-10-31.json`
- Đối chiếu ID, tên + nhà cung cấp và domain website chính thức.

## Kết quả đối chiếu tại ngày 31/10/2026
| Chỉ số | Kết quả |
|---|---:|
| Bản ghi catalog chính | 12 |
| Ứng viên đang chờ duyệt | 7 |
| Trùng ID với catalog chính | 0 |
| Trùng tên + nhà cung cấp | 0 |
| Trùng domain chính xác | 0 |
| Bản ghi quá 30 ngày theo last_verified | 0 |
| Bản ghi cần rà soát giá/xác minh | 12 |
| Bản ghi thiếu official_sources | 0 |

Domain trùng được xem là cảnh báo cần biên tập, không tự động kết luận trùng sản phẩm vì một nhà cung cấp có thể có nhiều sản phẩm trên cùng domain.

## Kiểm tra nguồn và giới hạn
- Tất cả 12 bản ghi catalog chính vẫn là `needs_review`; không có cơ sở để công bố giá/hạn mức như đã xác minh.
- 7 ứng viên mới vẫn là `needs_review`.
- Chưa chạy HTTP link checker; do đó không có kết luận link nào đang sống hay bị hỏng.
- Không thực hiện scrape, không truy cập nội dung sau đăng nhập và không gọi API giá của bên thứ ba.

## Công cụ kiểm toán được bổ sung
`scripts/audit-ai-tools-catalog.mjs` tạo báo cáo JSON cho:
- Bản ghi quá 30 ngày hoặc ngày kiểm tra không hợp lệ.
- Trùng ID, tên + nhà cung cấp, domain giữa candidate queue và catalog chính.
- Bản ghi thiếu nguồn chính thức.
- Candidate bị đánh dấu khác `needs_review`.

Chạy cục bộ bằng Node.js:
```bash
node scripts/audit-ai-tools-catalog.mjs
```
Có thể chỉ định mốc thời gian tái lập kết quả:
```bash
node scripts/audit-ai-tools-catalog.mjs site-snapshot/data/ai-tools.json site-snapshot/data/review/ai-tools-candidates-2026-10-31.json --as-of=2026-10-31
```

## Việc cần làm tiếp
1. Chạy script trên máy/môi trường Node.js và lưu output kiểm toán.
2. Thực hiện HTTP checks có giới hạn tốc độ đối với website và official_sources.
3. Xác minh thủ công pricing, giới hạn khu vực, giấy phép và trạng thái hoạt động trước khi đổi bất kỳ bản ghi nào sang `verified`.
4. Khi GitLab CI quota được khôi phục, chạy validator và UI contract tests; không kích hoạt pipeline lúc quota chưa rõ.

## An toàn
Chỉ thêm script và báo cáo trên staging. Không sửa catalog chính, không merge, không deploy, không thay đổi D1/production và không phát sinh chi phí.
