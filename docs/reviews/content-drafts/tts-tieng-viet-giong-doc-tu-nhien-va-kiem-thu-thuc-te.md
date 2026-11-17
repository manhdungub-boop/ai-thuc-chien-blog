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

## Kết quả nghe thử bổ sung do người dùng xác nhận — 2026-11-17
- Độ rõ: rõ, dễ nghe (người dùng chọn `clear`).
- Độ tự nhiên: hơi giống giọng máy (người dùng chọn `rather_synthetic`).
- Tốc độ: hơi nhanh (người dùng chọn `slightly_fast`).
- Chi phí: người dùng xác nhận giọng thử được chọn là miễn phí (`yes`); chưa biết tên giọng cụ thể.
- Chưa có tên voice, phiên bản CapCut, vùng giọng hoặc cấu hình tốc độ; không suy đoán các thông tin này.
- Đánh giá biên tập: mẫu đạt mức dễ hiểu và có thể dùng để thử quy trình, nhưng hiện chưa đạt mục tiêu giọng đọc tự nhiên cho video chuyên nghiệp do còn cảm giác tổng hợp và tốc độ hơi nhanh.
- Khuyến nghị thử tiếp: nếu CapCut cho phép chỉnh tốc độ miễn phí, giảm nhẹ tốc độ rồi nghe lại cùng một đoạn; không bật Pro, không đăng ký trả phí. Cần nghe thêm đoạn 30–60 giây có tên riêng, số liệu và câu dài trước khi quyết định.
- Kết quả này là tự đánh giá của người dùng đối với giọng đã nghe; không phải kiểm thử độc lập và không xác nhận quyền thương mại của voice cụ thể.


## 5B. Ứng viên mới cần kiểm thử: KorvaTTS — rà soát tài liệu ngày 17/11/2026

Nguồn chính thức:
- Repository: https://github.com/dogenthq/KorvaTTS
- Model card: https://huggingface.co/dogenthq/KorvaTTS
- Trang thử do dự án liên kết: https://heykorva.com/

Thông tin có thể xác nhận từ README và model card tại ngày rà soát:
- KorvaTTS tự mô tả là TTS ưu tiên tiếng Việt, hỗ trợ câu tiếng Việt xen tên thương hiệu và thuật ngữ tiếng Anh (code-switching).
- Dự án công bố chạy ONNX Runtime, không cần GPU hoặc API, đầu ra 44.1 kHz; đây là tuyên bố của nhà phát triển, chưa phải kết quả benchmark độc lập của AI Thực Chiến.
- Có 10 voice style đóng gói sẵn: 5 giọng nữ (Bảo Kim, Khánh Vy, Ngọc Huyền, Phương Linh, Quỳnh Như) và 5 giọng nam (Gia Bảo, Hoàng Nam, Hữu Đạt, Quang Huy, Thanh Phong).
- README mô tả kiến trúc 99M tham số, tái triển khai Supertonic 3 và vocoder dựa trên BlueCodec. Model card liệt kê vector estimator ONNX khoảng 256 MB fp32; không được lấy riêng con số này làm tổng dung lượng tải.
- Repository ghi Apache-2.0 cho mã nguồn; MODEL_LICENSE.md ghi Apache-2.0 cho model weights và voice styles. Phần mã được điều chỉnh từ Supertonic và vocoder dựa trên BlueCodec có ghi nhận giấy phép MIT trong NOTICE.
- Voice cloning và công cụ huấn luyện mới nằm trong roadmap giai đoạn 2, chưa phải tính năng đã phát hành ở bản hiện tại.
- Tài liệu nói định dạng ONNX tương thích với các runtime Supertonic trên Python, Node.js, WebGPU, Rust, C++, Swift và Flutter. Điều đó không đồng nghĩa đã có ứng dụng iPhone cài sẵn hoặc đã xác minh chạy tốt trên iPhone.

Đánh giá phù hợp với tiêu chí của AI Thực Chiến:
- **Điểm đáng thử:** tập trung tiếng Việt, có nhiều voice preset, xử lý câu trộn tiếng Anh, công bố chạy cục bộ và license tương đối rõ.
- **Rủi ro/giới hạn:** dự án còn mới (README tại thời điểm rà soát hiển thị 14 commits và 31 stars); số liệu tốc độ/độ tự nhiên chưa được nhóm kiểm chứng. Chưa có kết quả nghe độc lập, chưa xác nhận tải model và chạy trực tiếp trên iPhone, chưa xác nhận chất lượng giọng ở đoạn dài.
- **Quyền riêng tư:** nếu chạy thực sự cục bộ bằng runtime phù hợp thì không cần gửi văn bản đến API theo mô tả dự án. Tuy nhiên, không mặc định trang web thử nghiệm xử lý hoàn toàn cục bộ trước khi kiểm tra network/privacy behavior; chỉ dùng câu giả lập công khai cho đến khi xác minh.
- **Chi phí:** mã nguồn và model được công bố miễn phí theo Apache-2.0; không đồng nghĩa chi phí thiết bị, dữ liệu di động hoặc hạ tầng khác bằng 0.

**Quyết định:** đưa KorvaTTS vào danh sách *ứng viên ưu tiên để nghe thử*, chưa thay VieNeu-TTS v3 Turbo hoặc CapCut trong khuyến nghị cuối. Chỉ nâng hạng sau khi có mẫu âm thanh thực tế được nghe và chấm cùng bộ câu thử, xác nhận cách chạy không mất phí và kiểm tra điều khoản áp dụng cho đúng voice asset.

**Kiểm thử tiếp theo không yêu cầu anh cài đặt:** trước hết kiểm tra khả năng chạy browser demo trên iPhone bằng câu giả lập, xem có phát sinh đăng nhập, trả phí, tải xuống lớn hoặc yêu cầu quyền bất thường không. Nếu không đáp ứng tiêu chí miễn phí/an toàn/đơn giản, dừng tại bước rà soát tài liệu và không yêu cầu anh thao tác kỹ thuật.


### Bổ sung phân biệt website HeyKorva và model mã nguồn mở — 17/11/2026

Đã rà soát trang chủ https://heykorva.com/:
- Trang hiện công bố dùng thử không cần tài khoản với hạn mức 500 ký tự/ngày; đăng ký tài khoản miễn phí được quảng bá là 10.000 ký tự/ngày. Đây là hạn mức website tự công bố, chưa được nhóm xác minh bằng tài khoản hoặc kiểm thử thực tế.
- Trang quảng bá 10 giọng và tải WAV; voice cloning/API được ghi là “sắp ra mắt”.
- Trang chủ tuyên bố văn bản không được lưu hoặc ghi log. Đây mới là tuyên bố của nhà cung cấp; chưa kiểm tra độc lập bằng chính sách bảo mật đầy đủ, network trace hoặc kiểm toán hệ thống.
- Trang chủ cũng dùng cụm “công nghệ độc quyền”, trong khi repository KorvaTTS là dự án mã nguồn mở. Không được mặc định dịch vụ hosted HeyKorva đang chạy đúng cùng bản model/weights Apache-2.0 công khai; cần hỏi/đối chiếu điều khoản dịch vụ và model triển khai.
- Vì website là dịch vụ hosted, văn bản thử sẽ được gửi đến hạ tầng bên ngoài theo luồng sử dụng thông thường; tuyên bố không lưu/log không đồng nghĩa không truyền dữ liệu. Chỉ dùng câu giả lập công khai, tuyệt đối không gửi kịch bản nội bộ, thông tin cá nhân, dữ liệu khách hàng hoặc nội dung chưa xuất bản.

