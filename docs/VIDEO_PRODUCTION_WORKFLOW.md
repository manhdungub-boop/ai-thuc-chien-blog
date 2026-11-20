# Quy trình sản xuất video AI Thực Chiến — iPhone-first, 0 đồng

- **Trạng thái:** bản quy trình nội bộ đề xuất; chưa phải lịch đăng hoặc cam kết tự động xuất bản.
- **Chủ biên:** DUNG - AI
- **Ngày ghi nhận cấu hình giọng:** 17/11/2026
- **Phạm vi:** video hướng dẫn tiếng Việt; thao tác biên tập hiện thực hiện trên iPhone.
- **Nguyên tắc:** không dùng API TTS trả phí, không nâng cấp gói, không nhập dữ liệu nhạy cảm vào dịch vụ không rõ cách xử lý; không tự đăng công khai khi chưa qua cổng duyệt.

## 1. Cấu hình giọng đọc đã được người dùng xác nhận

| Thành phần | Cấu hình |
|---|---|
| Ứng dụng tạo giọng | PocketPal AI |
| Engine | Supertonic |
| Giọng | Alex — Male 1 |
| Ngôn ngữ | Vietnamese |
| Quality / inference steps | 5 |
| Đánh giá nghe thực tế | Người dùng xác nhận mức 5 nghe rất tự nhiên |

Đây là kết quả nghe do người dùng báo cáo, không phải phép đo âm học độc lập. Không tự đổi giọng hoặc Quality nếu chưa có vấn đề thực tế. Giữ cấu hình này làm baseline cho các video thử nghiệm.

## 2. Luồng sản xuất chuẩn

### Bước A — Chốt đề tài và kịch bản

1. Chọn một vấn đề cụ thể mà độc giả có thể giải quyết sau khi xem.
2. Kiểm chứng thông tin bằng tài liệu chính thức, ghi nguồn cạnh nhận định.
3. Viết theo cấu trúc: mở vấn đề → lợi ích → từng bước thao tác → ví dụ → giới hạn/rủi ro → kết luận.
4. Viết câu ngắn, một ý chính mỗi câu; giải thích thuật ngữ trước khi dùng chữ viết tắt.
5. Đọc rà lại trên màn hình điện thoại; đánh dấu tên riêng, số, đơn vị và từ tiếng Anh cần kiểm tra phát âm.
6. Chỉ chuyển sang TTS khi nội dung và nguồn đã được kiểm chứng.

### Bước B — Tạo lời đọc bằng PocketPal

1. Chọn Supertonic → Alex / Male 1 → Vietnamese → Quality 5.
2. Tạo bản thử 15–30 giây đầu tiên để phát hiện lỗi phát âm trước khi tạo toàn bài.
3. Chia kịch bản theo **cụm ý/đoạn**, thường khoảng 1–3 câu mỗi đoạn; không cắt máy móc sau từng câu.
4. Giữ nguyên cấu hình giữa các đoạn. Nếu có thể xuất/lưu âm thanh, đặt tên tuần tự: `01-mo-dau`, `02-van-de`, `03-cac-buoc`, `04-vi-du`, `05-ket-luan`.
5. Nghe lại từng đoạn và toàn bộ khi ghép: kiểm tra mất chữ, lặp âm, ngắt giữa cụm từ, khoảng nghỉ bất thường, tên riêng và số liệu.
6. Nếu một đoạn có lỗi, chỉ tạo lại đoạn đó sau khi sửa văn bản; không làm lại toàn bộ nếu các đoạn khác đã đạt.
7. Lưu bản âm thanh cuối vào ứng dụng Files trên iPhone. Không giả định có tích hợp xuất file tự động giữa PocketPal và CapCut; dùng chức năng chia sẻ/lưu tệp thực tế mà ứng dụng cung cấp.

### Bước C — Tạo phụ đề

1. Lấy chính kịch bản đã duyệt làm nguồn chuẩn; không để nhận dạng giọng nói tự động tự ý thay đổi thuật ngữ hoặc số liệu.
2. Chia phụ đề theo cụm nghĩa, ưu tiên 1–2 dòng ngắn, tránh che nút bấm hoặc nội dung quan trọng.
3. Có thể chuẩn bị tệp SRT cùng video để lưu trữ và tái sử dụng. Chỉ nhập SRT trực tiếp nếu phiên bản CapCut trên iPhone đang dùng hỗ trợ chức năng đó; nếu không, tạo lớp phụ đề bằng công cụ văn bản có sẵn.
4. Soát từng dòng theo âm thanh thực tế; sửa dấu câu, tên riêng, số và thời điểm xuất hiện.
5. Không phát hành nếu phụ đề khác lời đọc ở thông tin có ý nghĩa.

### Bước D — Ghép hình và dựng video trên iPhone

