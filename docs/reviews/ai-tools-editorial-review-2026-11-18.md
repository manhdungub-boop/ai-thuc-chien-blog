# Thẩm định biên tập sơ bộ — 4 ứng viên AI Bank (18/11/2026)

Phạm vi: kiểm tra nguồn chính thức và thông tin App Store cho các ứng viên phù hợp iPhone/offline. Đây là ghi chú nghiên cứu, không phải phê duyệt xuất bản.

## Kết luận nhanh

| Công cụ | Miễn phí thực tế | Quyền riêng tư / giấy phép | Đánh giá sơ bộ |
|---|---|---|---|
| PocketPal AI | Chat và model local miễn phí; có mua thêm tùy chọn cho hands-free voice | MIT; xử lý local, tính năng online như web search/remote server chỉ gửi dữ liệu khi người dùng bật | Ứng viên tốt nhất để thử AI chat offline; cần chọn model nhỏ và kiểm tra hiệu năng trên từng iPhone |
| Draw Things | Tạo ảnh local miễn phí, không giới hạn token theo mô tả nhà phát triển; có mua trong ứng dụng và cloud compute tùy chọn | Nhà phát triển mô tả prompt/ảnh ở trên thiết bị khi tạo local; chưa kết luận giấy phép của toàn bộ app/model chỉ từ trang App Store | Ứng viên tốt cho tạo hình minh họa bài viết; chỉ dùng local, không bật cloud compute/mua boost |
| Noema | Ứng dụng App Store miễn phí; chat/RAG local sau khi tải model | Chính sách mô tả dữ liệu local; web search, remote endpoint, MCP, iCloud/Constellation có luồng dữ liệu riêng. Không bật các tính năng online khi thử | Có tiềm năng nghiên cứu tài liệu offline, nhưng giao diện nhiều chức năng hơn mức cần thiết; cần xác minh model và hiệu năng |
| Loci | Local chat miễn phí, không tài khoản/subscription theo nhà phát triển | Local chat ở thiết bị; diagnostics tùy chọn. App Store Việt Nam vẫn liệt kê dữ liệu định danh/vị trí gần đúng/usage/diagnostics có thể liên kết người dùng; khai báo App Store do nhà phát triển cung cấp và chưa được Apple xác minh | Dễ dùng, nhưng cần tắt diagnostic sharing và ad measurement trước khi thử; không bật web search |

## Chi tiết nguồn và giới hạn

### PocketPal AI
- Trang chính thức mô tả ứng dụng chạy model GGUF ngay trên điện thoại, offline, không cần tài khoản; chat, model, voice và tools miễn phí, mã nguồn MIT.
- Các tính năng web search/page reading hoặc remote server có thể gửi phần ngữ cảnh cần thiết tới dịch vụ tương ứng; không bật các tính năng này khi thử với dữ liệu riêng tư.
- App Store Việt Nam niêm yết miễn phí; có thể có mua trong ứng dụng. Mua thêm là tùy chọn, không cần cho chat local cơ bản.
- Nguồn: https://github.com/a-ghorbani/pocketpal-ai ; https://github.com/a-ghorbani/pocketpal-ai/blob/main/LICENSE ; https://apps.apple.com/vn/app/pocketpal-ai/id6502579498

### Draw Things
- App Store Việt Nam niêm yết Free, đồng thời hiển thị các khoản mua trong ứng dụng.
- Nhà phát triển mô tả tạo ảnh local/offline, không cần subscription và không có token limit cho local creation; cloud compute là tùy chọn riêng.
- Không đưa vào quy trình nếu cần cloud compute, boost trả phí hoặc model có điều khoản chưa kiểm tra. Chưa xác minh giấy phép đồng nhất của các model cộng đồng.
- Nguồn: https://apps.apple.com/vn/app/draw-things-offline-ai-art/id6444050820 ; https://drawthings.ai/policy/

### Noema
- App Store Việt Nam niêm yết ứng dụng miễn phí, yêu cầu iOS 18 trở lên.
- Chính sách chính thức nói hội thoại, tài liệu, model và index local có thể nằm trên thiết bị; local inference/RAG không cần gửi prompt/tài liệu tới Noema.
- Web Search, remote endpoint, remote Autopilot, MCP, Constellation/iCloud và dịch vụ speech bên ngoài có thể truyền dữ liệu tới các dịch vụ tương ứng. Off-grid Mode chỉ chặn HTTP/HTTPS từ network stack của Noema, không phải sandbox toàn hệ thống.
- Nguồn: https://apps.apple.com/vn/app/noema-local-ai-offline-llm/id6751169935 ; https://noemaai.com/privacy ; https://noemaai.com/docs/privacy-and-network-activity