**Kết luận cập nhật:** HeyKorva có thể là phương án thử ngắn miễn phí theo hạn mức công bố, nhưng chưa đủ căn cứ để xếp vào phương án ưu tiên về quyền riêng tư hoặc quyền sử dụng thương mại. KorvaTTS tự triển khai và HeyKorva hosted phải được đánh giá như hai phương án khác nhau. Không đăng ký, không nhập dữ liệu của dự án và không yêu cầu anh thao tác cho đến khi điều khoản, cách xử lý dữ liệu và điều kiện sử dụng thương mại được xác minh rõ.


## 5C. Đối chiếu thêm các dự án TTS tiếng Việt — rà soát nguồn 17/11/2026

### ViTTS-Bench: nguồn benchmark bên thứ ba

Nguồn: https://github.com/yoonjae26/vietnamese-tts và https://github.com/yoonjae26/vietnamese-tts/blob/main/docs/RESULTS.md

Đây là repository benchmark do nhóm khác thực hiện, không phải benchmark của tác giả các model. Họ dùng 50 câu chung đã chuẩn hóa thành lời nói, PhoWhisper-large để tính WER, cấu hình khuyến nghị của từng model và seed cố định. Kết quả công bố:

| Model | WER | UTMOS | RTF | Giấy phép được bảng benchmark ghi |
|---|---:|---:|---:|---|
| IndexTTS-2 Vietnamese | 1,8% | 1,99 | 1,063 | Apache-2.0* |
| F5-TTS Vietnamese | 3,0% | 2,21 | 0,219 | CC-BY-NC-SA-4.0 |
| VieNeu-TTS v3 Turbo | 3,3% | 2,16 | 0,101 | Apache-2.0 |
| Piper vi_VN-vais1000-medium | 5,7% | 2,37 | 0,037 CPU | CC-BY-4.0 |
| MMS-TTS | 6,9% | 2,74 | 0,013 | CC-BY-NC-4.0 |
| viXTTS | 9,2% | 2,20 | 0,202 | CPML (phi thương mại) |
| VietTTS | 12,0% | 2,39 | 0,395 | CC |

Lưu ý phương pháp rất quan trọng:
- RTF của bảng này đo trên NVIDIA H200, ngoại trừ Piper chạy CPU; không thể dùng để dự đoán tốc độ trên iPhone.
- UTMOS là mô hình dự đoán tự động, được chính benchmark ghi nhận là huấn luyện trên tiếng Anh; không phải điểm MOS do hội đồng người Việt nghe và chấm.
- WER phản ánh độ dễ nhận dạng lời nói, không đo trực tiếp ngữ điệu hay cảm giác tự nhiên.
- Benchmark chưa có human MOS và chính tác giả nêu cần thêm nhiều giọng tham chiếu. Kết quả có thể thay đổi khi thay giọng tham chiếu.
- IndexTTS-2 có WER tốt nhất trong bảng, nhưng benchmark ghi chú cần xin phép tác giả cho mục đích thương mại; không chọn làm phương án phát hành 0 đồng/thương mại khi chưa làm rõ quyền.
- VieNeu-TTS v3 Turbo là ứng viên cân bằng đáng thử theo benchmark này, nhưng không thể kết luận là giọng tự nhiên nhất chỉ từ WER/UTMOS.

### ZeroTTS — cập nhật đúng trạng thái tính năng

Đã đối chiếu lại README hiện tại của repository chính chủ https://github.com/zeroweight-ai/ZeroTTS:
- Package mã nguồn mở hiện có 8 voice preset và hỗ trợ phát sinh âm thanh qua ONNX Runtime.
- **Voice cloning vẫn không có trong package/release công khai** vì voice encoder tạo speaker latent chưa được phát hành. Tuy nhiên, README hiện chỉ rõ dịch vụ nền tảng riêng của nhà phát triển có thể tạo latent rồi tải về. Không được mô tả rằng toàn bộ khả năng voice cloning là không tồn tại; phải phân biệt package local với dịch vụ hosted.
- Model weights tải lần đầu khoảng 900 MB, fp32, chưa quantize; browser demo lưu cache cục bộ và tài liệu nhắm tới desktop broadband, không nhắm mobile data.
- README hiện ghi MIT cho code và weights; decoder MOSS đi kèm Apache-2.0. Bộ dữ liệu ZeroBench-TTS có CC-BY-NC-4.0, đây là license của dataset benchmark, không phải license của model.
- Các chỉ số WER 1,03%, UTMOS 2,91, RTF CPU 0,50× là benchmark do chính nhóm ZeroTTS công bố trên ZeroBench-TTS, so sánh với ba baseline. Không phải đánh giá độc lập trên iPhone và không thể so trực tiếp với bảng ViTTS-Bench vì tập câu, model, thiết bị và cách chấm khác nhau.
- Không gửi âm thanh tham chiếu hoặc giọng nói của người khác lên dịch vụ tạo latent nếu chưa có quyền và chưa xác minh chính sách dữ liệu.

### ViFastTts — loại khỏi lựa chọn sản xuất thương mại hiện tại

Nguồn chính chủ: https://github.com/vifast-oss/ViFastTts và docs/NGOC_HUYEN.md.

- Repository mô tả một model mẫu Ngọc Huyền 6,1M tham số, ONNX CPU, 24 kHz; tác giả công bố RTF 0,045 trên VPS CPU và A/B 24/24 người nghe chọn bản mới so với phiên bản P2 trước đó. Đây là số liệu nội bộ do chính dự án công bố, không phải kiểm thử độc lập.
- **Model Ngọc Huyền được ghi rõ chỉ dùng nghiên cứu/phi thương mại**, vì dataset gốc CC BY-NC 4.0. Do đó không dùng làm giọng cho video thương mại/kiếm tiền của AI Thực Chiến nếu chưa có quyền khác bằng văn bản.
- Bản iOS được README ghi là **iOS Simulator**, không phải app cài trực tiếp lên iPhone thật; cần macOS/Xcode để chạy simulator. Không phù hợp quy trình hiện tại chỉ có iPhone.
- Trang demo online công bố giới hạn 3.000 ký tự và nói không lưu text/audio. Đây là tuyên bố của nhà cung cấp; chưa có kiểm toán độc lập. Không gửi nội dung chưa công bố hoặc dữ liệu riêng tư.

**Quyết định:** không chọn model Ngọc Huyền của ViFastTts cho nội dung thương mại; chỉ giữ thông tin làm tài liệu tham khảo kỹ thuật. Không yêu cầu người dùng cài Xcode hoặc dùng máy tính.

## 5D. Xếp hạng ứng viên theo điều kiện thực tế của dự án

Đây là thứ tự ưu tiên **để kiểm thử tiếp**, không phải bảng xếp hạng chất lượng âm thanh đã được nghe trực tiếp:

