# Bản tin và phân loại AI — 16/11/2026

Phạm vi: thông báo từ trang nhà cung cấp, trang giá và tài liệu dự án chính thức. Chỉ đưa sản phẩm đủ bằng chứng vào AI Bank; các ứng viên chưa rõ giá/quyền truy cập giữ trong hàng đợi.

## Đã xác minh và đưa vào AI Bank

### Google AI Edge Gallery — Google LLC
- **Sản phẩm:** ứng dụng thử nghiệm AI cục bộ cho Android và iPhone.
- **Giá tại Việt Nam:** miễn phí trên App Store Việt Nam; Google Play có listing chính thức miễn phí, nhưng phân phối Android có thể phụ thuộc quốc gia/tài khoản/thiết bị.
- **Giấy phép:** Apache-2.0 cho mã nguồn ứng dụng; model weights và Agent Skills có giấy phép/điều khoản riêng.
- **Quyền riêng tư:** inference của model hỗ trợ có thể chạy trên thiết bị; không đồng nghĩa app không có telemetry. Google Play khai báo không chia sẻ dữ liệu với bên thứ ba nhưng có thể thu thập app activity và app info/performance. App Store iOS liệt kê identifiers, diagnostics và other data liên kết với người dùng; coarse location, usage và crash data không liên kết. Nhãn iOS do nhà phát triển cung cấp, chưa được Apple xác minh.
- **MCP:** Google Developers Blog ngày 19/05/2026 mô tả MCP là tính năng thử nghiệm trên Android; MCP server có thể ở máy tính tại nhà hoặc cloud endpoint, nên dữ liệu gọi công cụ chịu chính sách của server.
- **Ngày kiểm tra:** 16/11/2026.
- **Quyết định:** thêm record `google-ai-edge-gallery` vào `data/ai-tools.json` (catalog nhánh PR, chưa public).

Nguồn:
- https://github.com/google-ai-edge/gallery
- https://github.com/google-ai-edge/gallery/blob/main/LICENSE
- https://play.google.com/store/apps/details?id=com.google.ai.edge.gallery
- https://apps.apple.com/vn/app/google-ai-edge-gallery/id6749645337
- https://developer.apple.com/app-store/app-privacy-details/
- https://developers.googleblog.com/en/a-smarter-google-ai-edge-gallery-mcp-integration-notifications-and-session-continuity/

## Hàng đợi nghiên cứu — chưa đưa vào catalog

### Gemini 4 Carbon — Google DeepMind
- DeepMind xác nhận model trong trang Gemini và thông báo model đã có mặt trong tháng 11/2026.
- Trang giá Gemini API ghi rõ **không có trong Free tier**; Standard input/output 2/10 USD mỗi 1 triệu token đến 30/11/2026, tăng thành 4/20 USD từ 01/12/2026; thinking tokens cũng tính phí.
- Chưa xác minh đủ giá/thuế và khả năng truy cập cụ thể theo tài khoản Việt Nam; không dùng API hoặc tạo billing.
- Trạng thái: `needs_review`; candidate nằm trong `ai-tools-candidates-2026-11-02.json`.

Nguồn:
- https://deepmind.google/models/gemini/
- https://ai.google.dev/gemini-api/docs/pricing

### Claude Fable 5.2 — Anthropic
- Anthropic công bố Fable 5.2 và Mythos 5.2 ngày 09/11/2026; thông báo mô tả Fable cho công việc kỹ thuật/agent phức tạp.
- Trang giá Claude tại Việt Nam cho biết Free không có Fable; Pro dùng usage credits, Max có giới hạn Fable theo tuần. Trang công khai không cho biết đơn giá credits riêng cho Fable.
- Chưa đủ dữ liệu để tính chi phí thực tế và xác minh điều kiện API/quyền riêng tư theo trường hợp sử dụng.
- Trạng thái: `needs_review`; candidate nằm trong `ai-tools-candidates-2026-11-02.json`.

Nguồn:
- https://www.anthropic.com/claude-fable-and-mythos-5-2
- https://claude.com/pricing?country=VN

### Claude Mythos 5.2 — Anthropic
- Trang thông báo chính thức nói quyền truy cập model cho cybersecurity qua Cyber Verification Program; Claude Enterprise có thể dùng Claude Security có tích hợp Mythos 5.2.
- Không phải công cụ phổ thông có thể tự do đăng ký; chưa có đủ thông tin công khai về giá/quota/API cho người dùng cá nhân tại Việt Nam.
- **Quyết định:** giữ ngoài AI Bank và không tạo candidate trùng domain với Claude Fable; chỉ theo dõi cho tới khi điều kiện truy cập được công bố rõ.

