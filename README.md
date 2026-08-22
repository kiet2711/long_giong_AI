# 🎬 AI Dubbing & Video Sync Studio (Công cụ Lồng tiếng AI Siêu Tốc)

> **Công cụ tự động lồng tiếng video bằng giọng đọc AI CapCut / ByteDance**, đồng bộ chuẩn từng khung hình, hỗ trợ tăng giảm tốc độ âm thanh/video thông minh, xuất video chất lượng cao kèm file phụ đề `.srt` rời.

---

## 🌟 Tính Năng Nổi Bật

- ⚡ **Kiến Trúc Single-Pass FilterGraph (Tốc độ CapCut)**: 
  - Toàn bộ timeline video được xử lý và nối trong **một lệnh FFmpeg duy nhất** qua `-filter_complex_script`.
  - Chỉ 1 lần decode + 1 lần encode toàn bộ $\rightarrow$ chỉ khởi tạo 1 phiên GPU NVENC/QSV/AMF duy nhất, không cắt xuất nhiều file video vụn.
- 🚀 **Chế độ Siêu Tốc (Lossless Stream Copy `-c:v copy`)**:
  - Khi không cần thay đổi tốc độ khung hình video (tất cả câu thoại khớp 1.0x), video gốc được giữ nguyên 100% chất lượng gốc và xuất file thành phẩm chỉ trong **~0.5 giây**!
- 🎯 **Đồng Bộ Tuyệt Đối (Độ lệch `0.000000s Drift`)**:
  - Âm thanh trung gian được render dưới dạng **Uncompressed PCM WAV 48.000Hz 16-bit**.
  - Kết hợp bộ lọc `apad/atrim` và bù đắp sample-accurate, loại bỏ hoàn toàn hiện tượng lệch tiếng tích lũy do AAC Priming Delay.
- 🎙️ **24+ Giọng Đọc AI CapCut / ByteDance Đỉnh Cao**:
  - Đầy đủ các giọng Nam/Nữ Bắc, Trung, Nam: *Nhỏ Ngọt Ngào, Thanh Niên Tự Tin, Cô Gái Hoạt Bát, Nam Kể Chuyện, Chú Đầy Sức Sống, v.v.*
  - Tự động Fake Device ID và Token liên tục để vượt rate-limit và chặn IP.
- 🎛️ **Dual-Range Slider Linh Hoạt**:
  - Tùy chỉnh phạm vi tốc độ giọng AI (ví dụ: `0.75x – 1.25x`) và phạm vi tốc độ video (ví dụ: `0.50x – 1.50x`) trên thanh trượt trực quan.
- 🛡️ **Cơ Chế Gom Lỗi & Thử Lại Thông Minh (`Failed Review Box`)**:
  - Tự động thử lại 5 lần nếu nghẽn mạng.
  - Các câu thành công được **lưu cache 100%**; các câu bị CapCut từ chối (từ nhạy cảm, icon) được gom lại để người dùng **sửa trực tiếp trên bảng** và bấm tạo lại riêng câu đó mà không phải chạy lại từ đầu.
- 📄 **Tự Động Xuất File Phụ Đề `.srt` Rời**:
  - Video xuất ra là video sạch 100% (không dính hardsub).
  - Tự động tính toán lại toàn bộ Timecode theo video mới và xuất file `.srt` chuẩn xác để kéo thả vào Premiere/CapCut.
- 🔄 **Khôi Phục Tiến Độ (Floating Widget & LocalStorage)**:
  - Khi đang render, bạn có thể đóng cửa sổ hoặc tải lại trang web; tiến trình tự động thu nhỏ thành widget nổi góc phải màn hình và tự kết nối lại WebSocket.
- 🧹 **Tự Động & Thủ Công Dọn Dẹp Rác Bộ Nhớ (`Cleanup`)**:
  - Nút dọn rác 1-click giải phóng dung lượng ổ đĩa tức thì.

---

## 🛠️ Yêu Cầu Hệ Thống