1. **CapCut Mobile — phương án tạo mẫu ngay trên iPhone:** đã có mẫu thực tế do người dùng cung cấp; rõ và dễ nghe, nhưng hơi máy móc và hơi nhanh. Chỉ giữ làm phương án dự phòng, thử giảm nhẹ tốc độ nếu có tùy chọn miễn phí. Cần xác minh quyền của đúng voice trước khi phát hành.
2. **VieNeu-TTS v3 Turbo — ứng viên model mã nguồn mở ưu tiên:** có 25 voice preset, CPU/ONNX và kết quả benchmark bên thứ ba tốt về WER/RTF trên thiết bị benchmark. Cần môi trường máy tính tương thích để tạo mẫu; chưa xác minh trên iPhone.
3. **KorvaTTS — ứng viên mới cần nghe thử:** 10 preset, tiếng Việt/code-switching, Apache-2.0 cho code/weights theo tài liệu chính chủ. Chưa có benchmark so sánh độc lập hoặc mẫu do nhóm AI Thực Chiến nghe; không coi website hosted HeyKorva là tương đương mô hình tự chạy cục bộ.
4. **ZeroTTS — đối chứng chất lượng/CPU:** kết quả tự benchmark của dự án tốt, nhưng tải model lớn khoảng 900 MB; browser demo không hướng tới điện thoại. Package local không có encoder voice cloning.
5. **CapCut và dịch vụ hosted khác:** chỉ thử bằng văn bản giả lập công khai, không đưa dữ liệu dự án chưa công bố lên dịch vụ bên ngoài.

Không đưa ViFastTts Ngọc Huyền vào lựa chọn thương mại do điều khoản phi thương mại. Không dùng F5-TTS Vietnamese hoặc MMS-TTS cho video kiếm tiền khi license được benchmark ghi là phi thương mại.

## 5E. Bộ thử nghiệm nghe chuẩn hóa — phiên bản 2

Để so sánh công bằng, mọi ứng viên phải đọc đúng cùng nội dung và giữ nguyên cấu hình. Mỗi voice tạo một file 45–60 giây gồm:
- Mở đầu tự nhiên, giọng thân thiện nhưng không quảng cáo quá mức.
- Câu hướng dẫn kỹ thuật có thuật ngữ tiếng Anh: “GitHub Actions, Cloudflare Workers và Google OAuth”.
- Số, ngày, giờ, phần trăm và đơn vị: “Phiên bản 2.4.1, ngày 17 tháng 11 năm 2026, lúc 8 giờ 15 phút, tăng 12,5 phần trăm”.
- Câu dài có dấu phẩy, dấu hai chấm, câu hỏi và lời kết.
- Cụm từ dễ sai thanh điệu và phụ âm: “xử lý dữ liệu, bảo mật hệ thống, quyền truy cập, kiểm thử thực tế”.

Chấm độc lập theo thang 1–5:
1. Phát âm và dấu thanh.
2. Ngữ điệu, nhấn trọng âm và cảm xúc.
3. Nhịp nói, khoảng nghỉ và tốc độ.
4. Tên riêng, thuật ngữ và số liệu.
5. Độ tự nhiên, không đều đều/máy móc.
6. Chất lượng âm thanh, không rè/cắt/âm giả.
7. Độ nhất quán giữa đầu và cuối đoạn.

Ngưỡng đề xuất để đưa vào video:
- Trung bình ít nhất 4/5 ở tiêu chí tự nhiên, phát âm và ngữ điệu.
- Không có lỗi sai tên riêng, con số hoặc nội dung làm đổi nghĩa.
- Không có lỗi rè, cắt tiếng, khoảng lặng bất thường.
- Người nghe hiểu ngay ở tốc độ bình thường; không phải tăng tốc hoặc đoán từ.
- Xác minh license đúng model/voice asset và quyền thương mại; không suy diễn license từ mã nguồn sang giọng thu âm/dữ liệu.
- Không yêu cầu thanh toán, thẻ ngân hàng hoặc bật billing.

**Giới hạn thực thi:** hiện chưa có file âm thanh mới từ KorvaTTS, VieNeu hoặc ZeroTTS được nhóm tạo và nghe A/B trên thiết bị đích. Vì vậy chưa thể chấm điểm 1–5 hoặc công bố model chiến thắng. Các bảng trên chỉ là dữ liệu tài liệu/benchmark có nguồn, không thay thế nghe thử người thật.

## Nguồn mới bổ sung

8. KorvaTTS repository: https://github.com/dogenthq/KorvaTTS
9. KorvaTTS model card: https://huggingface.co/dogenthq/KorvaTTS
10. ViTTS-Bench repository: https://github.com/yoonjae26/vietnamese-tts
11. ViTTS-Bench full results and methodology: https://github.com/yoonjae26/vietnamese-tts/blob/main/docs/RESULTS.md
12. ZeroTTS repository (current README, voice-cloning boundary and browser size): https://github.com/zeroweight-ai/ZeroTTS
13. ViFastTts repository: https://github.com/vifast-oss/ViFastTts
14. ViFastTts Ngọc Huyền model limitations/license: https://github.com/vifast-oss/ViFastTts/blob/main/docs/NGOC_HUYEN.md


## 5F. Kiểm tra sâu khả năng chạy KorvaTTS trên iPhone và ranh giới quyền riêng tư — 17/11/2026

Đã kiểm tra trực tiếp README tiếng Việt, `pyproject.toml`, `korvatts/assets.py`, `korvatts/tts.py`, `MODEL_LICENSE.md` trong repository chính chủ, cùng trang model card và trang chủ HeyKorva.

### Những gì mã nguồn thực sự xác nhận

- Gói phát hành hiện tại là thư viện Python `korvatts`, yêu cầu Python >= 3.10; các dependency được khai báo gồm ONNX Runtime, NumPy, SoundFile và Hugging Face Hub.
- Khi khởi tạo `TTS()`, nếu không tìm thấy assets cục bộ hợp lệ, `resolve_assets_dir()` gọi `snapshot_download` để tải các thư mục `onnx/*` và `voice_styles/*` từ Hugging Face. Đây là tải model/voice về môi trường đang chạy; không phải bằng chứng có ứng dụng iOS cài trực tiếp.
- `tts.py` chạy chuỗi ONNX duration predictor, text encoder, vector estimator theo số bước và vocoder; mặc định 32 bước. README nêu 8–16 bước có thể nhanh hơn nhưng không thay thế kiểm thử chất lượng.
- README nói assets có thể tương thích với các runtime Supertonic 3 gồm browser/WebGPU, Swift và Flutter. Đây là khả năng tương thích định dạng/đồ thị ONNX; repository hiện không chứa app iOS hoàn chỉnh hoặc giao diện browser độc lập để người dùng iPhone mở lên và dùng ngay.
- Model card ghi riêng vector estimator khoảng 256 MB fp32. Không có đủ số liệu file trong tài liệu đã đọc để khẳng định tổng dung lượng toàn bộ model; không được lấy 256 MB làm tổng dung lượng tải.

### HeyKorva: điều đã thấy và điều chưa xác minh

Trang chủ HeyKorva đang hiển thị:
- 500 ký tự/ngày khi dùng thử không cần tài khoản; đăng ký miễn phí được quảng bá là 10.000 ký tự/ngày.
- 10 giọng và tải WAV; voice cloning/API vẫn được ghi là sắp ra mắt.
- Nhà cung cấp tuyên bố văn bản không lưu hoặc ghi log; âm thanh tạo ra thuộc về người dùng.

