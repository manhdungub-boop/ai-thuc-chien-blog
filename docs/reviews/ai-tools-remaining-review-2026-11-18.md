# Thẩm định biên tập — 9 ứng viên AI Bank còn lại (18/11/2026)

Phạm vi: đối chiếu hồ sơ ứng viên trong PR #186 với tài liệu nhà cung cấp và trang App Store chính thức. Báo cáo này là đánh giá phù hợp với quy trình 0 đồng, iPhone-first và bảo mật của dự án; không phải phê duyệt tích hợp hay phát hành công khai.

## Kết luận điều hành

| Ứng viên | Kết quả | Lý do / hành động |
|---|---|---|
| GroqCloud | Giữ tham khảo, chưa kết nối | Free tier có giới hạn theo tổ chức/model; API là dịch vụ thương mại, có pay-as-you-go. Chưa xác nhận quota đủ ổn định và điều kiện dữ liệu phù hợp cho workflow; không bật billing. |
| Mistral Studio | Loại khỏi backend 0 đồng | Tài liệu chính thức nói Free mode chỉ có ngân sách Vibe/Studio, không có API; tạo API key và gọi API cần bật billing/pay-as-you-go. |
| ExLlamaV3 | Loại khỏi lộ trình iPhone | Mã nguồn MIT, nhưng thư viện inference cần CUDA 12.4+ và PyTorch; hướng tới GPU máy tính, không phải app iPhone. |
| Gemini 4 Carbon | Chỉ tham khảo, không tích hợp | Model có thật theo model card Google; quyền truy cập phụ thuộc kênh/gói và Gemini API pricing không có Free Tier cho hàng giá tương ứng. Không bật billing. |
| Claude Fable 5.2 | Loại khỏi workflow 0 đồng | Anthropic công bố API $8/MTok input và $40/MTok output; ứng dụng Claude yêu cầu gói đủ điều kiện. |
| VieNeu-TTS v3 Turbo | Giữ nghiên cứu, không triển khai iPhone | Apache-2.0, chạy local CPU/GPU qua Python/ONNX; không có native iOS app/SDK được xác nhận. Có v3 Nano preview cho edge/ARM nhưng không phải bản iOS đã kiểm chứng. |
| Kitesurf | Ứng viên thử nghiệm sau, chưa kết nối | Cloudflare xác nhận beta miễn phí theo giới hạn từng tài khoản; stateless browser-agent, không hỗ trợ phiên đăng nhập dài/persistent. Chỉ thử trang công khai và dữ liệu giả lập. |
| OpenRead | Giữ ưu tiên cho nghe/kiểm tra giọng Việt | App Store VN xác nhận miễn phí, 14 giọng tiếng Việt chạy trên iPhone, offline sau khi tải voice pack, không tài khoản/analytics theo mô tả nhà phát triển. Chỉ là trình đọc phát âm thanh trong app; chưa có bằng chứng xuất WAV/MP3. |
| Open Minis | Không kết nối | App tải miễn phí không đồng nghĩa inference miễn phí; cần BYO API key/tài khoản nhà cung cấp. Browser/shell/MCP và quyền thiết bị tạo bề mặt rủi ro lớn; không cấp quyền hoặc gửi dữ liệu dự án. |

## Đánh giá theo từng ứng viên

### 1. GroqCloud
- Giữ ở trạng thái `needs_review`.
- Chỉ cân nhắc API nếu có quota Free hiển thị rõ trong tài khoản, không yêu cầu phương thức thanh toán, và có thể giới hạn ngân sách ở mức không phát sinh. Không kích hoạt Developer/pay-as-you-go.
- Chưa đủ bằng chứng trong lần rà soát này để xác nhận quota Free ổn định cho tác vụ tự động lâu dài hoặc retention phù hợp với dữ liệu dự án.
- Nguồn chính thức cần đối chiếu trước khi kết nối: https://console.groq.com/docs/rate-limits ; https://console.groq.com/docs/billing-faqs ; https://console.groq.com/docs/your-data ; https://groq.com/privacy-policy

### 2. Mistral Studio
- Không dùng làm backend tự động 0 đồng.
- Tài liệu Usage and limits xác nhận Free mode có ngân sách tháng cho Vibe và Studio nhưng không bao gồm API access; tạo API key và sử dụng API yêu cầu kích hoạt billing và pay-as-you-go.
- Không bật billing, không thêm thẻ, không mua credits.
- Nguồn: https://docs.mistral.ai/admin/billing-usage/usage-limits ; https://docs.mistral.ai/admin/billing-usage/subscriptions

### 3. ExLlamaV3
- MIT cho mã nguồn thư viện; giấy phép model weights tải từ bên thứ ba phải kiểm tra riêng.
- README yêu cầu PyTorch phù hợp và CUDA 12.4 trở lên; wheel được phát hành cho môi trường Linux x86_64, còn build từ source cần CUDA/toolchain tương thích.
- Không phù hợp iPhone-only; không dành thời gian tích hợp vào workflow hiện tại.
- Nguồn: https://github.com/turboderp-org/exllamav3 ; https://github.com/turboderp-org/exllamav3/blob/master/README.md

### 4. Gemini 4 Carbon
- Model card chính thức của Google DeepMind xác nhận model được công bố tháng 11/2026; phân phối qua Gemini App, Gemini API, Google AI Studio và các kênh khác, với quyền truy cập thay đổi theo kênh/gói.
- Bảng giá Gemini API hiện hiển thị Free Tier là “Not available” cho nhóm giá model/priority tương ứng; do đó không đưa vào luồng 0 đồng.
- Chỉ giữ tham khảo, không bật billing hoặc gửi dữ liệu.
- Nguồn: https://deepmind.google/models/model-cards/gemini-4-carbon/ ; https://ai.google.dev/gemini-api/docs/pricing