Nguồn:
- https://www.anthropic.com/claude-fable-and-mythos-5-2
- https://claude.com/pricing?country=VN

### Gemini 4 Hydrogen — Google
- **Đã xác minh và đưa vào AI Bank** với record `gemini-4-hydrogen`.
- Google công bố model ngày 12/11/2026; model stable `gemini-4-hydrogen`, context window 1.048.576 token, hỗ trợ text/image/video/audio/PDF input và text output.
- **Miễn phí:** Gemini API/Google AI Studio Free tier niêm yết input/output miễn phí; quota RPM/TPM/RPD phụ thuộc project/tier/tài khoản và phải xem trong AI Studio, không có con số chung được bảo đảm. Người dùng Gemini app Free được truy cập qua auto model selection khi phù hợp.
- **Việt Nam:** Google AI Studio/Gemini API có Việt Nam trong danh sách vùng hỗ trợ.
- **Giá trả phí tham khảo:** Standard $1.50/1 triệu input tokens và $7.50/1 triệu output tokens. Không bật billing hoặc dùng paid tier.
- **Quyền riêng tư:** nội dung gửi qua Free/unpaid API có thể được dùng để cải thiện sản phẩm; nhân viên đánh giá có thể đọc/ghi chú. Không gửi dữ liệu nhạy cảm, bí mật hoặc dữ liệu cá nhân.
- **Giấy phép:** model proprietary, không phân phối open weights; chịu Google APIs Terms và Gemini API Additional Terms.

Nguồn:
- https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-hydrogen/
- https://ai.google.dev/gemini-api/docs/models/gemini-4-hydrogen
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/rate-limits
- https://ai.google.dev/gemini-api/docs/terms
- https://ai.google.dev/gemini-api/docs/available-regions
- https://support.google.com/gemini/answer/16275805?hl=en

## Cập nhật sản phẩm, không tạo mục AI Bank trùng lặp

### OpenAI Images 2.6
- OpenAI công bố ngày 04/11/2026: Images 2.6 nhanh hơn khoảng 50%, hỗ trợ GIF và ảnh tham chiếu; API có hai model GPT-Image-2.6 Flare và Sunburst cùng điều khiển chỉnh sửa mới.
- Đây là bản cập nhật năng lực trong hệ sinh thái ChatGPT/Codex/API, không phải bằng chứng về một sản phẩm độc lập cần thêm thành dòng catalog mới.
- Cần kiểm tra giới hạn từng gói và bảng giá API trước khi hướng dẫn người dùng; không gọi API trả phí.

Nguồn:
- https://openai.com/index/introducing-images-2-6/

## Loại khỏi danh sách ứng viên chính thức

### Salesforce SOV-Transcribe-1
- Hugging Face Blog hiện đặt nội dung này trong khu vực **Community Articles**, không phải mục Team/Enterprise.
- Chưa có xác nhận trực tiếp từ nguồn Salesforce chính thức trong đợt kiểm tra này về giá, license, model card và quyền riêng tư.
- **Quyết định:** không đưa vào catalog; chỉ xem xét lại khi có nguồn chính thức từ nhà cung cấp.

Nguồn:
- https://huggingface.co/blog

## Nguyên tắc phát hành
- Chỉ mục có sản phẩm/nhà cung cấp/domain, giá và điều kiện miễn phí, license, nền tảng, quyền riêng tư và ngày kiểm tra rõ ràng mới được đưa vào catalog.
- Mục chưa rõ ở bất kỳ trường trọng yếu nào phải ở hàng đợi hoặc watchlist.
- Không mua credit, không nâng cấp, không bật trial/billing, không dùng API trả phí.
- PR hiện là Draft; không merge, không triển khai Production và không đăng mạng xã hội từ bản nháp.


## Tình trạng catalog sau hợp nhất — 17/11/2026
- Google AI Edge Gallery và Gemini 4 Hydrogen hiện đã có trong catalog `main` qua PR #157.
- PR bài viết riêng không còn mang thay đổi `data/ai-tools.json` hoặc hàng đợi ứng viên; các ứng viên chưa chắc chắn tiếp tục được quản lý ở PR #158.
