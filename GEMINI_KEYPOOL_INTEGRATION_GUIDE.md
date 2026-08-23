# 📘 HƯỚNG DẪN TÍCH HỢP GEMINI API KEY POOL (CHUẨN MODULAR)
> **Dành cho Lập trình viên & AI Assistant**: Bản thiết kế và mã nguồn mẫu chuẩn (Drop-in Ready) để tích hợp cơ chế xoay vòng đa API Key (Key Pool Rotation), chống lỗi 429 / 403, kiểm tra độ trễ và hỗ trợ đa Model vào bất kỳ dự án nào (Python, Node.js hoặc Pure JavaScript).

---

## 🎯 1. PROMPT MẪU ĐỂ GỬI CHO AI (COPY & PASTE NGAY)
*Khi bạn muốn một AI khác tích hợp cơ chế này vào dự án mới, hãy copy toàn bộ đoạn trong khung dưới đây gửi cho AI đó:*

```text
Hãy tích hợp module Gemini API với cơ chế Key Pool (xoay vòng đa API Key) theo các yêu cầu sau:
1. Hỗ trợ dán nhiều Gemini API Key (mỗi dòng 1 key).
2. Tự động xoay vòng sang Key tiếp theo (Key Rotation) khi gặp lỗi Rate Limit (429/Resource Exhausted) hoặc Key lỗi/hết hạn (400/401/403).
3. Hỗ trợ danh mục model đầy đủ: gemini-2.5-flash-lite (mặc định), gemini-3.5-flash-lite, gemini-2.5-flash, gemini-3.6-flash, gemini-2.0-flash, gemini-1.5-flash.
4. Xây dựng hàm test_connection đo độ trễ mạng (ping latency ms) và kiểm tra key sống/chết.
5. Tạo giao diện Modal cài đặt gồm: Dropdown chọn Model, Textarea nhập danh sách Key, Badge đếm số Key sẵn sàng, Nút "Kiểm tra kết nối", lưu vào localStorage.
```

---

## 🐍 2. MÃ NGUỒN CHUẨN PYTHON (Dành cho Backend FastAPI / Flask / Script)

Tạo tệp `gemini_client.py` (chỉ cần thư viện chuẩn + `requests`):