Giới hạn xác minh:
- Trang công khai có các mục liên kết “Chính sách bảo mật” và “Điều khoản sử dụng”, nhưng nội dung pháp lý đầy đủ không được hiển thị trong bản trang đã kiểm tra; chưa xác nhận được chủ thể pháp lý, thời gian lưu, nhà xử lý phụ, quyền thương mại cụ thể của voice và cơ chế yêu cầu xóa.
- Chưa kiểm tra network trace hoặc mã frontend của HeyKorva. Vì vậy **chưa xác minh được suy luận TTS chạy hoàn toàn trên thiết bị hay gửi văn bản tới máy chủ để xử lý**. Không được suy diễn chỉ từ câu “không lưu/ghi log” hoặc “không xếp hàng”.
- Cụm “công nghệ độc quyền” trên website cũng chưa chứng minh dịch vụ đang chạy đúng checkpoint/weights Apache-2.0 trong repository công khai.

### Quyết định vận hành

- **Không đăng ký tài khoản, không nhập văn bản, không tải model lớn và không bật quyền/thanh toán** trong vòng rà soát hiện tại.
- Chưa đủ căn cứ để dùng HeyKorva với bất kỳ nội dung chưa công bố nào; ngay cả câu thử giả lập cũng tạm hoãn cho đến khi xác định được luồng xử lý và điều khoản pháp lý.
- KorvaTTS local vẫn là ứng viên mã nguồn mở đáng theo dõi, nhưng không phải giải pháp có thể tự cài trực tiếp trên iPhone theo repository hiện tại.
- Để đánh giá tiếp mà không cần anh thao tác kỹ thuật, cần có môi trường chạy Python/ONNX đã được cấp quyền và phù hợp; hiện chưa có môi trường như vậy trong phạm vi công cụ đã xác minh. Không thuê máy chủ, không tạo tài khoản trả phí và không thay đổi Production để giải quyết giới hạn này.

**Kết luận:** KorvaTTS chưa vượt qua cổng khả năng sử dụng trên iPhone và quyền riêng tư của dịch vụ thử nghiệm. Giữ ở trạng thái nghiên cứu, không nâng thành lựa chọn sản xuất.

### Nguồn đã kiểm tra bổ sung

15. KorvaTTS README tiếng Việt: https://github.com/dogenthq/KorvaTTS/blob/main/README.vi.md
16. KorvaTTS package dependencies: https://github.com/dogenthq/KorvaTTS/blob/main/pyproject.toml
17. KorvaTTS asset download implementation: https://github.com/dogenthq/KorvaTTS/blob/main/korvatts/assets.py
18. KorvaTTS ONNX inference implementation: https://github.com/dogenthq/KorvaTTS/blob/main/korvatts/tts.py
19. KorvaTTS model license: https://github.com/dogenthq/KorvaTTS/blob/main/MODEL_LICENSE.md
20. KorvaTTS model card and asset descriptions: https://huggingface.co/dogenthq/KorvaTTS
21. HeyKorva public page and its current free-use/privacy claims: https://heykorva.com/


## 5G. Hai ứng viên bổ sung cho quy trình iPhone — rà soát nguồn 17/11/2026

### Speechma — hosted TTS, ưu tiên làm bài nghe thử bằng văn bản công khai

Nguồn:
- Trang TTS tiếng Việt: https://speechma.com/vietnamese-text-to-speech
- Điều khoản: https://speechma.com/terms
- Chính sách quyền riêng tư: https://speechma.com/privacy

Thông tin nhà cung cấp công bố:
- Có hai giọng tiếng Việt: HoaiMy (nữ) và NamMinh (nam); tối đa 2.000 ký tự mỗi lần, không cần tài khoản, tải MP3; trang TTS nói có điều chỉnh tốc độ và cao độ.
- Điều khoản cấp quyền sử dụng output trên phạm vi toàn cầu, không độc quyền, vĩnh viễn, miễn phí bản quyền cho mục đích cá nhân hoặc thương mại hợp pháp, nếu tuân thủ điều khoản và quyền của bên thứ ba.
- Chính sách quyền riêng tư nói văn bản được truyền bảo mật đến Speechma và các đối tác hạ tầng AI để tạo kết quả; tệp tải lên không được lưu trên máy chủ Speechma sau khi xử lý; bản âm thanh trả về trình duyệt. Chính sách cũng nêu Google Analytics/AdSense và một số dữ liệu kỹ thuật, nhật ký bảo mật.
- Đây là thông tin do nhà cung cấp tự công bố; AI Thực Chiến chưa kiểm toán độc lập hạ tầng, chưa xác minh chính xác voice engine/voice asset cho từng mẫu và chưa nghe thử output.

Đánh giá:
- **Phù hợp để đưa vào vòng nghe thử ngắn trên iPhone** vì có MP3, giới hạn miễn phí rõ và không yêu cầu tài khoản theo trang TTS.
- **Không phù hợp với nội dung nội bộ/chưa công bố:** văn bản được gửi đến nhà cung cấp và đối tác hạ tầng để xử lý, dù chính sách nói không lưu sau khi xử lý.
- Chỉ dùng câu giả lập đã công khai, không dùng bản thảo bài viết, dữ liệu cá nhân, dữ liệu khách hàng, thông tin đăng nhập hay tài liệu chưa phát hành.
- Quyền thương mại được điều khoản của Speechma tuyên bố cho output; vẫn phải kiểm tra đúng phiên bản điều khoản, quyền văn bản đầu vào và quyền của bên thứ ba. Không suy diễn đây là bảo đảm về chất lượng tự nhiên.
- Không dùng Speechma API (trang công bố từ 9 USD/tháng); chỉ xem xét công cụ web miễn phí.

**Quyết định:** xếp Speechma vào nhóm *ứng viên hosted để nghe thử bằng câu giả lập công khai*, không phải công cụ đã được phê duyệt sản xuất. Chưa chấm điểm tự nhiên vì chưa có audio thực tế được nghe.

### PyroSoft Convert — phương án TTS chạy trong trình duyệt, cần xác minh Safari iPhone

Nguồn:
- Công cụ: https://pyrosoft.pro/convert/audio/vietnamese-text-to-speech/
- Thông báo license: https://pyrosoft.pro/convert/NOTICES.txt
- Supertonic 3 chính chủ: https://supertonic3.github.io/

Thông tin nhà cung cấp và dự án công bố:
- PyroSoft nói công cụ chạy hoàn toàn trong trình duyệt, không tải văn bản/tệp lên máy chủ; sau khi tải model có thể hoạt động offline.
- Trang ghi 10 giọng Supertonic cho 30 ngôn ngữ ngoài tiếng Anh, gồm tiếng Việt; kích thước Supertonic trên công cụ được trang nêu khoảng 398 MB. Công cụ quảng bá miễn phí, không tài khoản, không watermark và không giới hạn ký tự.
- PyroSoft ghi Supertonic theo OpenRAIL-M; trang Supertonic 3 chính chủ xác nhận model weights theo OpenRAIL-M, mã nguồn/runtime mẫu theo MIT. OpenRAIL-M cho phép dùng thương mại nhưng có điều kiện/hạn chế sử dụng và yêu cầu attribution; không được mô tả toàn bộ model là MIT.
- Trang Supertonic 3 nói hỗ trợ tiếng Việt và có runtime/browser, iOS; tuy nhiên đây là khả năng của model/runtime upstream, không phải bằng chứng PyroSoft Convert đã được kiểm thử trên Safari/iPhone.

