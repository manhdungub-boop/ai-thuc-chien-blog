# BẢN THẢO BIÊN TẬP — TTS tiếng Việt: chọn giọng đọc tự nhiên bằng kiểm thử, không bằng lời quảng cáo

- **Trạng thái:** `needs_review` — bản thảo nội bộ, chưa phải bài HTML công khai.
- **Tác giả dự kiến:** DUNG - AI
- **Ngày rà soát nguồn:** 16/11/2026
- **Đối tượng:** người làm video hướng dẫn, nhà sáng tạo nội dung và nhóm muốn tạo giọng đọc tiếng Việt mà không phụ thuộc API trả phí.
- **Mục tiêu:** giúp người đọc đánh giá giọng TTS bằng mẫu thử có kiểm soát; không khẳng định mô hình nào “tự nhiên nhất” khi chưa nghe và chấm điểm đầu ra thực tế.

## Tóm tắt biên tập

Một mô hình TTS có thể hỗ trợ tạo lời thuyết minh video, nhưng nhãn “hỗ trợ tiếng Việt”, tần số lấy mẫu 48 kHz hoặc benchmark do nhà phát triển công bố không tự chứng minh giọng đọc tự nhiên. Cần nghe trực tiếp các câu tiếng Việt có dấu, tên riêng, số liệu, thuật ngữ tiếng Anh và câu dài; kiểm tra nhịp nghỉ, ngữ điệu, phát âm vùng miền, độ ổn định và lỗi âm thanh.

Hai dự án mã nguồn mở đáng đưa vào vòng thử nghiệm là VieNeu-TTS v3 Turbo và ZeroTTS. Chúng có phạm vi và điều kiện khác nhau; không nên gộp chúng thành hai sản phẩm tương đương.

## 1. Phân biệt hai lựa chọn

### VieNeu-TTS v3 Turbo

Nguồn chính chủ:
- Repository: https://github.com/pnnbao97/VieNeu-TTS
- Model card: https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo

Thông tin được công bố trong repository/model card:
- Bản v3 Turbo hướng tới TTS tiếng Việt; repository chính chủ hiện công bố 25 giọng mẫu thuộc các vùng Bắc, Trung và Nam; số lượng có thể thay đổi theo phiên bản, vì vậy phải ghi kèm ngày kiểm tra khi xuất bản.
- Có đường chạy CPU/ONNX và hỗ trợ đầu ra 48 kHz theo tài liệu dự án.
- Có chức năng voice cloning dùng âm thanh tham chiếu. Chỉ sử dụng giọng của chính mình hoặc giọng đã được chủ thể cho phép rõ ràng; không giả giọng người khác để gây hiểu nhầm.
- Model card nêu Apache-2.0 cho v3 và các thành phần được liệt kê trong phạm vi license. Cần kiểm tra lại từng tệp, voice asset và dependency trước khi phân phối hoặc dùng thương mại.
- Không suy diễn rằng v4 có cùng giấy phép với v3; model card nêu v4 là proprietary.

**Giới hạn cần nói rõ:** chưa có kết quả nghe kiểm thử độc lập trong dự án này. Khả năng chạy CPU/ONNX không đồng nghĩa đã cài được trên iPhone hoặc chạy tốt trên mọi điện thoại. Không có cơ sở để hứa rằng triển khai sẽ hoàn toàn miễn phí nếu cần máy chủ, lưu trữ hoặc phần cứng riêng. Tài liệu dịch vụ VieNeu phân biệt API đám mây tính phí theo ký tự với model mã nguồn mở tự triển khai; không dùng API cloud trong phương án 0 đồng.

**Cảnh báo riêng với demo Hugging Face ZeroGPU:** mã nguồn `app.py` của Space công khai có hàm ghi log request, bao gồm cả nội dung văn bản người dùng gửi vào (`text=%r`). Vì vậy, tuyệt đối không nhập nội dung riêng tư, dữ liệu khách hàng, thông tin đăng nhập, tài liệu nội bộ hoặc nội dung chưa công bố vào demo này. Chỉ dùng câu thử công khai/giả lập. Đây là nhận xét về mã nguồn demo cụ thể, không phải kết luận rằng mọi bản tự triển khai VieNeu đều ghi log như vậy.

### ZeroTTS

Nguồn chính chủ:
- Repository: https://github.com/zeroweight-ai/ZeroTTS
- Model card: https://huggingface.co/Pragmaticl/ZeroTTS

