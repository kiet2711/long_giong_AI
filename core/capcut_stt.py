"""
High-performance CapCut Speech-to-Text (STT) Client in pure Python.
Supports:
- Direct VOD Upload with AWS SigV4 Signature
- Async Task Creation & Polling
- FFmpeg Auto-Chunking (10 minutes/slice) for large media (2-3 hours)
- Parallel Multi-threaded Transcription (ThreadPoolExecutor)
- Millisecond Timeline Offset Shifting & SRT Assembly
"""

import concurrent.futures
import datetime
import hashlib
import hmac
import json
import logging
import os
import random
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union
from urllib.parse import quote, urlencode

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from core.capcut_signer import (
    BASE_URL,
    DEFAULT_DEVICE,
    base_headers,
    compact_json,
    common_query,
    make_sign_header,
)
from core.srt_parser import SubtitleItem

logger = logging.getLogger(__name__)

VOD_REGION = "sdwdmwlll"
VOD_SERVICE = "vod"


# CRC32 Lookup Table
def _make_crc_table() -> List[int]:
    table = []
    for i in range(256):
        c = i
        for _ in range(8):
            if c & 1:
                c = 0xEDB88320 ^ (c >> 1)
            else:
                c = c >> 1
        table.append(c)
    return table


CRC_TABLE = _make_crc_table()


def crc32_hex(data: bytes) -> str:
    crc = 0xFFFFFFFF
    for b in data:
        crc = (crc >> 8) ^ CRC_TABLE[(crc ^ b) & 0xFF]
    return f"{(crc ^ 0xFFFFFFFF) & 0xFFFFFFFF:08x}"


def md5_hex(data: Union[bytes, str]) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.md5(data).hexdigest()


def sha256_hex(data: Union[bytes, str]) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def hmac_sha256(key: bytes, msg: Union[bytes, str]) -> bytes:
    if isinstance(msg, str):
        msg = msg.encode("utf-8")
    return hmac.new(key, msg, hashlib.sha256).digest()


def aws4_signing_key(
    secret_access_key: str, date_stamp: str, region: str = VOD_REGION, service: str = VOD_SERVICE
) -> bytes:
    k_date = hmac_sha256(("AWS4" + secret_access_key).encode("utf-8"), date_stamp)
    k_region = hmac_sha256(k_date, region)
    k_service = hmac_sha256(k_region, service)
    return hmac_sha256(k_service, "aws4_request")


def utc_now_for_vod() -> Tuple[str, str]:
    now = datetime.datetime.now(datetime.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    http_date = now.strftime("%a, %d %b %Y %H:%M:%S GMT")
    return amz_date, http_date


def canonical_query(url_str: str) -> str:
    from urllib.parse import parse_qsl, urlparse

    parsed = urlparse(url_str)
    pairs = parse_qsl(parsed.query, keep_blank_values=True)
    pairs.sort(key=lambda x: x[0])
    return "&".join(f"{quote(k, safe='')}={quote(v, safe='')}" for k, v in pairs)


def aws4_authorization(
    method: str,
    url_str: str,
    body_bytes: bytes,
    access_key_id: str,
    secret_access_key: str,
    session_token: str,
    amz_date: str,
) -> str:
    date_stamp = amz_date[:8]
    scope = f"{date_stamp}/{VOD_REGION}/{VOD_SERVICE}/aws4_request"
    signed_headers = "x-amz-date;x-amz-security-token"
    canonical_headers = f"x-amz-date:{amz_date}\nx-amz-security-token:{session_token}\n"

    from urllib.parse import urlparse

    parsed = urlparse(url_str)
    q = canonical_query(url_str)

    payload_hash = sha256_hex(body_bytes)
    canonical_request = "\n".join([method, parsed.path, q, canonical_headers, signed_headers, payload_hash])
    string_to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, sha256_hex(canonical_request)])

    signing_key = aws4_signing_key(secret_access_key, date_stamp)
    signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"AWS4-HMAC-SHA256 Credential={access_key_id}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"


def ms_to_srt_time(ms: int) -> str:
    """Format milliseconds into standard SRT format: 00:01:23,456"""
    ms = max(0, int(ms))
    total_seconds = ms // 1000
    milliseconds = ms % 1000
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"