Đánh giá:
- Ưu điểm tiềm năng: nếu đúng là xử lý hoàn toàn trong browser như nhà cung cấp công bố thì nội dung không cần gửi lên server TTS; đây là hướng đáng ưu tiên về quyền riêng tư.
- Rủi ro: tải model khoảng 398 MB có thể tốn dữ liệu và bộ nhớ; chưa kiểm tra Safari iOS, khả năng giữ tab nền, xuất file, hiệu năng hoặc độ ổn định trên iPhone.
- Chưa có kiểm toán network độc lập để xác nhận tuyên bố không upload; chưa có audio nghe thử; chưa xác nhận đầy đủ attribution/điều kiện license áp dụng cho voice preset và bản triển khai cụ thể.

**Quyết định:** giữ ở trạng thái *cần kiểm thử tương thích iPhone và xác minh xử lý cục bộ*. Không tải model lớn qua mạng di động, không coi là giải pháp iPhone đã sẵn sàng và không đưa nội dung nội bộ vào trước khi kiểm chứng network behavior.

### So sánh quyết định ở thời điểm rà soát

| Ứng viên | Miễn phí theo công bố | Cách xử lý | Quyền thương mại theo tài liệu | Trạng thái |
|---|---|---|---|---|
| Speechma | 2.000 ký tự/lần, không tài khoản | Hosted; text gửi tới Speechma và đối tác xử lý | Điều khoản cho phép dùng output hợp pháp, subject to terms/third-party rights | Có thể nghe thử bằng câu công khai |
| PyroSoft / Supertonic 3 | Miễn phí, không tài khoản, không giới hạn theo trang | Nhà cung cấp nói local trong browser; cần kiểm chứng | Model OpenRAIL-M, có hạn chế và attribution; code MIT | Chờ kiểm tra Safari/iPhone và network |
| CapCut Mobile | TTS core free; một số voice Pro | Dịch vụ CapCut; không dùng nội dung nội bộ | Trang CapCut nói TTS output có thể dùng thương mại, tuân thủ terms; kiểm tra đúng voice | Đã có mẫu, hơi máy móc/hơi nhanh theo phản hồi người dùng |

**Thứ tự hành động an toàn:**
1. Speechma: nếu có quy trình nghe thử trong môi trường phù hợp, chỉ dùng một câu giả lập công khai, không cần đăng ký và không nhập nội dung dự án.
2. PyroSoft: trước khi tải model ~398 MB, phải xác minh Safari iOS hỗ trợ, dung lượng tải thực tế và cách xuất file; không tự động tải bằng dữ liệu di động.
3. CapCut: giữ làm phương án dự phòng đã có mẫu; chỉ thử chỉnh tốc độ nhẹ nếu tính năng miễn phí và vẫn nghe lại toàn đoạn.
4. Không chọn người thắng khi chưa có file âm thanh thực tế và phiếu chấm độc lập.

**Trạng thái cổng phát hành không đổi: CHƯA ĐẠT.** Không có mẫu âm thanh mới được nghe; không có ứng viên nào được xác nhận tự nhiên đạt ngưỡng; không phát hành video.



## 5H. Xác minh lại quy trình Speechma trên iPhone — nguồn chính thức 17/11/2026

Đã đối chiếu lại FAQ, trang hướng dẫn iPhone và Terms of Service của Speechma. Kết quả làm rõ thêm khả năng thao tác trên iPhone, nhưng không thay thế việc nghe file âm thanh thực tế.

### Khả năng sử dụng và giới hạn miễn phí theo nhà cung cấp

- FAQ chính thức nói Speechma hoạt động trên iPhone/iPad qua website trong Safari và các trình duyệt di động hiện đại; đây là tuyên bố tương thích của nhà cung cấp, chưa phải bài kiểm thử trực tiếp trên thiết bị của AI Thực Chiến.
- FAQ ghi công cụ TTS miễn phí không cần đăng ký, email hoặc thẻ; mỗi lần tạo yêu cầu mã bảo mật 5 chữ số.
- Giới hạn được công bố: tối đa 2.000 ký tự cho một lần chuyển văn bản thành giọng nói tiêu chuẩn; giọng nhân vật tối đa 1.000 ký tự. File MP3 có thể tải xuống.
- FAQ mô tả có thể chèn thẻ nghỉ như `[break 1s]`, `[break 2s]`, `[break 3s]` và các thời lượng tùy chỉnh tối đa 10 giây mỗi thẻ, tối đa 50 thẻ mỗi văn bản; thẻ nghỉ tính vào giới hạn ký tự. Đây là tính năng hữu ích để thử nhịp câu, nhưng cần nghe để xác nhận cách đọc thực tế.
- SpeechmaPRO và API là dịch vụ trả phí riêng; tuyệt đối không chuyển sang các sản phẩm này, không tạo API key, không nhập thông tin thanh toán.

### Quyền sử dụng output và dữ liệu đầu vào

- Terms of Service cấp quyền toàn cầu, không độc quyền, vĩnh viễn, miễn phí bản quyền để dùng, chỉnh sửa, xuất bản, phân phối và kiếm tiền từ output cho mục đích hợp pháp, với điều kiện tuân thủ điều khoản, chính sách sử dụng và quyền của bên thứ ba.
- Điều khoản yêu cầu người dùng có đầy đủ quyền đối với văn bản/đầu vào; đồng thời cho phép Speechma và các đối tác hạ tầng xử lý đầu vào trong phạm vi cần thiết để tạo kết quả, bảo mật và tuân thủ pháp luật.
- Vì vậy, không được coi “không lưu tệp sau xử lý” là “không gửi dữ liệu ra ngoài”. Chỉ sử dụng câu thử giả lập công khai; không gửi bản thảo nội bộ, nội dung chưa xuất bản, dữ liệu khách hàng, thông tin cá nhân hoặc bí mật.
- Quyền thương mại của output không chứng minh output có tính độc quyền, không bảo đảm được bảo hộ bản quyền, và không thay thế việc kiểm tra quyền của văn bản/giọng/nhạc/hình ảnh đầu vào.

### Quyết định cập nhật

Speechma hiện là ứng viên thực tế nhất để **người dùng tự nghe thử trên iPhone mà không cần cài ứng dụng hoặc tạo tài khoản**, theo thông tin nhà cung cấp. Quy trình thử chỉ nên dùng một câu giả lập công khai ngắn, kiểm tra mã 5 chữ số, tạo MP3 và nghe trực tiếp. Chưa có file được tạo hoặc nghe trong phiên rà soát này; không chấm điểm tự nhiên, không công nhận là giọng đạt chuẩn và không tự động đưa vào video.

Nếu người dùng tự chọn thử, cần ghi lại tên chính xác của voice, thời điểm, thiết lập tốc độ/cao độ, lỗi dấu thanh/tên riêng/số liệu và đánh giá theo phiếu 7 tiêu chí ở mục 3. Không nhập nội dung thật của dự án.

### Nguồn chính thức đã đối chiếu

22. Speechma FAQ — iPhone/Safari, miễn phí, giới hạn ký tự, MP3 và mã bảo mật: https://speechma.com/faq
23. Speechma iPhone guide: https://speechma.com/text-to-speech-iphone
24. Speechma Terms of Service — quyền input/output và xử lý bởi đối tác hạ tầng: https://speechma.com/terms