Thông tin được công bố trong repository/model card:
- Dự án mô tả pipeline TTS chạy ONNX, có thể suy luận trên CPU và có 8 giọng mẫu.
- Tài liệu dự án công bố dung lượng tải model khoảng 900 MB. Đây là tải trọng đáng kể đối với thiết bị di động hoặc kết nối dữ liệu hạn chế.
- Repository nêu mã nguồn và weights theo MIT; bộ giải mã MOSS codec đi kèm có giấy phép Apache-2.0. Dataset ZeroBench mang CC-BY-NC-4.0 và chỉ nên được dùng trong đúng phạm vi giấy phép.
- Các chỉ số WER, UTMOS và tốc độ CPU là số liệu do chính dự án công bố, chưa phải kết quả kiểm thử độc lập của AI Thực Chiến.

**Giới hạn quan trọng:** model card chính chủ hiện ghi rõ voice cloning không có trong bản phát hành này; voice latents có sẵn được đóng gói cùng model, không có bộ encoder công khai để tạo latent mới từ âm thanh tham chiếu. Vì vậy không được quảng cáo ZeroTTS như một giải pháp voice cloning hoàn chỉnh.

**Lựa chọn trình duyệt và quyền riêng tư:** dự án có demo JavaScript chạy hoàn toàn phía trình duyệt bằng WebAssembly/ONNX Runtime Web, không cần server, không tải văn bản/âm thanh lên máy chủ và không cần API key. Tuy nhiên, tài liệu hiện nêu tải model khoảng 820 MB với backend GGUF hoặc khoảng 903 MB với ONNX; nhà phát triển hướng tới desktop và mạng băng thông rộng. Chưa xác nhận hiệu năng, bộ nhớ hay khả năng chạy ổn định trên iPhone, nên không coi đây là giải pháp dùng được trên điện thoại trước khi thử thực tế.

## 2. Không đánh giá “tự nhiên” chỉ bằng thông số

Đề xuất dùng cùng một bộ câu thử cho mọi mô hình. Không thay nội dung giữa các lần chạy, không chỉnh tốc độ hậu kỳ trước khi chấm điểm và không chỉ chọn câu nghe hay nhất.

Bộ câu thử tối thiểu:
1. **Dấu và phụ âm:** “Chúng tôi thử nghiệm quy trình chuyển văn bản thành giọng nói tiếng Việt.”
2. **Thanh điệu và từ dễ đọc sai:** “Bảo mật, dữ liệu, xử lý, kiểm thử, quyền truy cập.”
3. **Số và đơn vị:** “Phiên bản 2.4.1 được kiểm tra lúc 08 giờ 15 phút, ngày 16 tháng 11 năm 2026.”
4. **Tên riêng và thương hiệu:** “GitHub Actions, Cloudflare Workers, Google AI Studio và VieNeu-TTS.”
5. **Câu dài có dấu câu:** một đoạn hướng dẫn 70–100 từ, có dấu phẩy, dấu hai chấm và câu hỏi.
6. **Lời kêu gọi hành động:** “Hãy thử trên dữ liệu giả lập trước khi áp dụng vào hệ thống thật.”

Nếu có nhiều giọng mẫu, tạo cùng bộ câu bằng từng giọng. Không dùng bản ghi âm của người khác làm dữ liệu tham chiếu nếu chưa có sự đồng ý.

## 3. Phiếu chấm giọng đọc cho video

Chấm từng tiêu chí từ 1 đến 5; ghi lại lỗi cụ thể thay vì chỉ ghi “nghe hay”.

| Tiêu chí | Câu hỏi kiểm tra |
|---|---|
| Phát âm tiếng Việt | Dấu thanh, phụ âm đầu/cuối và âm tiết có rõ không? |
| Ngữ điệu | Câu hỏi, câu giải thích và câu kết có lên xuống hợp lý không? |
| Nhịp và khoảng nghỉ | Có đọc dồn, ngắt giữa cụm từ hoặc nghỉ sai chỗ không? |
| Tên riêng/thuật ngữ | Tên sản phẩm, chữ viết tắt và từ tiếng Anh có dễ hiểu không? |
| Tự nhiên | Có đều đều, máy móc, nhấn sai hoặc kéo dài âm bất thường không? |
| Chất lượng âm thanh | Có rè, méo, lặp âm, hụt hơi giả hoặc âm thanh bị cắt không? |
| Tính nhất quán | Cùng một giọng có giữ chất giọng ổn định giữa các đoạn không? |

Chỉ chọn giọng khi người nghe hiểu nội dung ngay ở tốc độ bình thường và không cần đoán từ. Nếu hai người nghe bất đồng về phát âm hoặc ngữ điệu, đánh dấu để nghe lại; không tự động kết luận đạt.

## 4. Quy trình thử nghiệm miễn phí và an toàn