### Loci
- App Store Việt Nam niêm yết Free, yêu cầu iOS 18 trở lên; mô tả hỗ trợ local chat offline và không cần tài khoản.
- Trang chính thức nói diagnostic sharing là tùy chọn và có thể tắt trong Settings. Tuy nhiên App Store vẫn liệt kê các nhóm dữ liệu có thể liên kết người dùng (vị trí gần đúng, định danh, tương tác, diagnostics); khai báo này do nhà phát triển cung cấp và chưa được Apple xác minh.
- Nguồn: https://apps.apple.com/vn/app/loci-private-unlimited-ai/id6762100748 ; https://askloci.ai/ ; https://askloci.ai/privacy/

## Quyết định biên tập

1. Giữ cả 4 bản ghi ở trạng thái `needs_review`; không tự động đưa vào danh mục AI Bank công khai.
2. Ưu tiên PocketPal AI cho thử nghiệm chat local; Draw Things cho tạo ảnh local.
3. Noema và Loci chỉ thử nghiệm sau khi kiểm tra cài đặt quyền riêng tư; không bật web search, remote endpoints, MCP, iCloud sync hoặc cloud compute.
4. Chưa kết nối bất kỳ ứng dụng nào vào tài khoản dự án; chưa cài đặt, cấp quyền, nhập API key hay gửi dữ liệu.
5. Chưa benchmark tốc độ, nhiệt độ, pin, RAM, dung lượng model hoặc chất lượng tiếng Việt trên thiết bị thực. Không được khẳng định hiệu năng iPhone cho tới khi có kiểm thử.
6. Trước khi xuất bản từng công cụ, cần xác minh riêng giấy phép model weights, ngày cập nhật, vùng App Store, quyền riêng tư và điều khoản của tính năng được mô tả.

## Cập nhật đối chiếu App Store và quyền riêng tư — 19/11/2026

Phạm vi cập nhật: chỉ làm mới bằng chứng storefront/điều khoản/quyền riêng tư cho bốn ứng viên iOS ở trên. Đây không phải kiểm thử ứng dụng trên thiết bị, không phải xác minh license của mọi model, và không phải quyết định đưa vào catalog công khai.

### PocketPal AI
- App Store Việt Nam hiện hiển thị Free + In-App Purchases, v1.23.0, 140.3 MB, iOS 15.1+, English, tuổi 18+. App Privacy ghi “Data Not Collected” theo khai báo nhà phát triển; Apple lưu ý khai báo chưa được xác minh.
- Storefront liệt kê nhiều mức PocketPal Plus (119.000đ, 299.000đ, 699.000đ, 1.299.000đ) và các gói Pals. Không có thông tin đủ rõ để gán chu kỳ/feature mapping cho từng mức; bỏ khẳng định “699.000đ mua một lần”.
- Terms (17/04/2026) mô tả app miễn phí, MIT và chạy model trên thiết bị. Privacy Policy (18/04/2026) nêu benchmark/feedback/error reports là tùy chọn; dữ liệu người dùng chủ động gửi có thể được xử lý qua Firebase Functions (Google, Hoa Kỳ). Các tính năng web search/page reading/remote server là đường dữ liệu riêng, không coi là offline.
- Giữ needs_review: license model/voice khác nhau; chưa kiểm thử hiệu năng, tiếng Việt, TTS hoặc xuất WAV/MP3 trên thiết bị thực.

Nguồn: https://apps.apple.com/vn/app/pocketpal-ai/id6502579498 ; https://pocketpal.dev/terms ; https://pocketpal.dev/privacy-policy ; https://github.com/a-ghorbani/pocketpal-ai/blob/main/LICENSE