**Trạng thái:** mới xác minh tài liệu tương thích và điều khoản; chưa thử trực tiếp trên iPhone, chưa có audio được nghe, chưa đạt cổng phát hành video.

## 5I. Tiếp nhận và phân tích kỹ thuật mẫu Speechma HoaiMy — 17/11/2026

- Người dùng chia sẻ liên kết Google Drive tới tệp `speechma_audio_HoaiMy_at_1_19_50 AM_on_November_17th_2026.mp3`.
- Metadata Google Drive xác nhận MIME type `audio/mpeg`, dung lượng 183.312 bytes. Tên tệp cho biết voice được chọn là HoaiMy; tên tệp không thay thế bằng chứng về cấu hình giọng.
- Đã tải byte MP3 từ liên kết tạm thời do Google Drive connector cung cấp vào sandbox xử lý riêng. Tệp không được tải lên dịch vụ transcription/TTS bên thứ ba và không được commit vào GitHub.
- Phân tích cục bộ bằng SoundFile/Librosa trên tệp thực tế:
  - Thời lượng: 30,552 giây.
  - Kênh: mono; sample rate: 24.000 Hz.
  - Peak amplitude: 0,7115; RMS amplitude: 0,1143.
  - Không có mẫu PCM đạt ngưỡng clipping `|sample| >= 0,999` trong dữ liệu giải mã.
  - Với ngưỡng năng lượng RMS -40 dBFS, khoảng 74,7% khung 10,7 ms được phân loại là hoạt động có năng lượng; phần còn lại có thể bao gồm khoảng nghỉ và âm tiết nhỏ. Đây là phép đo năng lượng, không phải xác nhận lỗi ngắt tiếng.
- Đã thử chạy bộ nhận dạng giọng nói mã nguồn mở Faster-Whisper tiny trong sandbox riêng để lấy transcript tiếng Việt. Tác vụ thất bại do không tương thích API PyAV (`open() got an unexpected keyword argument 'metadata_errors'`); không có transcript đáng tin cậy. Không gửi audio tới API trả phí hoặc dịch vụ ngoài.
- **Kết luận nghe thử:** CHƯA THỰC HIỆN. Không có khả năng nghe chủ quan trực tiếp trong phiên này; chưa chấm 7 tiêu chí, chưa xác nhận phát âm/dấu thanh, ngữ điệu, nhịp điệu, độ tự nhiên, tiếng ồn hoặc quyền thương mại của voice cụ thể.
- **Kết quả kỹ thuật:** xác nhận được tệp giải mã được và không phát hiện clipping theo ngưỡng nêu trên. Không suy rộng thành kết luận chất lượng giọng.
- **Bước tiếp theo:** nếu có bộ giải mã/nhận dạng cục bộ tương thích, tiếp tục kiểm tra transcript và phân đoạn; phần tự nhiên/ngữ điệu vẫn cần nghe mẫu. Không yêu cầu người dùng tải lại tệp khi liên kết hiện tại đã đủ để lấy dữ liệu.
- **Trạng thái cổng video:** CHƯA ĐẠT. Chưa phê duyệt HoaiMy cho video cho tới khi hoàn tất đánh giá nghe, phát âm và quyền sử dụng thương mại của đúng giọng.


## 5J. Đối chiếu lại điều khoản và quyền riêng tư Speechma — 17/11/2026

- Trang Terms of Service (cập nhật 05/10/2026) cho phép sử dụng Output trên toàn cầu, không độc quyền, vĩnh viễn, miễn phí bản quyền cho mục đích thương mại hợp pháp; người dùng vẫn phải sở hữu/quyền sử dụng Input và tuân thủ quyền của bên thứ ba. Điều khoản cũng nói Input được xử lý bởi Speechma và đối tác hạ tầng chỉ để tạo kết quả, và tuyên bố tệp tải lên không được lưu sau xử lý.
- FAQ và trang Vietnamese TTS nêu miễn phí, không cần tài khoản/thẻ, tối đa 2.000 ký tự/lượt, cần mã bảo mật 5 chữ số, MP3 download và hai giọng HoaiMy/NamMinh. Đây là thông tin do nhà cung cấp công bố, có thể thay đổi.
- Privacy Policy được truy xuất hiện vẫn ghi nhận text input, dữ liệu sử dụng (bao gồm voice/speed), IP/device/browser và cookies/analytics; mục retention nói lưu dữ liệu khi cần cho mục đích dịch vụ hoặc nghĩa vụ pháp lý, và nêu chia sẻ với nhà cung cấp hạ tầng/analytics. Các tuyên bố tổng quát này chưa giải thích đầy đủ thời hạn lưu text/log và có khác biệt về mức độ chi tiết so với Terms/FAQ nói tệp tải lên không lưu sau xử lý.
- Kết luận quyền thương mại: điều khoản cho phép dùng Output thương mại, nhưng chỉ là quyền cấp đối với Output và không bảo đảm độc quyền, không thay thế quyền đối với Input/voice bên thứ ba.
- Kết luận riêng tư: mức rủi ro không phù hợp để gửi bản thảo nội bộ, dữ liệu khách hàng, thông tin đăng nhập hoặc dữ liệu cá nhân nhạy cảm. Chỉ dùng văn bản công khai/đã được duyệt; không dùng Speechma API/PRO có phí.
- Nguồn chính thức: https://speechma.com/terms ; https://speechma.com/privacy ; https://speechma.com/faq ; https://speechma.com/vietnamese-text-to-speech .
- Trạng thái Speechma vẫn là candidate. Mẫu HoaiMy đã được phân tích tín hiệu kỹ thuật nhưng chưa được nghe/chấm chủ quan; chưa phê duyệt cho video.


## 5K. Ứng viên biên tập video và phụ đề miễn phí trên iPhone: KakuCut — rà soát 17/11/2026

Nguồn:
- App Store Việt Nam: https://apps.apple.com/vn/app/kakucut-video-editor/id6811591634
- Apple — tính khả dụng tính năng và ngôn ngữ: https://www.apple.com/vn/ios/feature-availability/
- Apple Speech framework — danh sách locale nhận dạng: https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportedlocales()

Thông tin công khai trên App Store:
- KakuCut được liệt kê là ứng dụng miễn phí, chỉ dành cho iPhone, yêu cầu iOS 17 trở lên; dung lượng trang cửa hàng tại thời điểm rà soát khoảng 14,1 MB.
- Mô tả ứng dụng nêu các chức năng cắt, tách, sắp xếp tối đa 10 clip, tạo và chỉnh sửa phụ đề, sửa timing, nhập/xuất SRT, tùy chỉnh kiểu chữ và vị trí phụ đề, thu voiceover, chỉnh âm lượng và xuất MP4.
- Nhà phát triển tuyên bố video và dữ liệu dự án được giữ trên thiết bị, không cần tài khoản và không cần tải footage lên máy chủ.
- Mô tả cảnh báo khả năng tạo phụ đề tự động phụ thuộc thiết bị, ngôn ngữ, phiên bản iOS và hỗ trợ speech model của Apple.

