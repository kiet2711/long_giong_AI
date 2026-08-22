"""
High-performance FFmpeg Dubbing & Sync Engine.
Handles audio stretching (rubberband/atempo), video speed adjusting (setpts),
lightning-fast full-track background audio volume scaling, and instant concat demuxing.
"""

import concurrent.futures
import json
import logging
import os
import shutil
import subprocess
import threading
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from mutagen.mp3 import MP3

from core.srt_parser import SubtitleItem, TimelineSegment, SRTParser
from core.tts_client import CapCutTTSClient

logger = logging.getLogger(__name__)


@dataclass
class VideoMetadata:
    duration: float
    width: int
    height: int
    fps: float
    has_audio: bool


def get_video_metadata(video_path: Union[str, Path]) -> VideoMetadata:
    """Extract video duration, resolution, fps, and audio presence using ffprobe."""
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate",
        "-of", "json",
        str(video_path),
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
    data = json.loads(result.stdout)

    format_info = data.get("format", {})
    duration = float(format_info.get("duration", 0.0))

    width = 1920
    height = 1080
    fps = 30.0
    has_audio = False

    for stream in data.get("streams", []):
        codec_type = stream.get("codec_type")
        if codec_type == "video":
            width = int(stream.get("width", width))
            height = int(stream.get("height", height))
            r_fps = stream.get("r_frame_rate", "30/1")
            if "/" in r_fps:
                num, den = r_fps.split("/")
                fps = float(num) / max(1.0, float(den))
            else:
                fps = float(r_fps)
        elif codec_type == "audio":
            has_audio = True

    return VideoMetadata(
        duration=duration,
        width=width,
        height=height,
        fps=round(fps, 2),
        has_audio=has_audio,
    )


