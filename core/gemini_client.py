"""
Gemini AI Client & Key Pool Foundation.
Standardized architecture inspired by truyen-ngan:
1. Multi-key pool with thread-safe rotation on Rate Limits (429) & Auth/Quota errors (400, 401, 403).
2. Comprehensive support for all current Gemini models (Flash Lite, Flash, Pro).
3. Generic content generation (standard text & JSON mode) with automatic retry and failover.
4. Connection testing and latency benchmarking.
"""

import concurrent.futures
import json
import logging
import os
import re
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Tuple, Union
import requests


logger = logging.getLogger(__name__)

BASE_API_URL = "https://generativelanguage.googleapis.com/v1beta/models"

AVAILABLE_GEMINI_MODELS: List[Dict[str, Any]] = [
    {
        "id": "gemini-2.5-flash-lite",
        "name": "Gemini 2.5 Flash Lite (Siêu nhanh, 15 RPM / 500 RPD - Khuyên dùng)",
        "highlight": True,
    },
    {
        "id": "gemini-3.5-flash-lite",
        "name": "Gemini 3.5 Flash Lite (Tối ưu)",
        "highlight": True,
    },
    {
        "id": "gemini-2.5-flash",
        "name": "Gemini 2.5 Flash (Chất lượng cao)",
        "highlight": False,
    },
    {
        "id": "gemini-3.6-flash",
        "name": "Gemini 3.6 Flash (Mới nhất)",
        "highlight": False,
    },
    {
        "id": "gemini-3.7-flash",
        "name": "Gemini 3.7 Flash",
        "highlight": False,
    },
    {
        "id": "gemini-2.0-flash",
        "name": "Gemini 2.0 Flash (Chuẩn)",
        "highlight": False,
    },
    {
        "id": "gemini-1.5-flash",
        "name": "Gemini 1.5 Flash (Ổn định)",
        "highlight": False,
    },
]