Đánh giá khả năng tiếng Việt và quyền riêng tư:
- Apple liệt kê tiếng Việt trong một số khả năng Dictation/on-device speech recognition ở trang Feature Availability. Tài liệu Speech framework cũng cảnh báo hỗ trợ locale không bảo đảm mọi yêu cầu nhận dạng đều xử lý được; một số locale cần kết nối Internet tới máy chủ Apple.
- Việc Apple hỗ trợ tiếng Việt ở cấp hệ điều hành không chứng minh KakuCut đang chọn đúng locale tiếng Việt, hoạt động offline trên mọi iPhone hoặc tạo phụ đề chính xác. Cần thử một clip tiếng Việt có dấu, tên riêng, số liệu và câu dài.
- Tuyên bố xử lý local và không upload hiện là thông tin do nhà phát triển công bố trên App Store; chưa kiểm toán network traffic độc lập.
- Trang App Store tại thời điểm rà soát chưa có đủ xếp hạng/đánh giá để kết luận độ ổn định hoặc chất lượng sản phẩm.
- KakuCut là ứng viên biên tập/phụ đề, không phải công cụ TTS; không thay thế bước tạo giọng đọc và không giải quyết vấn đề ngữ điệu tự nhiên.

Quyết định:
- Xếp KakuCut vào nhóm `needs_review`, chỉ là ứng viên miễn phí để thử nghiệm cắt ghép/phụ đề trên iPhone.
- Không coi là công cụ đã được phê duyệt sản xuất; chưa có video thử hoặc phụ đề tiếng Việt thực tế được AI Thực Chiến kiểm tra.
- Nếu thử, chỉ dùng video công khai hoặc clip giả lập không chứa dữ liệu cá nhân; xác nhận app có nhận tiếng Việt, chỉnh được từng dòng, đồng bộ timing và xuất MP4/SRT không watermark trước khi cân nhắc sử dụng.
- Không cấp quyền thư viện ảnh/toàn bộ ảnh nếu không cần; chỉ chọn clip thử riêng. Không đăng nhập, mua hàng hoặc bật thanh toán.

**Trạng thái:** candidate only — chưa kiểm thử trực tiếp trên thiết bị, chưa xác nhận tiếng Việt và chưa thay CapCut.



## 5L. Rà soát lại ứng viên dựng video iPhone và đối chứng VN Editor — 17/11/2026

### KakuCut: cập nhật phiên bản và giới hạn ngôn ngữ

Nguồn chính chủ:
- Trang sản phẩm: https://kakucut.com/
- Changelog: https://kakucut.com/changelog/
- Privacy: https://kakucut.com/privacy/
- Support/FAQ: https://kakucut.com/support/
- App Store Việt Nam: https://apps.apple.com/vn/app/kakucut-video-editor/id6811591634

Đối chiếu lại nguồn chính chủ cho thấy KakuCut đã lên phiên bản 1.1.9 ngày 15/11/2026. Nhà phát triển mô tả ứng dụng miễn phí, không watermark, không mua hàng trong ứng dụng, hỗ trợ iPhone iOS 17+, tối đa 10 clip, xuất MP4/SRT, chỉnh phụ đề, voiceover, tỷ lệ 9:16/1:1/16:9 và xử lý media local trên thiết bị. FAQ nói iOS 26 bật đường SpeechAnalyzer on-device chính; việc nhận dạng còn phụ thuộc thiết bị/ngôn ngữ/model speech của Apple.

**Giới hạn quan trọng đối với AI Thực Chiến:** tài liệu/changelog công khai hiện nêu rõ các cập nhật tiếng Nhật, Hàn và Tây Ban Nha; chưa có bằng chứng đủ chắc rằng app đã hỗ trợ nhận dạng phụ đề tiếng Việt trên iPhone của dự án. Không được suy diễn rằng Apple có locale tiếng Việt đồng nghĩa KakuCut đã triển khai tiếng Việt. Vì vậy KakuCut chỉ còn là ứng viên biên tập local; chưa chọn làm công cụ phụ đề chính cho video tiếng Việt.

### VN Video Editor: đối chứng có TTS và auto captions

Nguồn App Store:
- https://apps.apple.com/vn/app/vn-photo-video-editor/id1343581380

App Store hiện mô tả VN Video Editor là ứng dụng miễn phí có mua hàng trong ứng dụng; trang được kiểm tra ghi dung lượng khoảng 683,4 MB và khoảng 325 nghìn lượt đánh giá, 4,8/5. Mô tả liệt kê Auto Captions đa ngôn ngữ, Text-to-Speech, voiceover, timeline nhiều lớp và xuất video tối đa 4K/60fps. Đây là bằng chứng ứng dụng có các tính năng nêu trên, **không phải** bằng chứng giọng TTS tiếng Việt hoặc tính năng phụ đề tiếng Việt được mở miễn phí trên mọi thiết bị.

Rủi ro/điều chưa xác minh:
- Chưa xác nhận danh sách giọng TTS tiếng Việt trên đúng phiên bản iOS và tài khoản tại Việt Nam.
- Chưa xác nhận TTS tiếng Việt, auto-caption tiếng Việt, xuất không watermark và các tính năng cần thiết đều nằm trong gói miễn phí; không được bấm thử mua hoặc kích hoạt trial.
- Dung lượng tải lớn (khoảng 683,4 MB theo App Store tại thời điểm rà soát) không phù hợp để tự động tải trên kết nối di động hoặc khi chưa kiểm tra dung lượng trống.
- Chưa có kiểm toán độc lập về luồng dữ liệu và quyền riêng tư của toàn bộ tính năng AI.

**Quyết định:** đưa VN Video Editor vào danh sách needs_review, chưa cài/tải, chưa cấp quyền, chưa đăng nhập, chưa dùng TTS và chưa dùng để dựng video dự án. Chỉ cân nhắc nếu người dùng đã có sẵn ứng dụng hoặc xác nhận muốn thử; phải kiểm tra đúng tiếng Việt và toàn bộ bước xuất miễn phí trước khi chọn.

### Quyết định công cụ dựng video hiện tại

1. Không chuyển sang VN chỉ vì trang App Store liệt kê TTS/Auto Captions; chưa có xác nhận tiếng Việt và free-tier của từng tính năng.
2. Không chọn KakuCut làm phụ đề tiếng Việt chính cho tới khi có bằng chứng ngôn ngữ cụ thể và thử nghiệm thực tế.
3. Giữ CapCut làm công cụ đã có mẫu TTS để đối chứng; mẫu trước đây được nhận xét rõ tiếng nhưng hơi nhanh và khá máy móc. Chưa đủ điều kiện duyệt giọng.
4. Không tải thêm ứng dụng/model dung lượng lớn, không đăng ký, không cấp quyền rộng hoặc bật thanh toán chỉ để tiếp tục nghiên cứu.
5. Cổng phát hành video vẫn BLOCKED: cần audio nghe/chấm đạt, transcript/phụ đề tiếng Việt được kiểm tra, quyền sử dụng voice/music/assets rõ ràng và bản MP4 Preview được xem lại trước khi lên lịch.

**Kết luận:** chưa có công cụ miễn phí nào được chứng minh đồng thời đáp ứng đủ ba điều kiện: giọng Việt tự nhiên, phụ đề Việt chính xác và dựng/xuất video không watermark trên iPhone. Giữ quy trình ở mức ứng viên và không phát hành khi chưa đủ bằng chứng.

## 5M. Ghi nhận lựa chọn giọng Male 1 — 17/11/2026