def get_audio_duration(audio_path: Union[str, Path]) -> float:
    """Measure exact duration of an audio file in seconds."""
    try:
        audio = MP3(str(audio_path))
        return float(audio.info.length)
    except Exception:
        # Fallback to ffprobe
        cmd = [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        return float(res.stdout.strip())


def create_silence_wav(output_path: Union[str, Path], duration_sec: float, sample_rate: int = 48000, channels: int = 2):
    """Generate exact sample-accurate 16-bit stereo silence WAV file instantly in pure Python (0.0001s)."""
    num_samples = int(max(0.001, duration_sec) * sample_rate)
    data = b"\x00" * (num_samples * channels * 2)  # 16-bit PCM = 2 bytes per sample per channel
    with wave.open(str(output_path), "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(data)


_GPU_ENCODER_PARAMS = None
_GPU_SEMAPHORE = threading.Semaphore(4)


def get_best_video_encoder_params(target_fps: float) -> List[str]:
    """Auto-detect the fastest hardware video encoder (NVIDIA NVENC > libx264 ultrafast)."""
    global _GPU_ENCODER_PARAMS
    if _GPU_ENCODER_PARAMS is not None:
        return _GPU_ENCODER_PARAMS + ["-r", str(target_fps)]

    # Test NVIDIA NVENC
    try:
        res = subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=s=640x360:d=0.2:r=30", "-c:v", "h264_nvenc", "-pix_fmt", "yuv420p", "-f", "null", "-"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=3,
        )
        if res.returncode == 0:
            _GPU_ENCODER_PARAMS = ["-c:v", "h264_nvenc", "-preset", "p1", "-cq", "22", "-pix_fmt", "yuv420p"]
            return _GPU_ENCODER_PARAMS + ["-r", str(target_fps)]
    except Exception:
        pass

    # Fallback to libx264 ultrafast
    _GPU_ENCODER_PARAMS = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-pix_fmt", "yuv420p"]
    return _GPU_ENCODER_PARAMS + ["-r", str(target_fps)]


class FFmpegDubbingEngine:
    """
    Main engine to coordinate TTS generation, segment alignment,
    rapid parallel voice rendering, full-track background mixing, and final concatenation.
    """

    def __init__(
        self,
        tts_client: Optional[CapCutTTSClient] = None,
        min_audio_speed: float = 0.80,
        max_audio_speed: float = 1.20,
        min_video_speed: float = 0.50,
        max_video_speed: float = 1.50,
        min_ratio: Optional[float] = None,
        max_ratio: Optional[float] = None,
        orig_volume: float = 0.15,
        dub_volume: float = 1.20,
        num_workers: int = 4,
    ):
        self.tts_client = tts_client or CapCutTTSClient()
        self.min_audio_speed = min_audio_speed
        self.max_audio_speed = max_audio_speed
        self.min_video_speed = min_video_speed
        self.max_video_speed = max_video_speed
        self.orig_volume = orig_volume
        self.dub_volume = dub_volume
        self.num_workers = num_workers

    def process_dubbing_pipeline(
        self,
        video_path: Union[str, Path],
        subtitles: List[SubtitleItem],
        output_video_path: Union[str, Path],
        work_dir: Union[str, Path],
        voice: str = "BV421_vivn_streaming",
        voice_rate: str = "1.0",
        progress_cb: Optional[Callable[[Dict[str, Any]], None]] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """
        Execute the high-speed dubbing pipeline:
        1. Parse video metadata & build continuous timeline segments (dubbing + gaps).
        2. Generate AI TTS audio for all dubbed subtitles in parallel (with caching).
        3. Build AI voice track (instant Python silence for gaps, lightweight audio filters for dubs).
        4. Lower original background audio for entire track in 1 go & mix tracks.
        5. Lossless Stream Copy (-c:v copy) or GPU single-pass render for final video.
        """
        video_p = Path(video_path).resolve()
        out_p = Path(output_video_path).resolve()
        work_p = Path(work_dir).resolve()
        work_p.mkdir(parents=True, exist_ok=True)

        audio_dir = work_p / "audios"
        seg_dir = work_p / "segments"
        audio_dir.mkdir(parents=True, exist_ok=True)
        seg_dir.mkdir(parents=True, exist_ok=True)

        def report(percent: float, stage: str, message: str, data: Optional[Dict[str, Any]] = None):
            if progress_cb:
                payload = {
                    "percent": round(percent, 1),
                    "stage": stage,
                    "message": message,
                    "data": data or {},
                }
                progress_cb(payload)

        # ---------------------------------------------------------------------
        # Step 1: Probe video & build continuous segments
        # ---------------------------------------------------------------------
        report(5.0, "init", "Đang phân tích cấu trúc video gốc...")
        video_meta = get_video_metadata(video_p)

        timeline_segs = SRTParser.build_timeline_segments(
            subtitles=subtitles,
            total_video_duration=video_meta.duration,
        )

        dub_segs = [s for s in timeline_segs if s.seg_type == "dub"]
        total_dubs = len(dub_segs)
        total_segs = len(timeline_segs)

        # ---------------------------------------------------------------------
        # Step 2: Generate TTS Audio for all dubbed subtitles (with Cache & Error Gathering)
        # ---------------------------------------------------------------------
        report(10.0, "tts", f"Bắt đầu tạo {total_dubs} câu giọng đọc AI qua CapCut TTS...")
        completed_tts = 0

        def task_gen_tts(seg: TimelineSegment):
            nonlocal completed_tts
            audio_file = audio_dir / f"audio_seg_{seg.seg_id:04d}.mp3"

            try:
                # Reuse valid cached audio if available
                if not (audio_file.exists() and audio_file.stat().st_size > 500):
                    self.tts_client.generate_speech_to_file(
                        text=seg.text_dub,
                        output_file=audio_file,
                        voice=voice,
                        rate=voice_rate,
                    )

                aud_dur = get_audio_duration(audio_file)
                seg.audio_path = str(audio_file)
                seg.audio_duration_sec = round(aud_dur, 3)
                seg.ratio = round(seg.duration_sec / max(0.01, aud_dur), 2)
                seg.tts_error = None
                seg.is_failed = False

                self._calculate_sync_parameters(seg, aud_dur)

            except Exception as exc:
                seg.tts_error = str(exc)
                seg.is_failed = True
                seg.audio_path = None
                seg.audio_duration_sec = None
                seg.sync_mode = "passthrough"
                seg.sync_desc = f"Lỗi CapCut TTS: {exc}"
                logger.warning(f"TTS segment #{seg.seg_id} failed: {exc}")

            completed_tts += 1
            pct = 10.0 + (completed_tts / max(1, total_dubs)) * 35.0
            report(
                pct,
                "tts",
                f"Đã xử lý {completed_tts}/{total_dubs} audio: \"{seg.text_dub[:25]}...\" ({seg.sync_desc})",
                {
                    "seg_id": seg.seg_id,
                    "ratio": seg.ratio,
                    "sync_mode": seg.sync_mode,
                    "speed_applied": seg.speed_applied,
                    "video_speed_applied": seg.video_speed_applied,
                    "sync_desc": seg.sync_desc,
                    "is_failed": seg.is_failed,
                    "tts_error": seg.tts_error,
                },
            )
            return seg

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(self.num_workers, 50))) as executor:
            futures = [executor.submit(task_gen_tts, seg) for seg in dub_segs]
            for f in concurrent.futures.as_completed(futures):
                f.result()

        # Sort timeline segments by seg_id
        timeline_segs.sort(key=lambda s: s.seg_id)

        # Check for failed TTS segments
        failed_segs = [s for s in timeline_segs if s.seg_type == "dub" and (s.is_failed or not s.audio_path)]
        if failed_segs and not kwargs.get("skip_failed_auto", False):
            report(45.0, "tts_needs_review", f"Có {len(failed_segs)} câu bị lỗi CapCut cần xử lý.", {
                "failed_segments": [s.to_dict() for s in failed_segs],
                "timeline": [s.to_dict() for s in timeline_segs],
            })
            return {
                "status": "needs_review",
                "stage": "tts_needs_review",
                "message": f"Có {len(failed_segs)} câu bị lỗi CapCut cần xử lý.",
                "failed_segments": [s.to_dict() for s in failed_segs],
                "timeline": [s.to_dict() for s in timeline_segs],
            }

        return self.render_remaining_pipeline(
            video_p=video_p,
            timeline_segs=timeline_segs,
            output_video_path=output_video_path,
            work_p=work_p,
            video_meta=video_meta,
            progress_cb=progress_cb,
        )

    def _calculate_sync_parameters(self, seg: TimelineSegment, aud_dur: float):
        """Calculate sync mode and speeds for audio and video based on limits."""
        if abs(aud_dur - seg.duration_sec) < 0.05:
            seg.sync_mode = "passthrough"
            seg.speed_applied = 1.0
            seg.video_speed_applied = 1.0
            seg.sync_desc = "Chuẩn 1.0x (Khớp)"

        elif aud_dur < seg.duration_sec:
            # AI Voice is SHORTER than video segment (can slow down voice or speed up video)
            req_audio_speed = round(aud_dur / max(0.01, seg.duration_sec), 2)
            if req_audio_speed >= self.min_audio_speed and self.min_audio_speed < 0.999:
                seg.sync_mode = "rubberband"
                seg.speed_applied = req_audio_speed
                seg.video_speed_applied = 1.0
                seg.sync_desc = f"Giảm giọng {req_audio_speed:.2f}x (Video 1.0x)"
            else:
                req_v_speed = round(seg.duration_sec / max(0.01, aud_dur), 2)
                v_speed = min(self.max_video_speed, req_v_speed)
                if v_speed > 1.01:
                    seg.sync_mode = "setpts"
                    seg.speed_applied = 1.0
                    seg.video_speed_applied = v_speed
                    seg.sync_desc = f"Tăng video {v_speed:.2f}x (Giọng 1.0x)"
                else:
                    seg.sync_mode = "passthrough"
                    seg.speed_applied = 1.0
                    seg.video_speed_applied = 1.0
                    seg.sync_desc = "Chuẩn 1.0x (Khớp)"
        else:
            # AI Voice is LONGER than video segment (can speed up voice or slow down video)
            req_audio_speed = round(aud_dur / max(0.01, seg.duration_sec), 2)
            if req_audio_speed <= self.max_audio_speed and self.max_audio_speed > 1.001:
                seg.sync_mode = "rubberband"
                seg.speed_applied = req_audio_speed
                seg.video_speed_applied = 1.0
                seg.sync_desc = f"Tăng giọng {req_audio_speed:.2f}x (Video 1.0x)"
            else:
                req_v_speed = round(seg.duration_sec / max(0.01, aud_dur), 2)
                v_speed = max(self.min_video_speed, req_v_speed)
                if v_speed < 0.99:
                    seg.sync_mode = "setpts"
                    seg.speed_applied = 1.0
                    seg.video_speed_applied = v_speed
                    seg.sync_desc = f"Chậm video {v_speed:.2f}x (Giọng 1.0x)"
                else:
                    seg.sync_mode = "passthrough"
                    seg.speed_applied = 1.0
                    seg.video_speed_applied = 1.0
                    seg.sync_desc = "Chuẩn 1.0x (Khớp)"

    def retry_single_tts_segment(
        self,
        seg: TimelineSegment,
        text_dub: str,
        work_dir: Union[str, Path],
        voice: Optional[str] = "BV421_vivn_streaming",
        voice_rate: Optional[str] = "1.0",
    ) -> TimelineSegment:
        """Re-generate TTS audio for a specific segment with updated or original text."""
        audio_dir = Path(work_dir) / "audios"
        audio_dir.mkdir(parents=True, exist_ok=True)
        audio_file = audio_dir / f"audio_seg_{seg.seg_id:04d}.mp3"

        seg.text_dub = text_dub.strip()
        if audio_file.exists():
            try:
                audio_file.unlink()
            except Exception:
                pass

        self.tts_client.generate_speech_to_file(
            text=seg.text_dub,
            output_file=audio_file,
            voice=voice,
            rate=voice_rate,
        )
        aud_dur = get_audio_duration(audio_file)
        seg.audio_path = str(audio_file)
        seg.audio_duration_sec = round(aud_dur, 3)
        seg.ratio = round(seg.duration_sec / max(0.01, aud_dur), 2)
        seg.tts_error = None
        seg.is_failed = False
        self._calculate_sync_parameters(seg, aud_dur)
        return seg

    def render_remaining_pipeline(
        self,
        video_p: Path,
        timeline_segs: List[TimelineSegment],
        output_video_path: Union[str, Path],
        work_p: Path,
        video_meta: VideoMetadata,
        progress_cb: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """
        Step 3 (High-Speed Voice Track Render & Full Background Audio Mix)
        and Step 4 (Video Render & Mux).
        """
        out_p = Path(output_video_path)
        seg_dir = work_p / "segments"
        seg_dir.mkdir(parents=True, exist_ok=True)
        total_segs = len(timeline_segs)
        total_dubs = sum(1 for s in timeline_segs if s.seg_type == "dub")

        def report(percent: float, stage: str, message: str, data: Optional[Dict[str, Any]] = None):
            if progress_cb:
                progress_cb({
                    "percent": round(percent, 1),
                    "stage": stage,
                    "message": message,
                    "data": data or {},
                })

        # Check if video speed modification is needed
        has_video_speed_change = any(abs((s.video_speed_applied or 1.0) - 1.0) > 0.01 for s in timeline_segs)
        has_orig_audio = video_meta.has_audio and self.orig_volume > 0.001

        # ---------------------------------------------------------------------
        # Step 3.1: Render AI voice segments in parallel
        # (Instant 0s pure-Python silence for gaps, lightweight MP3 filter for dubs)
        # ---------------------------------------------------------------------
        report(45.0, "audio_render", f"Đang đồng bộ hóa {total_segs} đoạn giọng đọc AI...")
        completed_auds = 0

        def task_render_voice_seg(seg: TimelineSegment) -> str:
            nonlocal completed_auds
            out_aud_path = seg_dir / f"voice_seg_{seg.seg_id:04d}.wav"
            seg.output_segment_path = str(out_aud_path)

            self._render_single_voice_segment(
                seg=seg,
                output_path=out_aud_path,
            )

            completed_auds += 1
            if completed_auds % 25 == 0 or completed_auds == total_segs:
                pct = 45.0 + (completed_auds / max(1, total_segs)) * 25.0
                report(
                    pct,
                    "audio_render",
                    f"Đã chuẩn bị giọng đọc AI {completed_auds}/{total_segs} [{seg.seg_type.upper()}] ({seg.sync_desc})",
                    {"seg_id": seg.seg_id, "seg_type": seg.seg_type, "sync_mode": seg.sync_mode},
                )
            return str(out_aud_path)

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(self.num_workers, 32))) as executor:
            futures = [executor.submit(task_render_voice_seg, seg) for seg in timeline_segs]
            for f in concurrent.futures.as_completed(futures):
                f.result()

        # Concat all voice segments into full AI voice track
        report(70.0, "concat_audio", "Đang ghép nối toàn bộ track giọng đọc AI...")
        concat_list_path = work_p / "concat_voice_list.txt"
        with open(concat_list_path, "w", encoding="utf-8") as f:
            for seg in timeline_segs:
                if seg.output_segment_path and os.path.exists(seg.output_segment_path):
                    safe_path = seg.output_segment_path.replace("\\", "/")
                    f.write(f"file '{safe_path}'\n")

        full_voice_path = work_p / "full_voice_ai.wav"
        concat_voice_cmd = [
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", str(concat_list_path),
            "-c:a", "pcm_s16le",
            str(full_voice_path),
        ]
        subprocess.run(concat_voice_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)

        # ---------------------------------------------------------------------
        # Step 3.2: Extract background audio track and adjust volume for entire track in 1 go
        # ---------------------------------------------------------------------
        full_audio_path = work_p / "full_dubbed_audio.wav"

        if has_orig_audio:
            vol_pct = int(self.orig_volume * 100)
            report(75.0, "audio_render", f"Đang hạ âm lượng toàn bộ track âm thanh gốc ({vol_pct}%) và hòa âm...")
            bg_audio_path = work_p / "full_bg_audio.wav"

            # Extract entire video audio track and lower volume in 1 single command (lightning fast!)
            extract_bg_cmd = [
                "ffmpeg", "-y",
                "-i", str(video_p),
                "-vn",
                "-af", f"volume={self.orig_volume:.4f},aresample=48000:async=1",
                "-c:a", "pcm_s16le",
                "-ar", "48000",
                "-ac", "2",
                str(bg_audio_path),
            ]
            subprocess.run(extract_bg_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)

            # Mix lowered background track + AI voice track in 1 single command
            mix_cmd = [
                "ffmpeg", "-y",
                "-i", str(bg_audio_path),
                "-i", str(full_voice_path),
                "-filter_complex", "amix=inputs=2:duration=first:dropout_transition=0",
                "-c:a", "pcm_s16le",
                "-ar", "48000",
                "-ac", "2",
                str(full_audio_path),
            ]
            subprocess.run(mix_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        else:
            # If no original audio or orig_volume == 0, full audio track is directly the full voice track
            full_audio_path = full_voice_path

        # ---------------------------------------------------------------------
        # Step 4: Single-Pass Video Pipeline (Stream Copy OR Single-Pass FilterGraph)
        # ---------------------------------------------------------------------
        if not has_video_speed_change:
            # === SUPER FAST LOSSLESS MODE (-c:v copy) ===
            report(85.0, "video_render", "Kích hoạt Siêu Tốc (Lossless Stream Copy - 0s video encode)...")
            final_mux_cmd = [
                "ffmpeg", "-y",
                "-i", str(video_p),
                "-i", str(full_audio_path),
                "-map", "0:v:0",
                "-map", "1:a:0",
                "-c:v", "copy",
                "-c:a", "aac",
                "-b:a", "192k",
                "-movflags", "+faststart",
                str(out_p),
            ]
            res = subprocess.run(final_mux_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if res.returncode != 0:
                raise RuntimeError(f"Fast Stream Copy Mux failed: {res.stderr.strip() or 'Unknown error'}")

        else:
            # === SINGLE-PASS FILTERGRAPH PIPELINE ===
            target_fps = 30.0 if video_meta.fps <= 0 else min(60.0, video_meta.fps)
            v_encoder_params = get_best_video_encoder_params(target_fps)
            enc_name = v_encoder_params[1]
            report(80.0, "video_render", f"Đang render Video toàn bộ trong 1 lệnh duy nhất bằng GPU ({enc_name})...")

            # Build in-graph filter script
            filter_lines = []
            concat_tags = []
            for i, seg in enumerate(timeline_segs):
                v_speed = seg.video_speed_applied or 1.0
                pts_factor = 1.0 / max(0.1, v_speed)
                if abs(pts_factor - 1.0) < 0.001:
                    filter_lines.append(f"[0:v]trim=start={seg.start_sec:.3f}:end={seg.end_sec:.3f},setpts=PTS-STARTPTS[v{i}];")
                else:
                    filter_lines.append(f"[0:v]trim=start={seg.start_sec:.3f}:end={seg.end_sec:.3f},setpts={pts_factor:.4f}*(PTS-STARTPTS)[v{i}];")
                concat_tags.append(f"[v{i}]")

            filter_lines.append(f"{''.join(concat_tags)}concat=n={len(timeline_segs)}:v=1:a=0[vout]")
            video_filter_script = work_p / "video_filter_complex.txt"
            video_filter_script.write_text("\n".join(filter_lines), encoding="utf-8")

            single_pass_cmd = [
                "ffmpeg", "-y",
                "-i", str(video_p),
                "-i", str(full_audio_path),
                "-filter_complex_script", str(video_filter_script),
                "-map", "[vout]",
                "-map", "1:a:0",
            ] + v_encoder_params + [
                "-c:a", "aac",
                "-b:a", "192k",
                "-movflags", "+faststart",
                str(out_p),
            ]

            res = subprocess.run(single_pass_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
            if res.returncode != 0:
                report(85.0, "video_render", "GPU bận, chuyển sang chế độ CPU Ultrafast Single-Pass...")
                cpu_v_params = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", str(target_fps)]
                cpu_cmd = [
                    "ffmpeg", "-y",
                    "-i", str(video_p),
                    "-i", str(full_audio_path),
                    "-filter_complex_script", str(video_filter_script),
                    "-map", "[vout]",
                    "-map", "1:a:0",
                ] + cpu_v_params + [
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-movflags", "+faststart",
                    str(out_p),
                ]
                cpu_res = subprocess.run(cpu_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
                if cpu_res.returncode != 0:
                    raise RuntimeError(f"Single-Pass Video Render failed: {cpu_res.stderr.strip() or 'Unknown error'}")

        # Export synchronized SRT file alongside final MP4
        out_srt_p = out_p.with_suffix(".srt")
        try:
            SRTParser.export_synced_srt(timeline_segs, out_srt_p)
        except Exception as e:
            logger.warning(f"Could not export synced SRT: {e}")

        report(100.0, "completed", "Hoàn tất! Video & Phụ đề SRT đã được xuất thành công.", {
            "output_path": str(out_p),
            "output_srt_path": str(out_srt_p) if out_srt_p.exists() else None,
            "total_segments": total_segs,
            "dubbed_segments": total_dubs,
            "timeline": [s.to_dict() for s in timeline_segs],
        })

        return {
            "status": "completed",
            "output_path": str(out_p),
            "output_srt_path": str(out_srt_p) if out_srt_p.exists() else None,
            "total_segments": total_segs,
            "dubbed_segments": total_dubs,
            "timeline": [s.to_dict() for s in timeline_segs],
        }

    def _render_single_voice_segment(
        self,
        seg: TimelineSegment,
        output_path: Path,
    ):
        """
        Render voice stream for a single segment (only touches tiny MP3 TTS files,
        never touches the heavy video file).
        """
        # Calculate exact target output duration for this segment
        if seg.seg_type == "dub" and seg.sync_mode == "setpts":
            v_speed = seg.video_speed_applied or seg.ratio or 1.0
            target_dur = seg.duration_sec / max(0.1, v_speed)
        else:
            target_dur = seg.duration_sec

        # Case 1: Gap or failed/missing TTS audio -> instant pure Python silence WAV (0ms!)
        if seg.seg_type == "gap" or seg.is_failed or not seg.audio_path or not Path(seg.audio_path).exists():
            create_silence_wav(output_path, duration_sec=target_dur)
            return

        # Case 2: Dub segment with valid TTS MP3
        audio_p = Path(seg.audio_path)
        a_common = ["-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2"]

        tempo = seg.speed_applied or 1.0
        if seg.sync_mode == "rubberband" and abs(tempo - 1.0) > 0.01:
            tempo = max(0.5, min(2.5, tempo))
            # Try rubberband first
            filter_str = f"rubberband=tempo={tempo:.4f},volume={self.dub_volume:.4f},aresample=48000:async=1,apad=whole_dur={target_dur:.4f},atrim=0:{target_dur:.4f}"
            cmd = [
                "ffmpeg", "-y",
                "-i", str(audio_p),
                "-vn",
                "-af", filter_str,
            ] + a_common + [str(output_path)]
            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
            if res.returncode != 0:
                # Fallback to built-in atempo
                filter_str = f"atempo={tempo:.4f},volume={self.dub_volume:.4f},aresample=48000:async=1,apad=whole_dur={target_dur:.4f},atrim=0:{target_dur:.4f}"
                cmd = [
                    "ffmpeg", "-y",
                    "-i", str(audio_p),
                    "-vn",
                    "-af", filter_str,
                ] + a_common + [str(output_path)]
                subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        else:
            # Passthrough 1.0x with volume and sample-accurate pad/trim
            filter_str = f"volume={self.dub_volume:.4f},aresample=48000:async=1,apad=whole_dur={target_dur:.4f},atrim=0:{target_dur:.4f}"
            cmd = [
                "ffmpeg", "-y",
                "-i", str(audio_p),
                "-vn",
                "-af", filter_str,
            ] + a_common + [str(output_path)]
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