class GeminiKeyPool:
    """
    Thread-safe API Key Pool with automatic rotation and failover on rate limits / invalid keys.
    """

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

    def get_keys(self) -> List[str]:
        with self._lock:
            return list(self._keys)

    def get_active_key(self) -> Optional[str]:
        with self._lock:
            if not self._keys:
                return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
            return self._keys[self._current_index % len(self._keys)]

    def rotate_key(self) -> bool:
        with self._lock:
            if len(self._keys) > 1:
                self._current_index = (self._current_index + 1) % len(self._keys)
                logger.info(f"Đã xoay sang Gemini API Key #{self._current_index + 1}/{len(self._keys)}")
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
    """
    Versatile Gemini Client supporting Key Rotation, Multi-model execution,
    and automatic error recovery.
    """

    def __init__(
        self,
        key_pool: Optional[GeminiKeyPool] = None,
        default_model: str = "gemini-2.5-flash-lite",
    ):
        self.key_pool = key_pool or GeminiKeyPool()
        self.default_model = default_model

    def call_with_retry(
        self,
        api_fn: Callable[[str], Any],
        max_retries: int = 3,
    ) -> Any:
        """
        Call Gemini API with automatic key rotation and backoff on 429/403/400/401 errors.
        """
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
                logger.warning(f"Lỗi gọi Gemini API (Lần {attempt}/{effective_retries}): {error}")

                is_rate_limit = (
                    "429" in err_msg
                    or "resource_exhausted" in err_msg
                    or "quota" in err_msg
                )
                is_key_invalid = (
                    "403" in err_msg
                    or "permission_denied" in err_msg
                    or "denied access" in err_msg
                    or "400" in err_msg
                    or "api_key_invalid" in err_msg
                    or "invalid_argument" in err_msg
                    or "401" in err_msg
                )

                if is_rate_limit or is_key_invalid:
                    rotated = self.key_pool.rotate_key()
                    if rotated:
                        logger.info(
                            f"Tự động chuyển API Key tiếp theo do gặp lỗi {'Key hỏng/hết hạn' if is_key_invalid else 'Rate Limit (429)'}."
                        )
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
        """
        Generate content using the active model and key pool.
        """
        effective_model = model or self.default_model

        def _execute(api_key: str) -> str:
            url = f"{BASE_API_URL}/{effective_model}:generateContent?key={api_key}"
            payload: Dict[str, Any] = {
                "contents": [
                    {"parts": [{"text": prompt}]}
                ],
                "generationConfig": {
                    "temperature": temperature,
                    "maxOutputTokens": max_output_tokens,
                },
            }

            if json_mode:
                payload["generationConfig"]["responseMimeType"] = "application/json"

            if system_instruction:
                payload["systemInstruction"] = {
                    "parts": [{"text": system_instruction}]
                }

            resp = requests.post(url, json=payload, timeout=timeout_sec)
            if resp.status_code != 200:
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text}")

            data = resp.json()
            candidates = data.get("candidates", [])
            if not candidates:
                raise RuntimeError("Gemini trả về kết quả rỗng (empty candidates).")

            parts = candidates[0].get("content", {}).get("parts", [])
            if not parts:
                raise RuntimeError("Gemini trả về nội dung rỗng (empty parts).")

            text = parts[0].get("text", "").strip()
            return text

        return self.call_with_retry(_execute)

    def test_connection(
        self,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Test connection to Gemini API and measure response latency.
        """
        target_key = api_key or self.key_pool.get_active_key()
        if not target_key:
            return {"success": False, "error": "Chưa có API Key để kiểm tra."}

        target_model = model or self.default_model
        url = f"{BASE_API_URL}/{target_model}:generateContent?key={target_key}"
        payload = {
            "contents": [{"parts": [{"text": "Hello, respond with 'OK'"}]}],
            "generationConfig": {"maxOutputTokens": 10, "temperature": 0.1},
        }

        start_time = time.time()
        try:
            resp = requests.post(url, json=payload, timeout=10)
            latency_ms = round((time.time() - start_time) * 1000)
            if resp.status_code == 200:
                data = resp.json()
                text = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
                return {
                    "success": True,
                    "model": target_model,
                    "latency_ms": latency_ms,
                    "response": text,
                    "masked_key": GeminiKeyPool.mask_key(target_key),
                }
            else:
                return {
                    "success": False,
                    "status_code": resp.status_code,
                    "error": resp.text,
                    "latency_ms": latency_ms,
                }
        except Exception as e:
            latency_ms = round((time.time() - start_time) * 1000)
            return {"success": False, "error": str(e), "latency_ms": latency_ms}

    def fix_and_translate_failed_segments(
        self,
        items: List[Dict[str, Any]],
        model: Optional[str] = None,
        concurrency: int = 5,
        progress_cb: Optional[Callable[[int, int, str], None]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Multi-threaded translation & paraphrasing of failed subtitle segments.
        Converts foreign text (Chinese, English...) to natural Vietnamese,
        and paraphrases sensitive/blocked words so CapCut TTS accepts them.
        """
        if not items:
            return []

        effective_model = model or self.default_model

        if len(items) <= 10 or concurrency <= 1:
            return self._fix_batch_json(items, model=effective_model, progress_cb=progress_cb)

        chunk_size = 5
        chunks = [items[i:i + chunk_size] for i in range(0, len(items), chunk_size)]
        results: List[Dict[str, Any]] = []
        completed = 0
        total = len(items)

        with concurrent.futures.ThreadPoolExecutor(max_workers=min(concurrency, len(chunks))) as executor:
            future_to_chunk = {
                executor.submit(self._fix_batch_json, chunk, model=effective_model): chunk
                for chunk in chunks
            }
            for future in concurrent.futures.as_completed(future_to_chunk):
                chunk_res = future.result()
                results.extend(chunk_res)
                completed += len(chunk_res)
                if progress_cb:
                    progress_cb(completed, total, f"Đã dịch/sửa {completed}/{total} câu...")

        results.sort(key=lambda x: x.get("seg_id", 0))
        return results

    def _fix_batch_json(
        self,
        items: List[Dict[str, Any]],
        model: str,
        progress_cb: Optional[Callable[[int, int, str], None]] = None,
    ) -> List[Dict[str, Any]]:
        system_instruction = (
            "Bạn là chuyên gia dịch thuật và biên tập lời thoại lồng tiếng video chuyên nghiệp.\n\n"
            "BỐI CẢNH: Các dòng phụ đề này vừa bị hệ thống tạo giọng đọc AI (Text-To-Speech / CapCut TTS) từ chối phát âm "
            "do dính một trong các nguyên nhân: chứa chữ nước ngoài (chữ Hán/Trung, tiếng Anh, Hàn...), "
            "chứa từ ngữ nhạy cảm/bạo lực/thô tục, hoặc ký tự lạ.\n\n"
            "NHIỆM VỤ & QUY TẮC BIÊN TẬP:\n"
            "1. NẾU LÀ TIẾNG NƯỚC NGOÀI (Chữ Hán/Trung Quốc, tiếng Anh, Hàn...): "
            "Dịch chuẩn xác sang tiếng Việt tự nhiên, đúng ngữ cảnh đối thoại phim ảnh/lồng tiếng. "
            "Nếu là từ đơn lẻ/tên riêng chữ Hán (như '漢', '好', '快'): Dịch nghĩa hoặc chuyển âm Hán-Việt phù hợp ngữ cảnh đối thoại.\n"
            "2. NẾU LÀ TỪ NHẠY CẢM / TỪ BỊ BỘ LỌC CHẶN: "
            "Viết lại (paraphrase) bằng từ đồng nghĩa lịch sự, trong sáng nhưng giữ nguyên 100% ý đồ nhân vật để bộ đọc AI chấp nhận 100%.\n"
            "3. VĂN PHONG LỒNG TIẾNG: "
            "Ngắn gọn, súc tích, mượt mà như lời nói đời thường, không kèm giải thích thừa.\n"
            "4. ĐỊNH DẠNG ĐẦU RA: Bắt buộc trả về JSON danh sách: [{\"seg_id\": id, \"fixed_text\": \"câu tiếng Việt hoàn thiện\"}]."
        )

        prompt_items = [
            {"seg_id": item["seg_id"], "text": item.get("text_dub") or item.get("text") or ""}
            for item in items
        ]
        prompt = (
            "Hãy dịch sang tiếng Việt và biên tập lại các câu phụ đề sau để bộ đọc AI phát âm chuẩn không bị lỗi:\n"
            + json.dumps(prompt_items, ensure_ascii=False, indent=2)
        )


        try:
            raw_response = self.generate_content(
                prompt=prompt,
                system_instruction=system_instruction,
                model=model,
                temperature=0.3,
                json_mode=True,
                timeout_sec=25,
            )

            clean_json = raw_response.strip()
            if clean_json.startswith("```json"):
                clean_json = clean_json[7:]
            if clean_json.startswith("```"):
                clean_json = clean_json[3:]
            if clean_json.endswith("```"):
                clean_json = clean_json[:-3]
            clean_json = clean_json.strip()

            parsed = json.loads(clean_json)
            if isinstance(parsed, dict) and "results" in parsed:
                parsed = parsed["results"]
            if isinstance(parsed, dict) and "subtitles" in parsed:
                parsed = parsed["subtitles"]

            fixed_map = {}
            if isinstance(parsed, list):
                for obj in parsed:
                    if isinstance(obj, dict) and "seg_id" in obj:
                        fixed_map[obj["seg_id"]] = obj.get("fixed_text") or obj.get("text") or ""

            res_list = []
            for item in items:
                sid = item["seg_id"]
                original = item.get("text_dub") or item.get("text") or ""
                fixed = fixed_map.get(sid, original)
                res_list.append({
                    "seg_id": sid,
                    "fixed_text": fixed,
                    "original_text": original,
                    "is_changed": fixed != original,
                })
            return res_list
        except Exception as e:
            logger.warning(f"Lỗi khi dịch câu qua Gemini: {e}")
            return [{
                "seg_id": item["seg_id"],
                "fixed_text": item.get("text_dub") or item.get("text") or "",
                "original_text": item.get("text_dub") or item.get("text") or "",
                "is_changed": False,
            } for item in items]