1. Tải model và mã nguồn từ repository/model card chính chủ; kiểm tra license của model, voice asset, codec và dependency.
2. Thử trên một máy tính hoặc môi trường CPU/ONNX phù hợp trước. Không mặc định iPhone có thể chạy chỉ vì mô hình hỗ trợ ONNX.
3. Dùng văn bản thử không chứa thông tin cá nhân, bí mật, dữ liệu khách hàng hoặc nội dung chưa công bố. Với demo hosted của VieNeu trên Hugging Face, chỉ gửi câu giả lập công khai vì mã nguồn Space đang ghi log toàn bộ text request.
4. Tạo ba mẫu ngắn: 15 giây, 30 giây và 60 giây. Lưu cấu hình và tên model để so sánh có thể lặp lại.
5. Nghe toàn bộ đầu ra bằng tai nghe và loa điện thoại; chấm phiếu ở mục 3.
6. Kiểm tra quyền sử dụng giọng, nhạc nền và hình ảnh. Không dùng voice cloning để giả danh, tạo xác nhận giả hoặc khiến người xem tin rằng một người thật đã nói điều họ chưa từng nói.
7. Chỉ ghép giọng vào video sau khi người biên tập duyệt. Kiểm tra phụ đề khớp lời đọc, âm lượng, nhịp chuyển cảnh và phần kết.
8. Ghi rõ nội dung có sử dụng giọng tổng hợp khi điều đó có thể ảnh hưởng đến cách người xem hiểu video.

## 5. Khuyến nghị có điều kiện cho AI Thực Chiến

- **Ưu tiên kiểm thử VieNeu-TTS v3 Turbo trước** vì đây là dự án tập trung vào tiếng Việt và công bố các giọng mẫu vùng miền. Đây chỉ là lựa chọn ưu tiên để thử, không phải kết luận chất lượng đã đạt.
- **Giữ ZeroTTS làm đối chứng** cho pipeline ONNX/CPU; không dùng nó làm giải pháp voice cloning cho đến khi tài liệu và bản phát hành chính thức chứng minh có tính năng tạo voice latent.
- Với quy trình hiện tại chỉ có iPhone để thao tác, chưa được hứa hẹn rằng có thể cài và chạy hai model cục bộ ngay trên điện thoại. Cần một môi trường chạy tương thích; nếu phải thuê máy chủ hoặc mua dịch vụ thì loại khỏi phương án 0 đồng.
- Không tạo video tự động phát hành chỉ từ kết quả benchmark. Mỗi video phải qua nghe thử, rà phát âm, phụ đề, bản quyền và duyệt nội dung.


## 5A. Phương án thực tế để thử ngay trên iPhone: CapCut Mobile TTS

Đối với quy trình hiện chỉ có iPhone, cần tách rõ công cụ **tạo được âm thanh trên điện thoại** với mô hình **tự chạy cục bộ và kiểm soát dữ liệu**.

CapCut có hướng dẫn chính thức cho luồng Text-to-Speech trên ứng dụng di động: tạo dự án, thêm lớp văn bản, chọn lớp, mở Text-to-Speech, chọn giọng và tạo voiceover. Trang TTS chính thức của CapCut mô tả chức năng cốt lõi là miễn phí; một số giọng cao cấp có thể thuộc Pro. Tài liệu CapCut cập nhật tháng 11/2026 nói âm thanh TTS được phép dùng cho mục đích thương mại khi tuân thủ điều khoản CapCut và quy định nền tảng. Quyền này chỉ áp dụng cho âm thanh TTS được tạo, không tự động cấp quyền thương mại cho mọi nhạc, hiệu ứng, mẫu hoặc tài nguyên khác.

Nguồn:
- Hướng dẫn CapCut Mobile TTS: https://www.capcut.com/vi-vn/help/text-to-speech-feature
- TTS miễn phí và các giới hạn giọng Pro: https://www.capcut.com/vi-vn/tools/ai-text-to-speech
- Quyền sử dụng voiceover thương mại và phân biệt tài nguyên âm thanh: https://www.capcut.com/resource/how-to-add-or-replace-voiceovers-music-and-sound-effects-in-capcut

**Điều chưa được xác minh:** chưa cài và nghe thử các giọng tiếng Việt trong CapCut trên iPhone của nhóm; chưa xác nhận giọng nào nghe tự nhiên, có đủ giọng miễn phí, hoặc chất lượng ổn định. Vì tài liệu hỗ trợ mô tả TTS cần kết nối mạng/xử lý cloud, không nhập văn bản riêng tư, thông tin khách hàng, bí mật hoặc bản thảo chưa công bố. Không bật Pro, không đăng ký thử có thanh toán và không thêm phương thức thanh toán.

### Bài thử iPhone đề xuất
1. Tạo một dự án thử riêng trong CapCut, không dùng video/bản thảo công khai.
2. Dùng 6 câu thử ở mục 2, không thêm dữ liệu cá nhân.
3. Chỉ chọn giọng có nhãn miễn phí; bỏ qua mọi giọng yêu cầu Pro hoặc tín dụng.
4. Xuất đoạn âm thanh/video thử ngắn, nghe bằng loa iPhone và tai nghe.
5. Chấm đủ 7 tiêu chí tại mục 3; ghi lại tên giọng, ngày thử và lỗi phát âm.
6. Nếu giọng không đạt tự nhiên, không phát hành; chuyển về phương án model mở cần môi trường tương thích hoặc tiếp tục tìm lựa chọn miễn phí khác.