### 5. Claude Fable 5.2
- Anthropic công bố API giá $8/triệu input tokens và $40/triệu output tokens; Fast mode cao hơn.
- Model được công bố cho người dùng các gói Pro, Max, Ultra, Team và Enterprise trên Claude app; API dùng theo giá token.
- Không phù hợp chính sách 0 đồng; không mua gói, credits hoặc bật API.
- Nguồn: https://www.anthropic.com/claude/fable ; https://platform.claude.com/docs/en/models/fable-5-2/overview

### 6. VieNeu-TTS v3 Turbo
- Repository chính thức xác nhận Apache-2.0; v3 Turbo là bản mã nguồn mở, v4 là bản proprietary.
- SDK chạy local qua Python/ONNX CPU hoặc PyTorch/CUDA GPU. v3 Nano được giới thiệu ở trạng thái preview cho thiết bị edge/ARM, nhưng không chứng minh có app iOS native.
- Có giá trị nghiên cứu TTS tiếng Việt trên máy tính/server miễn phí có sẵn; không thể coi là giải pháp voice-over trực tiếp trên iPhone.
- Nguồn: https://github.com/pnnbao97/VieNeu-TTS ; https://github.com/pnnbao97/VieNeu-TTS/blob/main/LICENSE ; https://docs.vieneu.io/vi/docs/sdk/overview/

### 7. Kitesurf (Cloudflare)
- Tài liệu Cloudflare cập nhật 13/11/2026 mô tả Kitesurf đang beta và miễn phí với giới hạn theo từng tài khoản.
- Đây là browser-agent stateless cho tác vụ trích xuất HTML, screenshot, quick actions; chưa phù hợp phiên đăng nhập kéo dài cần trạng thái bền vững. Không thay thế toàn bộ trình duyệt hoặc tự động hóa tương tác tài khoản thật.
- Chỉ có thể thử trên website công khai, dữ liệu giả lập và môi trường cách ly; không triển khai self-hosted hoặc cấu hình trả phí.
- Nguồn: https://developers.cloudflare.com/browser-run/kitesurf/ ; https://developers.cloudflare.com/browser-run/limits/ ; https://github.com/cloudflare/kitesurf

### 8. OpenRead: Offline Read Aloud
- App Store Việt Nam xác nhận ứng dụng miễn phí; tip “Buy Me a Coffee” 29.000đ là tùy chọn, không mở khóa tính năng theo mô tả listing.
- Có 14 giọng tiếng Việt (7 nam, 7 nữ), nhiều vùng/kiểu đọc; phát âm thanh trên thiết bị sau khi tải voice pack và có thể dùng offline. Listing ghi không thu thập dữ liệu theo khai báo của nhà phát triển; Apple lưu ý thông tin privacy do nhà phát triển cung cấp và chưa được Apple xác minh.
- Phù hợp nghe và kiểm tra giọng tiếng Việt; không xác nhận có xuất tệp âm thanh WAV/MP3. Không mua tip/IAP. Chưa cài, chưa tải voice pack.
- Nguồn: https://apps.apple.com/vn/app/openread-offline-read-aloud/id6796673874 ; https://opr.vuba.one/credits.php

### 9. Open Minis
- Mã nguồn công khai theo GPL-3.0; ứng dụng App Store tải miễn phí không bao gồm inference miễn phí.
- Phải cấu hình nhà cung cấp model/API riêng; phí, quota, retention và điều khoản do nhà cung cấp đó quyết định.
- Tính năng browser automation, shell và MCP có thể mở rộng quyền truy cập dữ liệu/thiết bị. Không cấp quyền Calendar, Contacts, Location, Photos, HealthKit, không nhập API key và không kết nối tài khoản dự án.
- Nguồn: https://github.com/OpenMinis/OpenMinis ; https://github.com/OpenMinis/OpenMinis/blob/main/LICENSE ; https://openminis.app/privacy-policy.html ; https://apps.apple.com/vn/app/open-minis/id6759188481

## Quyết định biên tập cuối cùng cho 13 ứng viên

1. Không ứng viên nào trong 13 được tự động đưa vào danh mục AI Bank công khai chỉ dựa trên PR này.
2. Đề xuất giữ OpenRead làm ứng viên tiện ích đọc/kiểm tra giọng tiếng Việt; đây không phải công cụ xuất voice-over.
3. PocketPal AI và Noema tiếp tục ở hàng đợi nghiên cứu AI local; cần kiểm tra quyền riêng tư, model nhỏ, dung lượng và hiệu năng trên thiết bị thật trước khi cài.
4. Draw Things chỉ giữ cho nghiên cứu tạo ảnh local sau khi xác minh dung lượng và giấy phép model; không bật cloud compute.
5. Kitesurf chỉ đáng thử trên trang công khai trong Preview/sandbox; chưa có lý do cấp quyền tài khoản hoặc dùng trên Production.
6. GroqCloud chỉ cân nhắc nếu Free quota được xác nhận và có chặn phát sinh chi phí; Mistral API, Gemini 4 Carbon và Claude Fable 5.2 không phù hợp chính sách 0 đồng.
7. ExLlamaV3 và VieNeu-TTS v3 Turbo giữ làm tài liệu kỹ thuật cho máy tính/server; không phù hợp iPhone-only hiện tại.
8. Open Minis không kết nối do BYO API và bề mặt quyền truy cập rộng.
9. Mọi ứng viên tiếp tục ở `needs_review` cho đến khi có kiểm thử thực tế được cho phép. Không cài đặt, cấp quyền, nhập API key, gửi dữ liệu, mua dịch vụ, thay đổi Worker/DNS/D1/Production hoặc đăng bài công khai từ báo cáo này.