- Người dùng đã nghe các mẫu giọng và chọn **Male 1** làm lựa chọn ưu tiên. Giữ nguyên lựa chọn này khi tiếp tục đánh giá; không tự thay bằng giọng khác chỉ vì một công cụ khác có nhãn tương tự.
- Bằng chứng hiện có chưa xác định được nhà cung cấp, model, voice ID, vùng giọng hoặc license gắn với nhãn “Male 1”. Không gán nhãn này cho PyroSoft/Supertonic, CapCut, Speechma, VieNeu-TTS, ZeroTTS, KorvaTTS hay dịch vụ nào nếu chưa có tên chính xác trong giao diện hoặc metadata của tệp.
- Phản hồi nghe thử người dùng đã xác nhận cho mẫu TTS trước đó: **rõ**, **hơi giống giọng máy**, **hơi nhanh**, và được chọn ở mức **miễn phí**. Đây là đánh giá chủ quan của người dùng đối với mẫu đã nghe, không phải benchmark độc lập và chưa xác nhận quyền thương mại của đúng voice.
- Không có audio mới được tạo, tải lên hoặc gửi tới dịch vụ bên ngoài trong lần cập nhật này. Không yêu cầu người dùng gửi lại tệp đã có.
- **Cổng lựa chọn:** Male 1 vẫn là lựa chọn ưu tiên, nhưng chưa được phê duyệt cho video công khai cho tới khi xác định đúng voice/provider, điều khoản sử dụng của voice cụ thể, và nghe/chấm bản xuất dài hơn với cùng bộ câu thử. Không bật Pro, không thanh toán, không thêm phương thức thanh toán.



## 5N. Kiểm thử thực tế PocketPal AI trên iPhone — Alex / Supertonic M1 — 17/11/2026

### Cấu hình người dùng đã xác nhận
- Ứng dụng: PocketPal AI trên iPhone.
- Engine: Supertonic.
- Voice hiển thị: **Alex**; đối chiếu mã nguồn PocketPal xác nhận Alex tương ứng preset **M1 (Male 1)**.
- Ngôn ngữ tổng hợp: **Vietnamese** đã được người dùng chọn trong thiết lập Supertonic.
- Người dùng đã phát thử câu tiếng Việt trực tiếp trên thiết bị và phản hồi nguyên văn: **“Giọng Alex đọc tiếng việt rõ ràng, tự nhiên.”**

### Kết quả và phạm vi kết luận
- **Kết quả nghe thử thực tế do người dùng xác nhận: PASS định tính** về độ rõ và cảm nhận tự nhiên đối với đoạn thử ngắn.
- Đây là kết quả nghe trực tiếp trên thiết bị của người dùng, có giá trị hơn việc chỉ suy luận từ model card hoặc mã nguồn. Tuy nhiên, không có tệp âm thanh mẫu được lưu/đính kèm trong repository, nên chưa thể đo độc lập tốc độ, độ ổn định, clipping, độ đồng nhất giữa nhiều đoạn hoặc chất lượng phát âm tên riêng/số liệu.
- Chốt **Alex / M1 + Vietnamese trong PocketPal** làm cấu hình TTS ưu tiên cho video thử nghiệm tiếp theo. Không thay bằng CapCut, Speechma, PyroSoft hoặc dịch vụ khác nếu không có lý do kỹ thuật và kết quả nghe so sánh tốt hơn.
- Giữ nguyên nguyên tắc không sử dụng API TTS trả phí, không bật billing, không mua PocketPal Plus/Pals, không dùng PalsHub hoặc remote inference. Không nhập dữ liệu riêng tư vào tính năng online.

### Việc còn phải xác minh trước khi dựng video
1. Xác minh PocketPal có chức năng xuất/chia sẻ tệp âm thanh TTS hay chỉ phát trong ứng dụng; không giả định có nút Export nếu chưa kiểm tra.
2. Nếu có thể xuất audio, kiểm tra định dạng, sample rate, thời lượng và nghe lại tệp xuất.
3. Kiểm tra một đoạn lời thoại 30–60 giây có số liệu, tên riêng và thuật ngữ; không chỉ dựa vào một câu ngắn.
4. Tạo transcript từ chính lời thoại đã được chốt, sau đó căn SRT theo audio thực tế; không tạo timestamp ước lượng rồi tuyên bố đã đồng bộ.
5. Dựng MP4 Preview bằng tài nguyên có quyền sử dụng rõ ràng; kiểm tra hình, tiếng, phụ đề và watermark/giới hạn xuất trên phương án miễn phí.
6. Người biên tập nghe/xem duyệt bản cuối trước mọi quyết định công khai.

### Trạng thái cổng phát hành
- TTS engine + voice + language trên iPhone: **đã xác nhận hoạt động theo phản hồi người dùng**.
- Độ rõ/tự nhiên đoạn thử ngắn: **PASS định tính theo người dùng**.
- Xuất audio từ PocketPal, kiểm thử đoạn dài, đồng bộ SRT, dựng MP4, license từng asset và duyệt video cuối: **CHƯA XÁC MINH**.
- Vì vậy, chỉ mở cổng **chuẩn bị video Preview**, chưa mở cổng đăng công khai. PR vẫn Draft; không merge, không deploy Production và không đăng bài/video công khai.



## 5O. Kiểm tra khả năng xuất tệp âm thanh PocketPal — rà soát mã nguồn 17/11/2026

Đã kiểm tra đường phát TTS trong PocketPal tại commit mã nguồn `c076d8d66f334a3e6288a9fce0e3a21036c3249d`:
- `TTSStore.play()` gọi engine để phát một utterance và quản lý trạng thái playback.
- `SupertonicEngine.play()` gọi `Speech.speak(text, voice.id, { language, inferenceSteps })`; đây là đường phát âm thanh, không phải API xuất MP3/WAV.
- Trong các đường mã nguồn đã kiểm tra, chưa tìm thấy chức năng lưu/chia sẻ trực tiếp audio TTS thành tệp. Kết luận này giới hạn ở các tệp/đường phát đã rà soát; không khẳng định mọi phiên bản ứng dụng đều không có tính năng khác ở giao diện.

**Hệ quả:** không hướng dẫn người dùng tìm nút Export/Share chưa được xác minh. Trước mắt, PocketPal đã đạt bước chọn giọng và nghe thử; khả năng đưa audio ra trình dựng video vẫn là blocker kỹ thuật cần kiểm tra. Không ghi âm màn hình hoặc dùng mẹo thu âm làm phương án mặc định khi chưa xác nhận chất lượng, quyền ghi âm và khả năng tách âm thanh.

**Phương án tiếp theo:** kiểm tra một đường chuyển giao audio miễn phí, ít thao tác trên iPhone và không gửi nội dung riêng tư lên dịch vụ ngoài. Chỉ chọn phương án sau khi xác minh được file âm thanh thực sự có thể đưa vào trình dựng video và nghe lại được. Không dùng TTS trả phí, không yêu cầu cài thêm ứng dụng lớn hoặc cấp quyền rộng nếu chưa cần.

Nguồn mã nguồn:
- TTSStore playback: https://github.com/a-ghorbani/pocketpal-ai/blob/c076d8d66f334a3e6288a9fce0e3a21036c3249d/src/store/TTSStore.ts
- Supertonic playback engine: https://github.com/a-ghorbani/pocketpal-ai/blob/c076d8d66f334a3e6288a9fce0e3a21036c3249d/src/services/tts/engines/supertonic/index.ts