```python
"""
Module GeminiClient & GeminiKeyPool chuẩn độc lập.
"""
import json
import logging
import os
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Union
import requests

logger = logging.getLogger(__name__)

BASE_API_URL = "https://generativelanguage.googleapis.com/v1beta/models"

AVAILABLE_GEMINI_MODELS: List[Dict[str, Any]] = [
    {"id": "gemini-2.5-flash-lite", "name": "Gemini 2.5 Flash Lite (Siêu nhanh, 15 RPM / 500 RPD - Khuyên dùng)", "highlight": True},
    {"id": "gemini-3.5-flash-lite", "name": "Gemini 3.5 Flash Lite (Tối ưu)", "highlight": True},
    {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash (Chất lượng cao)", "highlight": False},
    {"id": "gemini-3.6-flash", "name": "Gemini 3.6 Flash (Mới nhất)", "highlight": False},
    {"id": "gemini-3.7-flash", "name": "Gemini 3.7 Flash", "highlight": False},
    {"id": "gemini-2.0-flash", "name": "Gemini 2.0 Flash (Chuẩn)", "highlight": False},
    {"id": "gemini-1.5-flash", "name": "Gemini 1.5 Flash (Ổn định)", "highlight": False},
]

class GeminiKeyPool:
    def __init__(self, keys: Optional[Union[List[str], str]] = None):
        self._keys: List[str] = []
        self._lock = threading.Lock()
        self._current_index = 0
        if keys:
            self.set_keys(keys)

    def set_keys(self, keys: Union[List[str], str]):
        with self._lock:
            if isinstance(keys, str):
                raw = keys.replace(",", "\n").split("\n")
            else:
                raw = list(keys)
            self._keys = [k.strip() for k in raw if k and k.strip()]
            self._current_index = 0

    @property
    def total_keys(self) -> int:
        with self._lock:
            return len(self._keys)

    def get_active_key(self) -> Optional[str]:
        with self._lock:
            if not self._keys:
                return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
            return self._keys[self._current_index % len(self._keys)]

    def rotate_key(self) -> bool:
        with self._lock:
            if len(self._keys) > 1:
                self._current_index = (self._current_index + 1) % len(self._keys)
                logger.info(f"Đã xoay sang Key #{self._current_index + 1}/{len(self._keys)}")
                return True
            return False

    @staticmethod
    def mask_key(key: Optional[str]) -> str:
        if not key:
            return "Chưa có Key"
        if len(key) <= 10:
            return key
        return f"{key[:7]}...{key[-4:]}"

    def get_keys_info(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [
                {
                    "index": i + 1,
                    "masked": self.mask_key(k),
                    "is_active": (i == (self._current_index % max(1, len(self._keys)))),
                }
                for i, k in enumerate(self._keys)
            ]


class GeminiClient:
    def __init__(self, key_pool: Optional[GeminiKeyPool] = None, default_model: str = "gemini-2.5-flash-lite"):
        self.key_pool = key_pool or GeminiKeyPool()
        self.default_model = default_model

    def call_with_retry(self, api_fn: Callable[[str], Any], max_retries: int = 3) -> Any:
        effective_retries = max(max_retries, self.key_pool.total_keys + 1)
        delay = 2.0

        for attempt in range(1, effective_retries + 1):
            key = self.key_pool.get_active_key()
            if not key:
                raise RuntimeError("Chưa cấu hình Gemini API Key.")

            try:
                return api_fn(key)
            except Exception as error:
                err_msg = str(error).lower()
                is_rate_limit = "429" in err_msg or "resource_exhausted" in err_msg or "quota" in err_msg
                is_key_invalid = any(e in err_msg for e in ["403", "permission_denied", "400", "api_key_invalid", "401"])

                if is_rate_limit or is_key_invalid:
                    if self.key_pool.rotate_key():
                        time.sleep(0.8)
                        continue

                if attempt < effective_retries:
                    time.sleep(delay)
                    delay = min(10.0, delay * 1.5)
                else:
                    raise error

    def generate_content(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_output_tokens: int = 4096,
        json_mode: bool = False,
        timeout_sec: int = 30,
    ) -> str:
        effective_model = model or self.default_model

        def _execute(api_key: str) -> str:
            url = f"{BASE_API_URL}/{effective_model}:generateContent?key={api_key}"
            payload: Dict[str, Any] = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": temperature,
                    "maxOutputTokens": max_output_tokens,
                },
            }
            if json_mode:
                payload["generationConfig"]["responseMimeType"] = "application/json"
            if system_instruction:
                payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}

            resp = requests.post(url, json=payload, timeout=timeout_sec)
            if resp.status_code != 200:
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text}")

            data = resp.json()
            candidates = data.get("candidates", [])
            if not candidates:
                raise RuntimeError("Gemini trả về kết quả rỗng.")
            parts = candidates[0].get("content", {}).get("parts", [])
            if not parts:
                raise RuntimeError("Gemini trả về nội dung rỗng.")
            return parts[0].get("text", "").strip()

        return self.call_with_retry(_execute)

    def test_connection(self, api_key: Optional[str] = None, model: Optional[str] = None) -> Dict[str, Any]:
        target_key = api_key or self.key_pool.get_active_key()
        if not target_key:
            return {"success": False, "error": "Chưa có API Key để kiểm tra."}

        target_model = model or self.default_model
        url = f"{BASE_API_URL}/{target_model}:generateContent?key={target_key}"
        payload = {
            "contents": [{"parts": [{"text": "Ping"}]}],
            "generationConfig": {"maxOutputTokens": 5, "temperature": 0.1},
        }

        start_time = time.time()
        try:
            resp = requests.post(url, json=payload, timeout=10)
            latency_ms = round((time.time() - start_time) * 1000)
            if resp.status_code == 200:
                return {
                    "success": True,
                    "model": target_model,
                    "latency_ms": latency_ms,
                    "masked_key": GeminiKeyPool.mask_key(target_key),
                }
            return {"success": False, "status_code": resp.status_code, "error": resp.text, "latency_ms": latency_ms}
        except Exception as e:
            return {"success": False, "error": str(e), "latency_ms": round((time.time() - start_time) * 1000)}
```