**Kết luận có điều kiện:** CapCut Mobile là ứng viên dễ tiếp cận nhất để kiểm thử quy trình trên iPhone, không phải giọng đọc đã được chứng minh tự nhiên. VieNeu-TTS v3 Turbo vẫn là ứng viên ưu tiên cho vòng đánh giá mô hình tiếng Việt tự triển khai; chưa có căn cứ để khẳng định có thể chạy trực tiếp trên iPhone.

## 6. Cổng chất lượng trước khi phát hành video

Chỉ đánh dấu **ĐẠT** khi tất cả mục sau được xác minh:
- [ ] Có tệp âm thanh thực tế và người biên tập đã nghe toàn bộ.
- [ ] Phát âm tiếng Việt, tên riêng, con số và thuật ngữ đã được kiểm tra.
- [ ] Không có tiếng rè, méo, cắt âm hoặc khoảng nghỉ bất thường.
- [ ] Giọng đọc và tốc độ phù hợp với nội dung; phụ đề khớp lời.
- [ ] Có quyền sử dụng giọng tham chiếu, nhạc và hình ảnh.
- [ ] Không có dữ liệu cá nhân/bí mật trong văn bản hoặc âm thanh thử.
- [ ] Đã xác nhận phương án chạy không yêu cầu thanh toán, thẻ ngân hàng hoặc bật billing.
- [ ] Người biên tập đã duyệt bản video cuối cùng.

**Trạng thái hiện tại:** CHƯA ĐẠT CỔNG PHÁT HÀNH. Dự án mới hoàn tất rà soát tài liệu công bố; chưa chạy model, chưa nghe file âm thanh thực tế, chưa kiểm thử trên iPhone và chưa xác minh hiệu năng trên thiết bị của nhóm.

## Nguồn tham khảo chính thức

1. VieNeu-TTS repository: https://github.com/pnnbao97/VieNeu-TTS
2. VieNeu-TTS v3 Turbo model card: https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo
3. ZeroTTS repository: https://github.com/zeroweight-ai/ZeroTTS
4. ZeroTTS model card: https://huggingface.co/Pragmaticl/ZeroTTS
5. VieNeu documentation — phân biệt model tự triển khai và Cloud API tính phí theo ký tự: https://docs.vieneu.io/docs/
6. VieNeu Hugging Face Space app.py — implementation of request logging: https://huggingface.co/spaces/pnnbao-ump/VieNeu-TTS-v3-Turbo/blob/main/app.py
7. ZeroTTS browser demo documentation — client-side processing and model download size: https://github.com/zeroweight-ai/ZeroTTS/blob/main/docs/BROWSER.md

*Bản thảo được viết lại độc lập từ tài liệu dự án và model card; không sao chép nội dung tiếp thị. Các thông tin về license, model, dung lượng và benchmark phải được kiểm tra lại tại nguồn chính thức trước khi chuyển thành bài HTML công khai.*

## Đánh giá mẫu CapCut iPhone do người dùng cung cấp — 2026-11-17
- Người dùng xác nhận tệp âm thanh mẫu được tạo bằng CapCut trên iPhone của họ.
- Đã nghe mẫu tiếng Việt ngắn trong cuộc hội thoại; không tải tệp âm thanh lên repository và không đưa nội dung riêng tư vào dịch vụ bên ngoài.
- Nhận xét định tính: lời đọc nghe rõ và hiểu được; tốc độ hơi nhanh nhưng vẫn theo kịp; có ngắt giữa hai câu; ngữ điệu tương đối đều và vẫn có cảm giác giọng tổng hợp.
- Kết luận giới hạn: mẫu chứng minh CapCut iPhone có thể tạo được đoạn đọc tiếng Việt dùng để thử nghiệm. Mẫu đơn lẻ này chưa đủ để xác nhận giọng tự nhiên cao, độ ổn định trên nội dung dài, quyền thương mại của đúng giọng đã chọn hoặc điều kiện miễn phí cho mọi voice.
- Không chấm điểm định lượng và không tuyên bố đã xác minh giấy phép của voice cụ thể. Trước khi dùng video công khai, cần kiểm tra điều khoản/nhãn quyền sử dụng của đúng voice và nghe duyệt bản xuất cuối cùng.
- Không dùng CapCut Pro, không bật thanh toán; nếu voice cần trả phí thì loại khỏi lựa chọn.
- Tệp âm thanh gốc không được lưu vào GitHub nhằm bảo vệ quyền riêng tư của người dùng.