1. Dùng CapCut Mobile như công cụ dựng tùy chọn; chỉ dùng tính năng miễn phí đang có trên tài khoản. Bỏ qua mọi hiệu ứng, mẫu, nhạc, phông chữ hoặc chức năng có nhãn Pro/trả phí.
2. Đặt tỷ lệ khung hình theo kênh: 16:9 cho video ngang; 9:16 cho video dọc. Không kéo giãn hình làm méo nội dung.
3. Ưu tiên hình tự tạo: quay màn hình thao tác trên dữ liệu giả lập, sơ đồ do AI Thực Chiến tự thiết kế, hình minh họa tự tạo. Che email, số điện thoại, token, thông tin tài khoản và dữ liệu riêng.
4. Chỉ dùng ảnh/video bên ngoài khi giấy phép cho phép đúng mục đích sử dụng; lưu URL nguồn, tác giả, giấy phép và ngày truy cập. Không lấy ảnh từ kết quả tìm kiếm rồi mặc định là được phép dùng.
5. Đặt giọng đọc làm âm thanh chính. Giai đoạn đầu không cần nhạc nền; nếu dùng nhạc, phải kiểm tra giấy phép và quyền sử dụng trên nền tảng đích.
6. Đồng bộ cảnh quay với ý đang nói; tránh hiệu ứng chuyển cảnh dày đặc hoặc chữ quá nhỏ.
7. Xuất bản nháp ở 1080p nếu thiết bị và dung lượng cho phép; kiểm tra lại tệp xuất trước khi lưu bản cuối.

### Bước E — Kiểm tra chất lượng trước phát hành

- [ ] Nghe toàn bộ video bằng loa iPhone và tai nghe; không chỉ nghe vài giây đầu.
- [ ] Không có từ bị cắt, đọc sai, lặp, tiếng rè hoặc khoảng lặng bất thường.
- [ ] Giọng Alex / Male 1, Vietnamese, Quality 5 nhất quán giữa các đoạn.
- [ ] Phụ đề khớp chính xác với lời đọc và xuất hiện đủ lâu để đọc.
- [ ] Hình ảnh đúng nội dung, không lộ dữ liệu cá nhân hoặc bí mật.
- [ ] Mọi hình, video, nhạc và font bên ngoài có quyền sử dụng phù hợp; có ghi nhận nguồn.
- [ ] Không có tuyên bố chưa kiểm chứng, lời hứa quá mức hoặc hướng dẫn gây rủi ro.
- [ ] Tiêu đề, mô tả, ảnh bìa và lời kêu gọi hành động trung thực với nội dung video.
- [ ] Xem lại bản xuất cuối trên iPhone, không chỉ xem timeline dựng.

## 3. Quy ước tệp và lưu trữ

Mỗi video có một thư mục riêng, ví dụ `2026-11-ten-chu-de`, gồm:

- `script-approved.md` — kịch bản đã kiểm chứng.
- `voice/` — các đoạn âm thanh và bản ghép cuối.
- `subtitles.srt` — phụ đề chuẩn, nếu có.
- `storyboard.md` — mô tả cảnh và nguồn hình.
- `sources.md` — nguồn nội dung, giấy phép hình/nhạc/font.
- `final-video.mp4` — bản xuất cuối.
- `qa-checklist.md` — kết quả kiểm tra và người duyệt.

Không đưa token, mật khẩu, thông tin OAuth, dữ liệu cá nhân hoặc file riêng tư vào repository công khai.

## 4. Nguyên tắc 0 đồng và quyền riêng tư

- Không dùng API TTS tính phí theo ký tự/phút; không kích hoạt billing hoặc gói dùng thử có thể tự gia hạn.
- Không mua gói CapCut Pro hoặc công cụ dựng trả phí. Nếu một tính năng bị khóa, chuyển sang phương án miễn phí khác hoặc bỏ tính năng đó.
- Ưu tiên tạo giọng trên thiết bị và dùng dữ liệu thử giả lập. Chỉ tải tệp lên dịch vụ đám mây khi đã hiểu quyền riêng tư và thực sự cần thiết.
- Không dùng voice cloning của người khác nếu không có sự cho phép rõ ràng; không giả giọng người thật để gây hiểu nhầm.
- Không đăng nhập dịch vụ mới hoặc cấp quyền tài khoản mạng xã hội chỉ để thử nghiệm.
- Không tự động đăng video, lên lịch, gửi tin nhắn hoặc thay đổi tài khoản mạng xã hội trong quy trình này.

## 5. Cổng phát hành

Một video chỉ được chuyển sang bước phát hành khi đồng thời đạt:

1. Nội dung đã kiểm chứng nguồn và quyền sử dụng.
2. Giọng đọc và phụ đề đã được nghe/đọc kiểm tra toàn bộ.
3. Bản video xuất cuối đạt checklist ở mục 2E.
4. Đích đăng, mô tả và lịch đăng được xác định rõ.
5. Người quản trị duyệt bản cuối.

CI xanh hoặc file đã tạo thành công không thay thế việc nghe và duyệt video. Tài liệu này không cho phép merge PR, triển khai Production, đăng công khai hay thay đổi Worker/DNS/D1.

## 6. Những điểm còn cần kiểm chứng thực tế

- Xác nhận đường xuất âm thanh từ phiên bản PocketPal hiện tại sang Files trên iPhone và định dạng tệp thực tế.
- Xác nhận khả năng nhập SRT trên phiên bản CapCut Mobile và tài khoản hiện tại; nếu không có, dùng phụ đề văn bản trong ứng dụng.
- Thử một video pilot ngắn 30–60 giây trước khi mở rộng quy trình.
- Ghi nhận thời gian dựng, dung lượng tệp và lỗi phát sinh trên chính iPhone; không suy diễn hiệu năng từ thiết bị khác.

**Trạng thái cuối:** quy trình được đề xuất và ghi nhận nội bộ; chưa có video pilot nào được xác nhận hoàn thành hoặc phát hành công khai.
