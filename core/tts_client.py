"""
High-level CapCut TTS Client with auto-retry, anti-rate-limit device rotation, and voice catalog lookup.
"""

import base64
import hashlib
import json
import os
import random
import shutil
import threading
import time
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
from urllib.parse import urlencode

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from core.capcut_signer import (
    BASE_URL,
    DEFAULT_DEVICE,
    base_headers,
    compact_json,
    common_query,
    escape_xml,
    make_sign_header,
    make_tts_payload_sign,
)


class CapCutError(Exception):
    """Base exception for CapCut client."""
    pass


class CapCutTaskError(CapCutError):
    """Raised when a task fails or times out."""
    pass


class VoiceCatalog:
    """Helper to load and search available voices."""

    def __init__(self, catalog_path: Optional[Union[str, Path]] = None):
        if catalog_path is None:
            catalog_path = Path(__file__).parent / "voice_catalog.json"
        self.catalog_path = Path(catalog_path)
        self.voices: List[Dict[str, Any]] = []
        self.load()

    def load(self):
        if self.catalog_path.exists():
            try:
                with open(self.catalog_path, "r", encoding="utf-8") as f:
                    self.voices = json.load(f)
            except Exception:
                self.voices = []
        else:
            self.voices = []

    def get_all(self, lang: Optional[str] = None) -> List[Dict[str, Any]]:
        if not lang:
            return self.voices
        lang_lower = lang.lower()
        return [
            v for v in self.voices
            if v.get("lang", "").lower() == lang_lower or v.get("lan", "").lower() == lang_lower
        ]

    def resolve(
        self,
        voice: Optional[str] = None,
        resource_id: Optional[str] = None,
    ) -> Tuple[str, str, str]:
        """
        Returns (voice_type, resource_id, display_name).
        """
        default_voice = "BV421_vivn_streaming"
        default_res = "7252594014782755330"
        default_name = "Nhỏ Ngọt Ngào"

        if not voice:
            return default_voice, resource_id or default_res, default_name

        v_lower = voice.lower().strip()
        
        # 1. Match voice_type
        for v in self.voices:
            if v.get("voice_type", "").lower() == v_lower:
                return v["voice_type"], resource_id or v.get("resource_id", default_res), v.get("display_name", v["voice_type"])

        # 2. Match display_name
        for v in self.voices:
            if v.get("display_name", "").lower() == v_lower:
                return v["voice_type"], resource_id or v.get("resource_id", default_res), v.get("display_name", v["voice_type"])

        # 3. Match resource_id
        if resource_id:
            for v in self.voices:
                if v.get("resource_id") == resource_id:
                    return v["voice_type"], resource_id, v.get("display_name", voice)

        return voice, resource_id or default_res, voice