class CapCutSTTClient:
    """Pure Python CapCut VOD STT Client."""

    def __init__(self):
        self.session = requests.Session()
        retries = Retry(total=3, backoff_factor=1.0, status_forcelist=[500, 502, 503, 504])
        adapter = HTTPAdapter(max_retries=retries)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

    def _get_random_device(self) -> Dict[str, str]:
        dev = dict(DEFAULT_DEVICE)
        rand_id = str(random.randint(10**18, 10**19 - 1))
        dev["device_id"] = rand_id
        dev["iid"] = rand_id
        dev["tdid"] = rand_id
        return dev

    def upload_to_vod(self, buffer: bytes, device: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Upload audio binary to CapCut VOD Space using AWS SigV4."""
        if device is None:
            device = self._get_random_device()

        local_md5 = md5_hex(buffer)

        # 1. Upload Sign Request
        sign_body = json.dumps({"biz": "cc_pc_text_recognize", "key_version": "v5"}, separators=(",", ":"))
        sign_query = common_query(device, None, False)
        sign_url = f"{BASE_URL}/lv/v1/upload_sign?{urlencode(sign_query)}"
        sign_headers = base_headers(device, sign_body, True)
        sign_headers["sign"] = make_sign_header(sign_url, device["appvr"], sign_headers["device-time"], device["tdid"])

        resp = self.session.post(sign_url, headers=sign_headers, data=sign_body, timeout=30)
        sign_data = resp.json()
        if sign_data.get("status_code") != 0 and str(sign_data.get("ret")) != "0":
            raise RuntimeError(f"CapCut upload_sign failed: {sign_data}")

        creds = sign_data.get("data", {})

        # 2. ApplyUploadInner
        apply_query = {
            "Action": "ApplyUploadInner",
            "SpaceName": creds["space_name"],
            "UseQuic": "false",
            "Version": "2020-11-19",
            "device_platform": "win",
        }
        apply_url = f"https://{creds['domain']}/top/v1?{urlencode(apply_query)}"
        apply_amz_date, apply_http_date = utc_now_for_vod()
        apply_auth = aws4_authorization(
            "GET", apply_url, b"", creds["access_key_id"], creds["secret_access_key"], creds["session_token"], apply_amz_date
        )

        apply_headers = {
            "Authorization": apply_auth,
            "Date": apply_http_date,
            "User-Agent": f"BDFileUpload({int(time.time()*1000)})",
            "X-Amz-Date": apply_amz_date,
            "X-Amz-Expires": "31536000",
            "X-Amz-Security-Token": creds["session_token"],
            "accept-encoding": "identity",
            "store-country-code": device["loc"].lower(),
            "store-country-code-src": "did",
            "is-dispatch-us-ttp": "0",
            "is-app-region-us-ttp": "0",
            "tdid": device["tdid"],
            "pf": device["pf"],
        }

        apply_resp = self.session.get(apply_url, headers=apply_headers, timeout=30)
        apply_data = apply_resp.json()
        if not apply_data.get("Result") or not apply_data["Result"].get("InnerUploadAddress"):
            raise RuntimeError(f"ApplyUploadInner failed: {apply_data}")

        node = apply_data["Result"]["InnerUploadAddress"]["UploadNodes"][0]
        store = node["StoreInfos"][0]
        upload_host = node["UploadHost"]
        store_uri = store["StoreUri"]
        upload_id = store["UploadID"]
        upload_auth = store["Auth"]
        vid = node.get("Vid") or (node.get("Vids") and node["Vids"][0]) or None

        # 3. Transfer binary in 5MB chunks
        chunk_size = 5 * 1024 * 1024
        chunks = [buffer[i : i + chunk_size] for i in range(0, max(1, len(buffer)), chunk_size)]
        if not chunks:
            chunks = [b""]

        part_crcs = []
        for i, chunk in enumerate(chunks):
            c_crc = crc32_hex(chunk)
            part_crcs.append(f"{i}:{c_crc}")

            transfer_url = f"https://{upload_host}/upload/v1/{store_uri}?uploadid={upload_id}&part_number={i}&phase=transfer"
            transfer_headers = {
                "Authorization": upload_auth,
                "Date": utc_now_for_vod()[1],
                "User-Agent": f"BDFileUpload({int(time.time()*1000)})",
                "accept-encoding": "identity",
                "store-country-code": device["loc"].lower(),
                "store-country-code-src": "did",
                "is-dispatch-us-ttp": "0",
                "is-app-region-us-ttp": "0",
                "tdid": device["tdid"],
                "pf": device["pf"],
                "X-Upload-Content-CRC32": c_crc,
            }

            transfer_resp = self.session.post(transfer_url, headers=transfer_headers, data=chunk, timeout=60)
            transfer_data = transfer_resp.json()
            if transfer_data.get("error"):
                raise RuntimeError(f"Transfer chunk {i} failed: {transfer_data}")

        # 4. Finish Upload
        finish_url = f"https://{upload_host}/upload/v1/{store_uri}?uploadmode=part&phase=finish&uploadid={upload_id}"
        finish_body = ",".join(part_crcs)
        finish_headers = {
            "Authorization": upload_auth,
            "Date": utc_now_for_vod()[1],
            "User-Agent": f"BDFileUpload({int(time.time()*1000)})",
            "accept-encoding": "identity",
            "store-country-code": device["loc"].lower(),
            "store-country-code-src": "did",
            "is-dispatch-us-ttp": "0",
            "is-app-region-us-ttp": "0",
            "tdid": device["tdid"],
            "pf": device["pf"],
        }
        finish_resp = self.session.post(finish_url, headers=finish_headers, data=finish_body.encode("utf-8"), timeout=30)
        finish_data = finish_resp.json()
        if finish_data.get("error"):
            raise RuntimeError(f"Finish upload failed: {finish_data}")

        # 5. CommitUploadInner
        commit_url = f"https://{creds['domain']}/top/v1?Action=CommitUploadInner&SpaceName={creds['space_name']}&Version=2020-11-19&device_platform=win"
        commit_body_obj = {
            "Functions": [{"Input": {"SnapshotTime": 0.0}, "Name": "Snapshot"}],
            "SessionKey": node["SessionKey"],
        }
        commit_body = json.dumps(commit_body_obj, separators=(",", ":"))
        commit_amz_date, commit_http_date = utc_now_for_vod()
        commit_auth = aws4_authorization(
            "POST",
            commit_url,
            commit_body.encode("utf-8"),
            creds["access_key_id"],
            creds["secret_access_key"],
            creds["session_token"],
            commit_amz_date,
        )

        commit_headers = {
            "Authorization": commit_auth,
            "Date": commit_http_date,
            "User-Agent": f"BDFileUpload({int(time.time()*1000)})",
            "X-Amz-Date": commit_amz_date,
            "X-Amz-Expires": "31536000",
            "X-Amz-Security-Token": creds["session_token"],
            "accept-encoding": "identity",
            "store-country-code": device["loc"].lower(),
            "store-country-code-src": "did",
            "is-dispatch-us-ttp": "0",
            "is-app-region-us-ttp": "0",
            "tdid": device["tdid"],
            "pf": device["pf"],
            "content-type": "application/json",
        }

        commit_resp = self.session.post(commit_url, headers=commit_headers, data=commit_body.encode("utf-8"), timeout=30)
        commit_data = commit_resp.json()
        if not commit_data.get("Result") or not commit_data["Result"].get("Results"):
            raise RuntimeError(f"CommitUploadInner failed: {commit_data}")

        res_result = commit_data["Result"]["Results"][0]
        meta = res_result.get("VideoMeta", {})
        duration_ms = int(float(meta.get("Duration", 10.0)) * 1000)

        return {
            "vid": res_result.get("Vid") or vid,
            "md5": meta.get("Md5") or local_md5,
            "durationMs": duration_ms if duration_ms > 0 else 10000,
            "size": meta.get("Size", len(buffer)),
        }

    def create_stt_task(
        self,
        audio_vid: str,
        audio_md5: str,
        duration_ms: int,
        language: str = "vi-VN",
        translation_language: str = "vi-VN",
        use_translation: bool = False,
        device: Optional[Dict[str, str]] = None,
    ) -> Tuple[str, str]:
        """Submit ASR subtitle recognition task to CapCut Cloud."""
        if device is None:
            device = self._get_random_device()

        babi = {
            "feature_entrance": "editor",
            "feature_entrance_detail": "editor-elements-captions-subtitle_recognition",
            "feature_key": "subtitle_recognition",
            "scenario": "video_editor",
        }

        cap_json = {
            "adjust_endtime": 200,
            "audio": audio_vid,
            "audio_type": "vid",
            "caption_type": 0,
            "client_request_id": str(uuid.uuid4()),
            "duration": int(duration_ms),
            "enable_cache": True,
            "enter_from": "asr",
            "language": language,
            "max_lines": 1,
            "md5": audio_md5,
            "pack_options": {"need_attribute": True},
            "songs_info": [{"end_time": float(duration_ms) - 10.334, "id": "", "start_time": 0}],
            "translation_language": translation_language,
            "use_translation": bool(use_translation),
            "words_per_line": 15,
        }

        body = {
            "bind_id": uuid.uuid4().hex.upper(),
            "can_queue": True,
            "enter_from": "asr",
            "tasks": [
                {
                    "context": str(uuid.uuid4()),
                    "payload": json.dumps({"cap_json": cap_json}, separators=(",", ":")),
                    "req_key": "cc_audio_subtitle_asr",
                    "task_version": "v3",
                }
            ],
        }

        body_text = json.dumps(body, separators=(",", ":"))
        query = common_query(device, babi, True)
        url = f"{BASE_URL}/lv/v1/common_task/new?{urlencode(query)}"
        headers = base_headers(device, body_text, False)
        headers["sign"] = make_sign_header(url, device["appvr"], headers["device-time"], device["tdid"])

        resp = self.session.post(url, headers=headers, data=body_text.encode("utf-8"), timeout=30)
        data = resp.json()
        if data.get("status_code") != 0 and str(data.get("ret")) != "0":
            raise RuntimeError(f"Create STT task failed: {data}")

        tasks = (data.get("data") or {}).get("tasks", [])
        if not tasks:
            raise RuntimeError(f"No STT task returned in response: {data}")

        return tasks[0]["id"], tasks[0]["token"]

    def query_stt_task(self, task_id: str, token: str, device: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Check status of ASR STT Task."""
        if device is None:
            device = self._get_random_device()

        body = {
            "tasks": [
                {
                    "bind_id": "",
                    "id": task_id,
                    "req_key": "cc_audio_subtitle_asr",
                    "task_version": "v3",
                    "token": token,
                }
            ]
        }
        body_text = json.dumps(body, separators=(",", ":"))
        query = common_query(device, None, False)
        url = f"{BASE_URL}/lv/v1/common_task/query?{urlencode(query)}"
        headers = base_headers(device, body_text, False)
        headers["sign"] = make_sign_header(url, device["appvr"], headers["device-time"], device["tdid"])

        resp = self.session.post(url, headers=headers, data=body_text.encode("utf-8"), timeout=30)
        return resp.json()

    def transcribe_chunk_buffer(
        self,
        buffer: bytes,
        language: str = "vi-VN",
        translation_language: str = "vi-VN",
        use_translation: bool = False,
        timeout_sec: int = 300,
    ) -> List[Dict[str, Any]]:
        """Transcribe a single audio chunk buffer with auto-retry."""
        last_err = None
        for attempt in range(1, 4):
            try:
                device = self._get_random_device()
                upload_res = self.upload_to_vod(buffer, device)
                task_id, token = self.create_stt_task(
                    upload_res["vid"],
                    upload_res["md5"],
                    upload_res["durationMs"],
                    language=language,
                    translation_language=translation_language,
                    use_translation=use_translation,
                    device=device,
                )

                start_t = time.time()
                query_res = None

                while time.time() - start_t < timeout_sec:
                    time.sleep(2.0)
                    q = self.query_stt_task(task_id, token, device)
                    tasks = (q.get("data") or {}).get("tasks", [])
                    if tasks:
                        status = tasks[0].get("status")
                        if status in ("success", "succeed", "failed"):
                            query_res = q
                            break

                if not query_res:
                    raise RuntimeError("Timeout waiting for CapCut STT query")

                task = query_res["data"]["tasks"][0]
                payload = task.get("payload", {})
                if isinstance(payload, str):
                    try:
                        payload = json.loads(payload)
                    except Exception:
                        payload = {}

                raw_utterances = payload.get("utterances", [])
                utterances = []
                for ut in raw_utterances:
                    text = ut.get("translation_text") if (use_translation and ut.get("translation_text")) else ut.get("text", "")
                    if text and text.strip():
                        utterances.append(
                            {
                                "start_time": ut.get("start_time", 0),
                                "end_time": ut.get("end_time", 0),
                                "text": text.strip(),
                                "words": ut.get("words", []),
                            }
                        )
                return utterances

            except Exception as e:
                last_err = e
                logger.warning(f"[CapCut STT] Chunk attempt {attempt} failed: {e}. Retrying...")
                time.sleep(2.0 * attempt)

        logger.error(f"[CapCut STT] All chunk attempts failed: {last_err}")
        return []


def get_media_duration_sec(file_path: Union[str, Path]) -> float:
    """Extract audio/video duration in seconds using ffprobe."""
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(file_path),
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        dur = float(res.stdout.strip())
        if dur > 0:
            return dur
    except Exception:
        pass

    # Fallback to ffmpeg -i
    try:
        cmd2 = ["ffmpeg", "-i", str(file_path)]
        res2 = subprocess.run(cmd2, capture_output=True, text=True)
        m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", res2.stderr)
        if m:
            return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    except Exception:
        pass

    return 0.0


def extract_audio_chunk(
    source_path: Union[str, Path], start_sec: float, duration_sec: float, output_path: Union[str, Path]
) -> Path:
    """Extract a lightweight mono 64kbps MP3 chunk from media file using FFmpeg."""
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{start_sec:.3f}",
        "-t",
        f"{duration_sec:.3f}",
        "-i",
        str(source_path),
        "-vn",
        "-acodec",
        "libmp3lame",
        "-b:a",
        "64k",
        "-ac",
        "1",
        "-ar",
        "24000",
        str(output_path),
    ]
    subprocess.run(cmd, capture_output=True, check=True)
    return Path(output_path)