1. **Hệ điều hành**: Windows 10/11, macOS, hoặc Linux.
2. **Python**: Phiên bản 3.9 trở lên.
3. **FFmpeg**: Đã cài đặt và thêm vào biến môi trường `PATH`.
   - *Kiểm tra bằng cách mở Terminal / Command Prompt gõ:* `ffmpeg -version`

---

## 🚀 Hướng Dẫn Cài Đặt & Khởi Chạy

### 1. Clone repository về máy
```bash
git clone https://github.com/kiet2711/long_giong_AI.git
cd long_giong_AI
```

### 2. Cài đặt các thư viện Python cần thiết
```bash
pip install -r requirements.txt
```

### 3. Khởi chạy ứng dụng
```bash
python server.py
```
*(Hoặc dùng lệnh uvicorn:)*
```bash
uvicorn server:app --host 127.0.0.1 --port 8000 --reload
```

### 4. Mở trình duyệt web
Truy cập vào địa chỉ: **[http://127.0.0.1:8000](http://127.0.0.1:8000)**

---

## 📖 Hướng Dẫn Sử Dụng

1. **Tải lên File Video & SRT**:
   - Chọn file video gốc (`.mp4`, `.mkv`, `.webm`,...).
   - Chọn file phụ đề lồng tiếng (`.srt`).
   - *(Tùy chọn)*: Chọn thêm file phụ đề gốc nếu muốn hiển thị đối chiếu song ngữ.
2. **Cấu hình Giọng đọc & Âm lượng**:
   - Chọn giọng đọc AI mong muốn từ danh mục 24+ giọng CapCut.
   - Bấm nút **"Nghe thử"** để nghe mẫu giọng.
   - Điều chỉnh âm lượng video gốc (Background Music) và âm lượng giọng lồng tiếng.
   - Điều chỉnh thanh kéo tốc độ cho phép của giọng đọc và video.
3. **Bắt đầu Lồng tiếng**:
   - Bấm nút **"Bắt đầu Lồng tiếng & Ghép Video"**.
   - Xem tiến độ thời gian thực trên thanh loading hoặc widget góc màn hình.
4. **Xử lý câu lỗi (nếu có)**:
   - Nếu có câu dính từ cấm bị CapCut từ chối $\rightarrow$ sửa trực tiếp chữ trong ô nhập và bấm **"Thử lại"**.
   - Bấm **"Thử tạo lại tất cả câu lỗi"** hoặc bấm **"Bỏ qua & Tiếp tục Render"**.
5. **Tải thành phẩm**:
   - Tải file **Video MP4** (video sạch đã lồng tiếng).
   - Tải file **Phụ đề SRT** (timecode chuẩn xác khớp 100% theo video mới).

---

## 📂 Cấu Trúc Thư Mục Dự Án

```text
long_giong_AI/
├── core/
│   ├── ffmpeg_engine.py    # Engine FFmpeg Single-Pass, phát hiện GPU NVENC, hòa trộn audio PCM WAV
│   ├── srt_parser.py       # Bộ phân tích phụ đề SRT, chia timeline GAP/DUB & xuất SRT đồng bộ
│   └── tts_client.py       # Client kết nối ByteDance/CapCut TTS API đa luồng kèm cơ chế tự cứu
├── static/
│   ├── app.js              # Xử lý giao diện web, Dual Slider, WebSocket stream & Subtitle preview
│   ├── style.css           # Giao diện Dark Mode, Glassmorphism, Floating Widget
│   └── index.html          # Giao diện chính của ứng dụng
├── temp/
│   ├── uploads/            # Chứa file video & srt gốc tải lên
│   ├── outputs/            # Chứa file dubbed_xxx.mp4 và dubbed_xxx.srt thành phẩm
│   └── jobs/               # Chứa các file tạm trong quá trình render (tự động dọn dẹp)
├── server.py               # FastAPI Backend Server & WebSocket Broadcaster
├── requirements.txt        # Danh sách thư viện Python phụ thuộc
└── README.md               # Tài liệu hướng dẫn sử dụng
```

---

## 📄 Bản Quyền & Giấy Phép
Dự án được phát triển phục vụ mục đích học tập, nghiên cứu và tự động hóa sáng tạo nội dung video.
