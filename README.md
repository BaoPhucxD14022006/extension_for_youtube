# CinemaSub - Phụ Đề AI Cho YouTube (Vietsub Phim Chiếu Rạp)

Extension Chrome giúp biến phụ đề YouTube rời rạc, dịch thô thiển thành **phụ đề tiếng Việt nguyên câu chuẩn phim chiếu rạp** nhờ mô hình trí tuệ nhân tạo chuyên dụng **NVIDIA NIM (Riva-Translate-4B-Instruct-v2)** hoặc Google Gemini.

---

## 🌟 Tính Năng Nổi Bật

1. **Hỗ trợ NVIDIA NIM & Riva-Translate-4B-Instruct-v2**:
   - Sử dụng model chuyên dụng dịch thuật ngôn ngữ cao cấp của NVIDIA, cực nhẹ, độ trễ cực thấp.
   - Hỗ trợ cả các mô hình lớn như Meta LLaMA 3.1 8B và Mistral NeMo 12B trên NVIDIA NIM.
   - Vẫn hỗ trợ dự phòng Google Gemini (Gemini 2.0 Flash / 1.5 Flash).
2. **Kiến trúc trích xuất 3 tầng (Multi-Tier Transcript Engine)**:
   - Tầng 1: Bắt gói tin mạng chứa PO Token chuẩn xịn từ YouTube Player.
   - Tầng 2: Cào trực tiếp từ Bảng Lời Thoại DOM (Native Transcript Panel) của YouTube – miễn nhiễm với mọi lớp chống bot.
   - Tầng 3: Tải trực tiếp có bù tham số client `c=WEB`.
3. **Ghép câu tự nhiên (Smart Sentence Segmentation)**: Không còn tình trạng ngắt vụn 2–3 từ/dòng như YouTube mặc định. Tái cấu trúc câu hoàn chỉnh có dấu chấm, phẩy rõ ràng.
4. **Phụ đề chuẩn rạp chiếu phim**:
   - Chữ vàng điện ảnh (`#FCD34D`) hoặc trắng tinh khôi, đổ bóng viền đen sắc nét chống lóa trên mọi nền sáng/tối.
   - Nền mờ kính mờ cao cấp (Glassmorphism backdrop).
   - Tự động hạ xuống khi thanh điều khiển YouTube ẩn đi.
5. **Hỗ trợ Song ngữ (Bilingual Mode)**: Hiển thị cả câu tiếng Anh gốc và câu tiếng Việt bên dưới – cực kỳ hữu ích cho việc luyện nghe và học từ vựng.
6. **Dịch theo luồng (Chunk Streaming) & Bộ nhớ tạm (Cache)**:
   - Dịch ngay 1 phút đầu tiên chỉ sau 1.5–2 giây để bạn xem được ngay lập tức, sau đó dịch ngầm toàn bộ video trong nền.
   - Lưu trữ bản dịch vào bộ nhớ máy, xem lại lần sau tốn **0 token**.
7. **Nút điều khiển trực tiếp trên YouTube**: Tích hợp nút 🎬 ngay trên thanh điều khiển YouTube cạnh nút bánh răng cài đặt.

---

## 🚀 Hướng Dẫn Cài Đặt & Sử Dụng

### Bước 1: Nạp Extension vào trình duyệt
1. Mở trình duyệt và truy cập: `chrome://extensions/`
2. Bật công tắc **Developer mode (Chế độ cho nhà phát triển)** ở góc trên bên phải.
3. Bấm nút **Load unpacked (Tải tiện ích đã giải nén)** ở góc trên bên trái.
4. Chọn thư mục dự án này: `d:\Extention for learning`

### Bước 2: Cài đặt NVIDIA API Key
1. Bấm vào icon của Extension **CinemaSub 🎬** trên thanh tiện ích trình duyệt.
2. Chọn provider: **🟢 NVIDIA NIM (Khuyên dùng)**.
3. Dán key NVIDIA của bạn (dạng `nvapi-...`) vào ô API Key.
4. Model mặc định sẽ là: `nvidia/riva-translate-4b-instruct-v2` (hoặc bạn có thể chọn `meta/llama-3.1-8b-instruct`).
5. Bấm nút **Kiểm tra kết nối** (Sẽ hiện thông báo xanh: *Kết nối NVIDIA API thành công!*).

### Bước 3: Trải nghiệm trên YouTube
1. Mở bất kỳ video tiếng Anh nào trên YouTube.
2. Extension sẽ tự động:
   - Bắt transcript qua kiến trúc đa tầng.
   - Dùng Riva-Translate-4B dịch các câu mượt mà sang tiếng Việt.
   - Hiển thị phụ đề rạp chiếu phim đồng bộ chuẩn từng giây lên video.