class ChunkedSTTPipeline:
    """High-performance multi-threaded STT pipeline with auto-chunking & timeline offset stitching."""

    def __init__(self, temp_dir: Optional[Union[str, Path]] = None, max_workers: int = 3):
        self.temp_dir = Path(temp_dir) if temp_dir else Path(__file__).parent.parent / "temp" / "stt_pipeline"
        self.temp_dir.mkdir(parents=True, exist_ok=True)
        self.max_workers = max_workers
        self.client = CapCutSTTClient()

    def transcribe_media_file(
        self,
        media_path: Union[str, Path],
        language: str = "vi-VN",
        translation_language: str = "vi-VN",
        use_translation: bool = False,
        chunk_duration_sec: float = 600.0,  # 10 minutes per slice
        max_workers: Optional[int] = None,
        progress_callback: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """
        Process any audio/video media file of any length (2-3 hours) using multi-threaded chunking.
        Returns:
            {
                "subtitles": List[Dict[str, Any]], # Compatible with SubtitleItem
                "srt_content": str,
                "full_text": str,
                "total_sentences": int,
                "duration_sec": float,
                "language": str
            }
        """
        media_path = Path(media_path)
        if not media_path.exists():
            raise FileNotFoundError(f"Media file not found: {media_path}")

        session_id = uuid.uuid4().hex[:8]
        session_dir = self.temp_dir / f"session_{session_id}"
        session_dir.mkdir(parents=True, exist_ok=True)

        effective_workers = max(1, min(16, max_workers or self.max_workers))

        if progress_callback:
            progress_callback({"phase": "probing", "percent": 5.0, "message": "Đang phân tích thời lượng file âm thanh..."})

        total_dur = get_media_duration_sec(media_path)
        if total_dur <= 0:
            total_dur = 3600.0  # fallback 1h if probe fails

        file_size_mb = media_path.stat().st_size / (1024 * 1024)
        is_small = total_dur <= 600.0 and file_size_mb <= 25.0

        try:
            # Case 1: Small media -> Single direct chunk
            if is_small:
                if progress_callback:
                    progress_callback({"phase": "transcribing", "percent": 20.0, "message": "File ngắn (<10 phút), đang nhận dạng trực tiếp..."})

                chunk_mp3 = session_dir / "single_chunk.mp3"
                extract_audio_chunk(media_path, 0, total_dur, chunk_mp3)
                buf = chunk_mp3.read_bytes()

                utterances = self.client.transcribe_chunk_buffer(
                    buf, language=language, translation_language=translation_language, use_translation=use_translation
                )

                chunk_results = [utterances]
                chunk_offsets = [0.0]

            # Case 2: Large media -> Multi-threaded Chunking
            else:
                num_chunks = max(1, int(total_dur // chunk_duration_sec) + (1 if total_dur % chunk_duration_sec > 0 else 0))
                active_workers = min(effective_workers, num_chunks)

                if progress_callback:
                    progress_callback(
                        {
                            "phase": "chunking",
                            "percent": 10.0,
                            "message": f"File dài {int(total_dur//60)} phút. Đang cắt thành {num_chunks} phân đoạn (10 phút/đoạn)...",
                        }
                    )

                chunk_tasks = []
                for i in range(num_chunks):
                    start_s = i * chunk_duration_sec
                    dur_s = min(chunk_duration_sec, total_dur - start_s)
                    c_path = session_dir / f"chunk_{i:03d}.mp3"
                    extract_audio_chunk(media_path, start_s, dur_s, c_path)
                    chunk_tasks.append((i, start_s, dur_s, c_path))

                if progress_callback:
                    progress_callback(
                        {
                            "phase": "transcribing_pool",
                            "percent": 15.0,
                            "message": f"Đã cắt xong {num_chunks} đoạn. Đang chạy {active_workers} luồng nhận dạng song song...",
                        }
                    )

                chunk_results = [[] for _ in range(num_chunks)]
                chunk_offsets = [task[1] for task in chunk_tasks]
                completed_count = 0

                def _process_one_chunk(task_info):
                    idx, start_s, dur_s, c_path = task_info
                    buf = c_path.read_bytes()
                    return idx, self.client.transcribe_chunk_buffer(
                        buf, language=language, translation_language=translation_language, use_translation=use_translation
                    )

                with concurrent.futures.ThreadPoolExecutor(max_workers=active_workers) as executor:
                    futures = [executor.submit(_process_one_chunk, task) for task in chunk_tasks]
                    for future in concurrent.futures.as_completed(futures):
                        idx, res = future.result()
                        chunk_results[idx] = res
                        completed_count += 1
                        pct = min(95.0, 15.0 + (completed_count / num_chunks) * 80.0)
                        if progress_callback:
                            progress_callback(
                                {
                                    "phase": "transcribing",
                                    "percent": pct,
                                    "message": f"Đang nhận dạng đa luồng: Đã xong {completed_count}/{num_chunks} đoạn ({int(completed_count/num_chunks*100)}%)...",
                                }
                            )

            # Step 3: Timeline Offset Stitching & SRT Formatting
            if progress_callback:
                progress_callback({"phase": "stitching", "percent": 96.0, "message": "Đang tổng hợp và chuẩn hóa timeline phụ đề..."})

            subtitles: List[Dict[str, Any]] = []
            srt_lines: List[str] = []
            full_text_parts: List[str] = []
            global_id = 1

            for chunk_idx, utterances in enumerate(chunk_results):
                offset_s = chunk_offsets[chunk_idx]
                offset_ms = int(offset_s * 1000)

                for ut in utterances:
                    start_ms = ut["start_time"] + offset_ms
                    end_ms = ut["end_time"] + offset_ms
                    text = ut["text"].strip()
                    if not text:
                        continue

                    start_sec = start_ms / 1000.0
                    end_sec = max(start_sec + 0.1, end_ms / 1000.0)

                    start_fmt = ms_to_srt_time(start_ms)
                    end_fmt = ms_to_srt_time(end_ms)

                    sub_item = {
                        "id": global_id,
                        "start_sec": round(start_sec, 3),
                        "end_sec": round(end_sec, 3),
                        "start_time_str": start_fmt,
                        "end_time_str": end_fmt,
                        "text_dub": text,
                        "text_orig": "",
                        "voice": "BV421_vivn_streaming",
                        "rate": 1.0,
                    }
                    subtitles.append(sub_item)
                    srt_lines.append(f"{global_id}\n{start_fmt} --> {end_fmt}\n{text}\n")
                    full_text_parts.append(text)
                    global_id += 1

            srt_content = "\n".join(srt_lines).strip()
            full_text = " ".join(full_text_parts).strip()

            if progress_callback:
                progress_callback({"phase": "completed", "percent": 100.0, "message": "Nhận dạng giọng nói (STT) thành công!"})

            return {
                "subtitles": subtitles,
                "srt_content": srt_content,
                "full_text": full_text,
                "total_sentences": len(subtitles),
                "duration_sec": total_dur,
                "language": language,
                "session_id": session_id,
            }

        finally:
            # Cleanup temp chunk files
            try:
                if session_dir.exists():
                    shutil.rmtree(session_dir, ignore_errors=True)
            except Exception:
                pass
