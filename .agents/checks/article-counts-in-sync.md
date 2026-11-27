---
files:
  - "articles/*.html"
  - "index.html"
  - "thu-vien.html"
---

# Số bài viết ghi cứng phải khớp số bài thực tế

`index.html` và `thu-vien.html` ghi cứng số bài viết ở nhiều chỗ. Khi một pull request thêm, xóa hoặc chuyển bài giữa các mục, mọi con số này phải được cập nhật cùng lúc và khớp với số tệp HTML trong `articles/` cùng các liên kết bài viết có dạng `/articles/<slug>`. Lịch sử repository có nhiều commit chỉ để sửa số bị lệch (ví dụ "Fix library count to 76 published articles", "content: correct AI Thuc Chien library count to 78", "Fix deep-dive library article count", "Fix library heading count to 48 articles"). `scripts/test_seo_consistency.cjs` chỉ kiểm tra tổng "N bài thực hành" trong thư viện; các số còn lại không có test nào bắt.

## Những chỗ phải khớp

Với N là số tệp HTML trong `articles/`:

- `thu-vien.html`: tổng N trong `<title>`, `meta description`, `og:title`/`og:description`, `twitter:title`/`twitter:description`, JSON-LD `CollectionPage` (`name`, `description`), đoạn giới thiệu dưới H1 và nhãn hiển thị `section-kicker`.
- `thu-vien.html`: số trong tiêu đề từng mục (`tools-title`, `automation-title`, `creative-title`, `earning-title`, `deep-dive-title`) phải bằng số liên kết có dạng `/articles/<slug>` nằm giữa tiêu đề đó và tiêu đề kế tiếp. Đếm URL bài viết, không đếm đường dẫn tệp nguồn `articles/*.html`.
- `thu-vien.html`: câu tách nhóm "N bài gồm X bài theo lộ trình 4 chủ đề và Y bài chuyên sâu bổ sung" phải thỏa X = tổng bốn mục chủ đề, Y = số bài trong mục chuyên sâu, X + Y = N.
- `index.html`: "N bài thực hành" trong `hero-proof` và tiêu đề "Khám phá N bài thực hành." của mục `#bai-viet`, cùng mọi metadata hoặc JSON-LD có nhắc tổng số bài.

Đạt yêu cầu khi mọi con số trên bằng giá trị đếm được từ chính các tệp và URL sau khi áp dụng diff. Vi phạm khi pull request thêm hoặc xóa tệp trong `articles/`, hoặc chuyển liên kết giữa các mục, mà còn một con số cũ; hoặc khi hai chỗ trên cùng trang mâu thuẫn nhau. Nếu pull request chỉ sửa nội dung bài mà không đổi danh sách bài thì không cần kiểm tra.

Lý do: đây là metadata công khai mà Google và mạng xã hội hiển thị; số sai làm người đọc mất tin tưởng vào một blog đặt trọng tâm vào nội dung được kiểm chứng.

## Ví dụ

Sai: mục chuyên sâu liệt kê 26 liên kết `/articles/<slug>`, đoạn giới thiệu ghi 26, nhưng tiêu đề mục vẫn là số cũ:

```html
<p style="color:var(--muted)">78 bài gồm 52 bài theo lộ trình 4 chủ đề và 26 bài chuyên sâu bổ sung. …</p>
…
<h2 id="deep-dive-title">25 bài chuyên sâu bổ sung</h2>
```

Đúng: tiêu đề, đoạn giới thiệu và số URL bài viết trong mục đều là 26, còn tổng 78 khớp với `index.html`:

```html
<h2 id="deep-dive-title">26 bài chuyên sâu bổ sung</h2>
```

```html
<h2>Khám phá <em>78 bài thực hành.</em></h2>
```