---

## 🌐 3. MÃ NGUỒN CHUẨN JAVASCRIPT / TYPESCRIPT (Frontend hoặc Node.js)

Tạo tệp `geminiService.js`:

```javascript
/**
 * Gemini Service với Key Pool và Error Recovery
 */
class GeminiKeyPool {
  constructor(keys = []) {
    this.keys = [];
    this.currentIndex = 0;
    this.setKeys(keys);
  }

  setKeys(keysInput) {
    if (typeof keysInput === 'string') {
      this.keys = keysInput.replace(/,/g, '\n').split('\n').map(k => k.trim()).filter(Boolean);
    } else if (Array.isArray(keysInput)) {
      this.keys = keysInput.map(k => String(k).trim()).filter(Boolean);
    }
    this.currentIndex = 0;
  }

  get totalKeys() {
    return this.keys.length;
  }

  getActiveKey() {
    if (!this.keys.length) return null;
    return this.keys[this.currentIndex % this.keys.length];
  }

  rotateKey() {
    if (this.keys.length > 1) {
      this.currentIndex = (this.currentIndex + 1) % this.keys.length;
      console.log(`[GeminiKeyPool] Đã xoay sang Key #${this.currentIndex + 1}/${this.keys.length}`);
      return true;
    }
    return false;
  }

  maskKey(key) {
    if (!key) return 'Chưa có Key';
    if (key.length <= 10) return key;
    return `${key.slice(0, 7)}...${key.slice(-4)}`;
  }
}

class GeminiService {
  constructor(keyPool = null, defaultModel = 'gemini-2.5-flash-lite') {
    this.keyPool = keyPool || new GeminiKeyPool();
    this.defaultModel = defaultModel;
  }

  async generateContent({ prompt, systemInstruction, model, temperature = 0.7, jsonMode = false }) {
    const effectiveModel = model || this.defaultModel;
    const maxRetries = Math.max(3, this.keyPool.totalKeys + 1);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const apiKey = this.keyPool.getActiveKey();
      if (!apiKey) throw new Error('Chưa cấu hình Gemini API Key.');

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent?key=${apiKey}`;
        const payload = {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: temperature,
            maxOutputTokens: 4096,
            ...(jsonMode ? { responseMimeType: 'application/json' } : {})
          },
          ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {})
        };

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errText}`);
        }

        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Gemini trả về nội dung rỗng.');
        return text.trim();
      } catch (err) {
        const msg = String(err).toLowerCase();
        const isRateLimit = msg.includes('429') || msg.includes('resource_exhausted');
        const isKeyInvalid = msg.includes('403') || msg.includes('400') || msg.includes('401') || msg.includes('api_key_invalid');

        if ((isRateLimit || isKeyInvalid) && this.keyPool.rotateKey()) {
          await new Promise(r => setTimeout(r, 800));
          continue;
        }

        if (attempt === maxRetries) throw err;
        await new Promise(r => setTimeout(r, 1500 * attempt));
      }
    }
  }

  async testConnection(apiKey, model = 'gemini-2.5-flash-lite') {
    const targetKey = apiKey || this.keyPool.getActiveKey();
    if (!targetKey) return { success: false, error: 'Chưa có API Key để kiểm tra.' };

    const start = performance.now();
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${targetKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Ping' }] }],
          generationConfig: { maxOutputTokens: 5, temperature: 0.1 }
        })
      });

      const latencyMs = Math.round(performance.now() - start);
      if (res.ok) {
        return { success: true, model, latencyMs, maskedKey: this.keyPool.maskKey(targetKey) };
      }
      return { success: false, status: res.status, error: await res.text(), latencyMs };
    } catch (e) {
      return { success: false, error: e.message, latencyMs: Math.round(performance.now() - start) };
    }
  }
}
```

---

## 🎨 4. GIAO DIỆN HTML/CSS MODAL (Dùng cho Web App)

```html
<!-- Nút mở Modal -->
<button id="btnOpenGeminiModal" class="btn">
  🔑 Cài đặt Gemini AI (<span id="geminiKeyCountBadge">0 Key</span>)