### Draw Things
- App Store Việt Nam hiển thị Free + In-App Purchases, 342.3 MB, iOS 15.4+, tuổi 18+, ngôn ngữ có Vietnamese. Version history hiển thị 26.1020.0 ngày 22/10.
- Free Edition tạo ảnh bằng local compute và tải model; nhà phát triển nói local creation không cần internet/subscription và không có token limit. App Store liệt kê Draw Things+ 399.000đ cùng Boost Bundle 29.000đ/149.000đ/599.000đ; không xác định chu kỳ/điều kiện từ trang listing, không mua.
- Privacy Policy: Cloud Compute cần Apple Sign-in; LoRA tải lên được giữ đến khi người dùng xóa hoặc xóa tài khoản; thông tin subscription/transaction được giữ theo nhu cầu vận hành/tài chính. App Privacy khai báo purchase history, user content và user ID không liên kết người dùng, chưa được Apple xác minh.
- Giữ needs_review: ứng dụng proprietary; model/LoRA có license riêng; chưa benchmark tài nguyên và độ ổn định trên iPhone.

Nguồn: https://apps.apple.com/vn/app/draw-things-offline-ai-art/id6444050820 ; https://drawthings.ai/pricing/ ; https://drawthings.ai/policy/ ; https://github.com/drawthingsai/community-models

### Noema
- Kết quả App Store Việt Nam có snapshot Free, iOS 18+, version 4.0.1/370.2 MB; storefront Hoa Kỳ hiện hiển thị 4.2/409.4 MB. Không suy rộng version/dung lượng giữa storefront. App Privacy hiển thị Data Not Collected theo khai báo nhà phát triển, chưa được Apple xác minh.
- Privacy Policy cập nhật 02/11/2026: chat, tài liệu, model và index local ở trên thiết bị; trước khi gửi dữ liệu tới third-party AI, web search hoặc remote transcription, app hỏi quyền riêng cho recipient. Noema không chạy analytics/advertising trackers trong app; retention sau khi gửi phụ thuộc provider nhận dữ liệu.
- Giữ needs_review: local personal use miễn phí, nhưng Teams/provider ngoài có thể tính phí; app community edition Apache-2.0 không bao phủ model weights; chưa kiểm thử hiệu năng và model license trên thiết bị.

Nguồn: https://apps.apple.com/vn/app/noema-local-ai-offline-llm/id6751169935?platform=ipad ; https://apps.apple.com/us/app/noema-local-ai-offline-llm/id6751169935 ; https://noema.pages.dev/privacy ; https://noemaai.com/docs/privacy-and-network-activity ; https://github.com/noemaai-labs/noema

### Loci
- App Store Việt Nam hiện hiển thị Free, version 1.3.42 (10/11), 86.2 MB, iOS 18+, English/German/Spanish. App Privacy liệt kê coarse location, device ID, product interaction, user ID và diagnostics có thể liên kết người dùng; đây là khai báo nhà phát triển, chưa được Apple xác minh.
- Privacy Policy cập nhật 05/11/2026: hội thoại, file, ảnh và memories ở trên thiết bị; diagnostic sharing bật mặc định trong phần lớn phiên bản. Khi bật, dữ liệu app/device/model/feature, số lượng/độ dài tin nhắn và lỗi có thể được gửi; policy nói không gửi prompt, response, file, ảnh, voice, memories hoặc vị trí chính xác. Diagnostics giữ 12 tháng, ad measurement khoảng 90 ngày; thông tin nhận được lưu tại Hoa Kỳ.
- Giữ needs_review: cần tắt diagnostic sharing và ad measurement trước khi thử; không bật web search/connected assistants; chưa có license mã nguồn app và chưa benchmark thiết bị.

Nguồn: https://apps.apple.com/vn/app/loci-private-unlimited-ai/id6762100748 ; https://askloci.ai/privacy/ ; https://askloci.ai/

### Quyết định sau cập nhật
1. Cả bốn ứng viên vẫn verification_status=needs_review; không thay đổi data/ai-tools.json công khai.
2. Chỉ cập nhật ngày kiểm tra nguồn cho bốn hồ sơ này; không tuyên bố đã cài, benchmark hoặc xác nhận hiệu năng.
3. Không cài app, tải model, cấp quyền, gửi dữ liệu dự án, bật Cloud Compute, web search, remote provider, MCP, iCloud sync hoặc mua In-App Purchase.
4. Cần rà license từng model/voice, kiểm tra cài đặt quyền riêng tư trên thiết bị thật và benchmark có sự cho phép trước khi cân nhắc promotion.