class CapCutTTSClient:
    """
    Robust Client for converting Text to Speech using CapCut / ByteDance API.
    """

    def __init__(
        self,
        device_dict: Optional[Dict[str, Any]] = None,
        catalog_path: Optional[Union[str, Path]] = None,
        cache_dir: Optional[Union[str, Path]] = None,
    ):
        self.device = deepcopy(DEFAULT_DEVICE)
        if device_dict:
            self.device.update(device_dict)

        self._lock = threading.Lock()
        self.catalog = VoiceCatalog(catalog_path)
        self.session = requests.Session()

        if cache_dir is None:
            cache_dir = Path(__file__).parent.parent / "temp" / "tts_cache"
        self.cache_dir = Path(cache_dir).resolve()
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        retry_strategy = Retry(
            total=5,
            backoff_factor=1.5,
            status_forcelist=[500, 502, 503, 504],
            allowed_methods=["HEAD", "GET", "OPTIONS", "POST"],
        )
        adapter = HTTPAdapter(max_retries=retry_strategy, pool_connections=300, pool_maxsize=300)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)

    @staticmethod
    def estimate_prosody_rate(text: str, target_dur_sec: float, base_rate: str = "1.0") -> str:
        """
        Estimate the most natural CapCut SSML prosody rate to generate speech
        that naturally fits the allocated duration without requiring excessive DSP time-stretching.
        """
        words = text.strip().split()
        if not words or target_dur_sec <= 0.1:
            return base_rate

        # In Vietnamese, ~4.0 - 4.3 words/syllables per second is standard 1.0x pace
        est_natural_dur = max(0.5, len(words) / 4.2)
        ratio = est_natural_dur / max(0.2, target_dur_sec)

        try:
            b_val = float(base_rate)
        except Exception:
            b_val = 1.0

        if ratio >= 1.35:
            suggested = min(1.4, b_val * 1.3)
        elif ratio >= 1.20:
            suggested = min(1.3, b_val * 1.2)
        elif ratio >= 1.08:
            suggested = min(1.2, b_val * 1.1)
        elif ratio <= 0.70 and target_dur_sec >= 2.0:
            suggested = max(0.9, b_val * 0.9)
        else:
            suggested = b_val

        return f"{round(suggested, 1):.1f}"

    def compute_cache_key(self, text: str, voice: Optional[str] = "BV421_vivn_streaming", rate: str = "1.0") -> str:
        """Generate deterministic cache key for (voice, rate, normalized_text)."""
        voice_str = (voice or "BV421_vivn_streaming").strip().lower()
        try:
            rate_val = float(rate or 1.0)
            rate_str = f"{rate_val:.1f}"
        except Exception:
            rate_str = str(rate or "1.0").strip()
        norm_text = " ".join(text.strip().split())
        raw_key = f"{voice_str}|{rate_str}|{norm_text}"
        return hashlib.md5(raw_key.encode("utf-8")).hexdigest()

    def get_cached_audio_path(self, text: str, voice: Optional[str] = "BV421_vivn_streaming", rate: str = "1.0") -> Optional[Path]:
        """Check if audio already exists in persistent TTS cache and is valid (>500 bytes)."""
        key = self.compute_cache_key(text, voice, rate)
        cached_file = self.cache_dir / f"{key}.mp3"
        if cached_file.exists() and cached_file.stat().st_size > 500:
            return cached_file
        return None

    def save_to_cache(self, text: str, audio_source: Union[bytes, str, Path], voice: Optional[str] = "BV421_vivn_streaming", rate: str = "1.0") -> Path:
        """Save raw bytes or existing MP3 file to persistent TTS cache."""
        key = self.compute_cache_key(text, voice, rate)
        cached_file = self.cache_dir / f"{key}.mp3"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        if isinstance(audio_source, bytes):
            cached_file.write_bytes(audio_source)
        else:
            src_p = Path(audio_source)
            if src_p.exists() and src_p.resolve() != cached_file.resolve():
                shutil.copy2(src_p, cached_file)
        return cached_file

    def get_cache_stats(self) -> Dict[str, Any]:
        """Get total cached audio files and size in MB."""
        if not self.cache_dir.exists():
            return {"total_cached_files": 0, "size_mb": 0.0}
        files = list(self.cache_dir.glob("*.mp3"))
        total_size = sum(f.stat().st_size for f in files)
        return {
            "total_cached_files": len(files),
            "size_mb": round(total_size / (1024 * 1024), 2),
            "cache_dir": str(self.cache_dir),
        }

    def generate_speech_to_file(
        self,
        text: str,
        output_file: Union[str, Path],
        voice: Optional[str] = "BV421_vivn_streaming",
        resource_id: Optional[str] = None,
        rate: str = "1.0",
    ) -> str:
        """Generate audio and save directly to file path with instant persistent cache reuse (0ms)."""
        out_path = Path(output_file)
        out_path.parent.mkdir(parents=True, exist_ok=True)

        # 1. Check persistent global TTS cache first
        cached_p = self.get_cached_audio_path(text=text, voice=voice, rate=rate)
        if cached_p:
            if out_path.resolve() != cached_p.resolve():
                shutil.copy2(cached_p, out_path)
            return str(out_path.resolve())

        # 2. If not cached, generate via CapCut API
        audio_bytes = self.generate_speech(text, voice=voice, resource_id=resource_id, rate=rate)

        # 3. Save to persistent cache and target output
        self.save_to_cache(text=text, audio_source=audio_bytes, voice=voice, rate=rate)
        with open(out_path, "wb") as f:
            f.write(audio_bytes)
        return str(out_path.resolve())

    def randomize_device(self):
        """Randomize device IDs to bypass rate-limits and IP throttling."""
        with self._lock:
            new_id = str(random.randint(1000000000000000000, 9999999999999999999))
            self.device["device_id"] = new_id
            self.device["iid"] = new_id
            self.device["tdid"] = new_id

    def build_tts_request(
        self,
        texts: Union[str, List[str]],
        voice: Optional[str] = "BV421_vivn_streaming",
        resource_id: Optional[str] = None,
        rate: str = "1.0",
    ) -> Tuple[str, Dict[str, str], str]:
        """Build URL, HTTP headers, and JSON body for TTS task."""
        if isinstance(texts, str):
            text_list = [texts]
        else:
            text_list = list(texts)

        if not text_list:
            raise ValueError("texts must not be empty")

        voice_type, final_res_id, _ = self.catalog.resolve(voice, resource_id)

        babi = {
            "feature_entrance": "editor",
            "feature_entrance_detail": "editor-feature-text_to_speech",
            "feature_key": "text_to_speech",
            "scenario": "video_editor",
        }

        voice_blocks = []
        for text in text_list:
            voice_blocks.append(
                f'    <voice name="{voice_type}" mock_tone_info="" platform="sami" '
                f'resource_id="{final_res_id}" emotion="" emotion_scale="0" style="" role="" '
                f'moyin_emotion="" is_clone_tone="false" need_subtitle_timestamp="false">\n'
                f'        <prosody rate="{rate}">{escape_xml(text)}</prosody>\n'
                f'    </voice>'
            )

        ssml = (
            '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">\n'
            + "\n".join(voice_blocks)
            + "\n</speak>"
        )

        extra_info = compact_json({"benefit_info": {}})
        payload = {
            "audio_format": "mp3",
            "babi_param": compact_json(babi),
            "credit_disable": False,
            "extra_info": extra_info,
            "need_merge_voice": False,
            "need_subtitle_timestamp": False,
            "scene": "text_to_speech",
            "ssml": ssml,
        }
        payload["sign"] = make_tts_payload_sign(
            ssml, extra_info, self.device["device_id"], self.device["aid"]
        )

        body = {
            "bind_id": str(uuid.uuid4()),
            "can_queue": True,
            "enter_from": "text_to_speech",
            "tasks": [
                {
                    "context": str(uuid.uuid4()),
                    "payload": compact_json(payload),
                    "req_key": "sami_text_to_speech",
                    "task_version": "v3",
                }
            ],
        }

        body_text = compact_json(body)
        path = "/lv/v1/common_task/new"
        query = common_query(self.device, babi, include_region=True)
        url = BASE_URL + path + "?" + urlencode(query)
        headers = base_headers(self.device, body_text, appid=True)
        lower_headers = {k.lower(): v for k, v in headers.items()}
        if "sign" not in lower_headers:
            headers["sign"] = make_sign_header(
                url, self.device["appvr"], lower_headers["device-time"], self.device["tdid"]
            )
        return url, headers, body_text

    def create_tts_task(
        self,
        texts: Union[str, List[str]],
        voice: Optional[str] = "BV421_vivn_streaming",
        resource_id: Optional[str] = None,
        rate: str = "1.0",
    ) -> Dict[str, Any]:
        """Submit a new TTS task to CapCut."""
        url, headers, body_text = self.build_tts_request(texts, voice, resource_id, rate)
        resp = self.session.post(url, headers=headers, data=body_text.encode("utf-8"), timeout=15)
        if resp.status_code >= 400:
            raise CapCutError(f"HTTP {resp.status_code}: {resp.text}")
        data = resp.json()
        if data.get("status_code", 0) not in (0, 200) and "status_code" in data:
            raise CapCutError(f"API Error code {data.get('status_code')}: {data.get('message', '')}")
        return data

    def query_tts_task(self, task_id: str, token: str) -> Dict[str, Any]:
        """Query status of an existing TTS task."""
        babi = {
            "feature_entrance": "editor",
            "feature_entrance_detail": "editor-feature-text_to_speech",
            "feature_key": "text_to_speech",
            "scenario": "video_editor",
        }
        body = {
            "bind_id": "",
            "tasks": [
                {
                    "id": task_id,
                    "req_key": "sami_text_to_speech",
                    "task_version": "v3",
                    "token": token,
                }
            ],
        }
        body_text = compact_json(body)
        path = "/lv/v1/common_task/query"
        query = common_query(self.device, babi, include_region=True)
        url = BASE_URL + path + "?" + urlencode(query)
        headers = base_headers(self.device, body_text, appid=True)
        lower_headers = {k.lower(): v for k, v in headers.items()}
        if "sign" not in lower_headers:
            headers["sign"] = make_sign_header(
                url, self.device["appvr"], lower_headers["device-time"], self.device["tdid"]
            )
        resp = self.session.post(url, headers=headers, data=body_text.encode("utf-8"), timeout=15)
        if resp.status_code >= 400:
            raise CapCutError(f"HTTP {resp.status_code}: {resp.text}")
        data = resp.json()
        if data.get("status_code", 0) not in (0, 200) and "status_code" in data:
            raise CapCutError(f"Query API Error code {data.get('status_code')}: {data.get('message', '')}")
        return data

    def generate_speech(
        self,
        text: str,
        voice: Optional[str] = "BV421_vivn_streaming",
        resource_id: Optional[str] = None,
        rate: str = "1.0",
        timeout: float = 12.0,
        max_retries: int = 3,
    ) -> bytes:
        """
        Generate MP3 audio bytes for a given text.
        Includes automatic retry and device rotation with fast timeout.
        """
        last_exc = None
        for attempt in range(max_retries):
            try:
                create_res = self.create_tts_task(text, voice, resource_id, rate)
                tasks = (create_res.get("data") or {}).get("tasks") or []
                if not tasks:
                    raise CapCutTaskError(f"No task returned: {create_res}")

                task_id = tasks[0]["id"]
                token = tasks[0]["token"]

                start_time = time.time()
                while time.time() - start_time < timeout:
                    query_res = self.query_tts_task(task_id, token)
                    q_tasks = (query_res.get("data") or {}).get("tasks") or []
                    if q_tasks:
                        task_item = q_tasks[0]
                        status = task_item.get("status")
                        if status in ("success", "succeed"):
                            return self._extract_audio_bytes(task_item)
                        elif status == "failed":
                            raise CapCutTaskError(f"Task failed: {query_res.get('message') or 'CapCut rejected text'}")
                    time.sleep(0.6)

                raise CapCutTaskError(f"TTS task timed out after {timeout}s")
            except Exception as exc:
                last_exc = exc
                self.randomize_device()
                time.sleep(0.8 * (attempt + 1))

        raise CapCutError(f"Failed to generate speech after {max_retries} attempts: {last_exc}")

    def _extract_audio_bytes(self, task_item: Dict[str, Any]) -> bytes:
        """Extract audio bytes from speech_url or base64 payload."""
        # 1. Try payload speech_url
        payload_str = task_item.get("payload", "")
        if payload_str:
            try:
                payload_json = json.loads(payload_str)
                audio_subs = payload_json.get("audio_subtitles", [])
                if audio_subs and len(audio_subs) > 0:
                    url = audio_subs[0].get("speech_url")
                    if url:
                        resp = requests.get(url, timeout=60)
                        resp.raise_for_status()
                        return resp.content
            except Exception:
                pass

        # 2. Try direct video_url / speech_url
        if "video_url" in task_item and task_item["video_url"]:
            resp = requests.get(task_item["video_url"], timeout=60)
            resp.raise_for_status()
            return resp.content

        # 3. Try base64 audio
        if "audio" in task_item and task_item["audio"]:
            return base64.b64decode(task_item["audio"])

        raise CapCutError("No audio URL or Base64 data found in API response")