</button>

<!-- Modal Cấu hình -->
<div class="modal-backdrop" id="geminiModalBackdrop" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 999; align-items: center; justify-content: center;">
  <div class="modal-box" style="background: #18181b; color: #fff; padding: 20px; border-radius: 12px; max-width: 500px; width: 90%; border: 1px solid #3f3f46;">
    <h3>🔑 Cấu hình Gemini AI & Key Pool</h3>
    
    <label style="margin-top: 12px; display: block; font-size: 12px;">Model Gemini:</label>
    <select id="geminiModelSelect" style="width: 100%; padding: 8px; background: #27272a; color: #fff; border: 1px solid #3f3f46; border-radius: 6px;">
      <option value="gemini-2.5-flash-lite" selected>⚡ Gemini 2.5 Flash Lite (Siêu nhanh, 15 RPM / 500 RPD - Khuyên dùng)</option>
      <option value="gemini-3.5-flash-lite">⚡ Gemini 3.5 Flash Lite (Tối ưu)</option>
      <option value="gemini-2.5-flash">🌟 Gemini 2.5 Flash (Chất lượng cao)</option>
      <option value="gemini-3.6-flash">🌟 Gemini 3.6 Flash (Mới nhất)</option>
      <option value="gemini-2.0-flash">💎 Gemini 2.0 Flash (Chuẩn)</option>
      <option value="gemini-1.5-flash">💎 Gemini 1.5 Flash (Ổn định)</option>
    </select>

    <div style="display: flex; justify-content: space-between; margin-top: 12px;">
      <label style="font-size: 12px;">Danh sách API Keys (Mỗi dòng 1 Key):</label>
      <span id="geminiPoolBadge" style="font-size: 12px; color: #34d399;">0 Key sẵn sàng</span>
    </div>
    <textarea id="geminiKeysInput" rows="5" placeholder="AIzaSy...&#10;AIzaSy..." style="width: 100%; font-family: monospace; font-size: 11px; padding: 8px; background: #27272a; color: #fff; border: 1px solid #3f3f46; border-radius: 6px;"></textarea>
    
    <div id="geminiTestStatus" style="display: none; margin-top: 8px; padding: 6px 10px; border-radius: 6px; font-size: 11px;"></div>

    <div style="display: flex; justify-content: space-between; margin-top: 16px;">
      <button id="btnTestGemini" style="padding: 6px 12px; background: #2563eb; color: #fff; border: none; border-radius: 6px; cursor: pointer;">⚡ Kiểm tra kết nối</button>
      <div>
        <button id="btnCloseGeminiModal" style="padding: 6px 12px; background: #3f3f46; color: #fff; border: none; border-radius: 6px; margin-right: 6px; cursor: pointer;">Đóng</button>
        <button id="btnSaveGemini" style="padding: 6px 12px; background: #059669; color: #fff; border: none; border-radius: 6px; cursor: pointer;">Lưu Cấu Hình</button>
      </div>
    </div>
  </div>
</div>
```

---

## 📌 5. DANH SÁCH CÁC MODEL GEMINI KHUYÊN DÙNG (CẬP NHẬT 2026)

| Model ID | Hạn mức Free Tier | Tốc độ | Mục đích tối ưu |
| :--- | :--- | :--- | :--- |
| **`gemini-2.5-flash-lite`** | **15 RPM / 500 RPD** | **~0.3s** | **Khuyên dùng số 1** cho các tác vụ dịch, rút gọn, xử lý hàng loạt. |
| **`gemini-3.5-flash-lite`** | **15 RPM / 500 RPD** | **~0.35s** | Thế hệ mới tối ưu tốc độ và chi phí. |
| **`gemini-2.5-flash`** | **10 RPM / 250 RPD** | **~0.6s** | Khả năng lập luận cao, viết văn trau chuốt. |
| **`gemini-3.6-flash`** | **10 RPM / 250 RPD** | **~0.5s** | Xử lý đa phương tiện và logic phức tạp. |
| **`gemini-2.0-flash`** | **15 RPM / 1,500 RPD** | **~0.5s** | Chuẩn công nghiệp đa dụng. |
