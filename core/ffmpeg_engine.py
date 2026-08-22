"""
High-performance FFmpeg Dubbing & Sync Engine.
Handles audio stretching (rubberband), video speed adjusting (setpts),
parallel segment encoding, and instant concat demuxing.
"""

import concurrent.futures
import json
import os
import shutil
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from mutagen.mp3 import MP3

from core.srt_parser import SubtitleItem, TimelineSegment, SRTParser
from core.tts_client import CapCutTTSClient


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
    parallel FFmpeg encoding, and final concatenation.
    """

    def __init__(
        self,
        tts_client: Optional[CapCutTTSClient] = None,
        max_audio_speed: float = 1.15,
        min_video_speed: float = 0.50,
        min_ratio: Optional[float] = None,
        max_ratio: Optional[float] = None,
        orig_volume: float = 0.15,
        dub_volume: float = 1.20,
        num_workers: int = 4,
    ):
        self.tts_client = tts_client or CapCutTTSClient()
        # Support both max_audio_speed and legacy min_ratio
        if min_ratio is not None and max_audio_speed == 1.15:
            self.max_audio_speed = round(1.0 / max(0.1, min_ratio), 2)
        else:
            self.max_audio_speed = max_audio_speed
        self.min_video_speed = min_video_speed
        self.min_ratio = round(1.0 / max(0.1, self.max_audio_speed), 3)
        self.max_ratio = 1.0
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
    ) -> Dict[str, Any]:
        """
        Execute the full 6-step native dubbing pipeline:
        1. Parse video metadata & build continuous timeline segments (dubbing + gaps).
        2. Generate AI TTS audio for all dubbed subtitles in parallel.
        3. Measure audio durations, compare with user-defined audio & video speed limits.
        4. If no video speed change needed: Smart Lossless Stream Copy (-c:v copy) in ~1s!
           If video speed change needed: GPU NVENC hardware acceleration.
        5. Output final dubbed MP4 video.
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
        # Step 2: Generate TTS Audio for all dubbed subtitles
        # ---------------------------------------------------------------------
        report(10.0, "tts", f"Bắt đầu tạo {total_dubs} câu giọng đọc AI qua CapCut TTS...")
        completed_tts = 0

        def task_gen_tts(seg: TimelineSegment):
            nonlocal completed_tts
            audio_file = audio_dir / f"audio_seg_{seg.seg_id:04d}.mp3"
            # Call TTS client
            self.tts_client.generate_speech_to_file(
                text=seg.text_dub,
                output_file=audio_file,
                voice=voice,
                rate=voice_rate,
            )
            aud_dur = get_audio_duration(audio_file)
            seg.audio_path = str(audio_file)
            seg.audio_duration_sec = round(aud_dur, 3)

            # Assign Sync Mode based on Audio & Video Speed limits:
            if aud_dur <= seg.duration_sec:
                # 1. AI voice finishes within video segment duration -> 100% natural 1.0x voice & video
                seg.ratio = round(seg.duration_sec / max(0.01, aud_dur), 2)
                seg.sync_mode = "passthrough"
                seg.speed_applied = 1.0
                seg.video_speed_applied = 1.0
                seg.sync_desc = "Chuẩn 1.0x (Khớp)"
            else:
                # 2. AI voice is longer than video segment duration
                needed_speed = round(aud_dur / max(0.01, seg.duration_sec), 2)
                seg.ratio = round(seg.duration_sec / max(0.01, aud_dur), 2)

                if needed_speed <= self.max_audio_speed:
                    # Fits within allowed audio speedup limit (e.g. <= 1.15x)
                    seg.sync_mode = "rubberband"
                    seg.speed_applied = needed_speed
                    seg.video_speed_applied = 1.0
                    seg.sync_desc = f"Tăng giọng {needed_speed:.2f}x (Video 1.0x)"
                else:
                    # Exceeds max audio speed -> Slow down video
                    needed_v_speed = round(seg.duration_sec / max(0.01, aud_dur), 2)
                    v_speed = max(self.min_video_speed, needed_v_speed)
                    seg.sync_mode = "setpts"
                    seg.speed_applied = 1.0
                    seg.video_speed_applied = v_speed
                    seg.sync_desc = f"Chậm video {v_speed:.2f}x (Giọng 1.0x)"

            completed_tts += 1
            pct = 10.0 + (completed_tts / max(1, total_dubs)) * 35.0
            report(
                pct,
                "tts",
                f"Đã tạo {completed_tts}/{total_dubs} audio: \"{seg.text_dub[:25]}...\" ({seg.sync_desc})",
                {
                    "seg_id": seg.seg_id,
                    "ratio": seg.ratio,
                    "sync_mode": seg.sync_mode,
                    "speed_applied": seg.speed_applied,
                    "video_speed_applied": seg.video_speed_applied,
                    "sync_desc": seg.sync_desc,
                },
            )
            return seg

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(self.num_workers, 200))) as executor:
            futures = [executor.submit(task_gen_tts, seg) for seg in dub_segs]
            for f in concurrent.futures.as_completed(futures):
                f.result()

        # Sort timeline segments by seg_id
        timeline_segs.sort(key=lambda s: s.seg_id)

        # Check if video speed modification is needed
        has_video_speed_change = any(s.sync_mode == "setpts" for s in timeline_segs)

        # ---------------------------------------------------------------------
        # Step 3: Fast Audio-Only Stream Copy OR Full GPU Video Render
        # ---------------------------------------------------------------------
        if not has_video_speed_change:
            # === SUPER FAST LOSSLESS MODE (-c:v copy) ===
            # Video frames are 100% untouched. Only render audio track and mux in ~1 second!
            report(45.0, "encode", f"Kích hoạt chế độ Siêu Tốc (Stream Copy - 0s render video)...")
            completed_auds = 0

            def task_render_audio_seg(seg: TimelineSegment) -> str:
                nonlocal completed_auds
                out_aud_path = seg_dir / f"aud_seg_{seg.seg_id:04d}.m4a"
                seg.output_segment_path = str(out_aud_path)

                self._render_single_audio_segment(
                    video_path=video_p,
                    seg=seg,
                    output_path=out_aud_path,
                    video_meta=video_meta,
                )

                completed_auds += 1
                pct = 45.0 + (completed_auds / max(1, total_segs)) * 45.0
                report(
                    pct,
                    "encode",
                    f"Đã xử lý audio segment {completed_auds}/{total_segs} [{seg.seg_type.upper()}] ({seg.sync_desc})",
                    {"seg_id": seg.seg_id, "seg_type": seg.seg_type, "sync_mode": seg.sync_mode},
                )
                return str(out_aud_path)

            with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(self.num_workers, 64))) as executor:
                futures = [executor.submit(task_render_audio_seg, seg) for seg in timeline_segs]
                for f in concurrent.futures.as_completed(futures):
                    f.result()

            # Concat all audio segments into a single track
            report(90.0, "concat", "Đang ghép nối toàn bộ audio lồng tiếng...")
            concat_list_path = work_p / "concat_audio_list.txt"
            with open(concat_list_path, "w", encoding="utf-8") as f:
                for seg in timeline_segs:
                    if seg.output_segment_path and os.path.exists(seg.output_segment_path):
                        safe_path = seg.output_segment_path.replace("\\", "/")
                        f.write(f"file '{safe_path}'\n")

            full_audio_path = work_p / "full_dubbed_audio.m4a"
            concat_aud_cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", str(concat_list_path),
                "-c", "copy",
                str(full_audio_path),
            ]
            subprocess.run(concat_aud_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)

            # Mux with original video using -c:v copy (Instant!)
            report(95.0, "mux", "Đang đóng gói video thành phẩm (-c:v copy siêu tốc)...")
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
                raise RuntimeError(f"Fast Mux failed: {res.stderr}")

        else:
            # === GPU HARDWARE ACCELERATED VIDEO RENDER ===
            target_fps = 30.0 if video_meta.fps <= 0 else min(60.0, video_meta.fps)
            v_encoder_params = get_best_video_encoder_params(target_fps)
            enc_name = v_encoder_params[1]
            report(45.0, "encode", f"Bắt đầu encode song song {total_segs} segments bằng GPU ({enc_name})...")
            completed_segs = 0

            def task_encode_seg(seg: TimelineSegment) -> str:
                nonlocal completed_segs
                out_seg_path = seg_dir / f"seg_{seg.seg_id:04d}.mp4"
                seg.output_segment_path = str(out_seg_path)

                self._encode_single_segment(
                    video_path=video_p,
                    seg=seg,
                    output_path=out_seg_path,
                    video_meta=video_meta,
                    v_encoder_params=v_encoder_params,
                )

                completed_segs += 1
                pct = 45.0 + (completed_segs / max(1, total_segs)) * 45.0
                report(
                    pct,
                    "encode",
                    f"Đã render segment {completed_segs}/{total_segs} [{seg.seg_type.upper()}] ({seg.sync_desc})",
                    {"seg_id": seg.seg_id, "seg_type": seg.seg_type, "sync_mode": seg.sync_mode},
                )
                return str(out_seg_path)

            with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(self.num_workers, 32))) as executor:
                futures = [executor.submit(task_encode_seg, seg) for seg in timeline_segs]
                for f in concurrent.futures.as_completed(futures):
                    f.result()

            # Concat demuxer
            report(92.0, "concat", "Đang ghép nối toàn bộ video bằng FFmpeg Concat Demuxer...")
            concat_list_path = work_p / "concat_list.txt"
            with open(concat_list_path, "w", encoding="utf-8") as f:
                for seg in timeline_segs:
                    if seg.output_segment_path and os.path.exists(seg.output_segment_path):
                        safe_path = seg.output_segment_path.replace("\\", "/")
                        f.write(f"file '{safe_path}'\n")

            concat_cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", str(concat_list_path),
                "-c", "copy",
                "-movflags", "+faststart",
                str(out_p),
            ]
            res = subprocess.run(concat_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if res.returncode != 0:
                raise RuntimeError(f"FFmpeg Concat failed: {res.stderr}")

        report(100.0, "completed", "Hoàn tất! Video đã được lồng tiếng và xuất thành công.", {
            "output_path": str(out_p),
            "total_segments": total_segs,
            "dubbed_segments": total_dubs,
            "timeline": [s.to_dict() for s in timeline_segs],
        })

        return {
            "output_path": str(out_p),
            "total_segments": total_segs,
            "dubbed_segments": total_dubs,
            "timeline": [s.to_dict() for s in timeline_segs],
        }

    def _render_single_audio_segment(
        self,
        video_path: Path,
        seg: TimelineSegment,
        output_path: Path,
        video_meta: VideoMetadata,
    ):
        """Render audio-only stream for a single segment (super fast, 0s video encode)."""
        a_common = [
            "-c:a", "aac",
            "-b:a", "192k",
            "-ar", "48000",
            "-ac", "2",
        ]
        has_orig_audio = video_meta.has_audio and self.orig_volume > 0.001

        if seg.seg_type == "gap":
            if has_orig_audio:
                cmd = [
                    "ffmpeg", "-y",
                    "-ss", str(seg.start_sec),
                    "-t", str(seg.duration_sec),
                    "-i", str(video_path),
                    "-vn",
                    "-af", f"volume={self.orig_volume:.4f},aresample=48000:async=1",
                ] + a_common + [str(output_path)]
            else:
                cmd = [
                    "ffmpeg", "-y",
                    "-f", "lavfi", "-t", str(seg.duration_sec), "-i", "anullsrc=r=48000:cl=stereo",
                ] + a_common + [str(output_path)]

            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
            if res.returncode != 0:
                raise RuntimeError(f"Failed to render audio GAP segment {seg.seg_id}: {res.stderr.strip() or 'Unknown error'}")

        elif seg.seg_type == "dub":
            audio_p = Path(seg.audio_path)

            if seg.sync_mode == "passthrough":
                if has_orig_audio:
                    filter_complex = (
                        f"[0:a]volume={self.orig_volume:.4f},aresample=48000:async=1[bga]; "
                        f"[1:a]volume={self.dub_volume:.4f},aresample=48000:async=1[duba]; "
                        f"[bga][duba]amix=inputs=2:duration=first:dropout_transition=0[aout]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", str(seg.start_sec),
                        "-t", str(seg.duration_sec),
                        "-i", str(video_path),
                        "-i", str(audio_p),
                        "-vn",
                        "-filter_complex", filter_complex,
                        "-map", "[aout]",
                    ] + a_common + [str(output_path)]
                else:
                    filter_complex = f"[1:a]volume={self.dub_volume:.4f},aresample=48000:async=1,apad[aout]"
                    cmd = [
                        "ffmpeg", "-y",
                        "-t", str(seg.duration_sec),
                        "-i", str(audio_p),
                        "-vn",
                        "-filter_complex", filter_complex,
                        "-map", "[aout]",
                    ] + a_common + [str(output_path)]

            elif seg.sync_mode == "rubberband":
                tempo = max(1.0, min(2.0, seg.speed_applied or 1.0))
                if has_orig_audio:
                    filter_complex = (
                        f"[0:a]volume={self.orig_volume:.4f},aresample=48000:async=1[bga]; "
                        f"[1:a]rubberband=tempo={tempo:.4f},volume={self.dub_volume:.4f},aresample=48000:async=1[duba]; "
                        f"[bga][duba]amix=inputs=2:duration=first:dropout_transition=0[aout]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", str(seg.start_sec),
                        "-t", str(seg.duration_sec),
                        "-i", str(video_path),
                        "-i", str(audio_p),
                        "-vn",
                        "-filter_complex", filter_complex,
                        "-map", "[aout]",
                    ] + a_common + [str(output_path)]
                else:
                    filter_complex = f"[1:a]rubberband=tempo={tempo:.4f},volume={self.dub_volume:.4f},aresample=48000:async=1,apad[aout]"
                    cmd = [
                        "ffmpeg", "-y",
                        "-t", str(seg.duration_sec),
                        "-i", str(audio_p),
                        "-vn",
                        "-filter_complex", filter_complex,
                        "-map", "[aout]",
                    ] + a_common + [str(output_path)]

            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
            if res.returncode != 0:
                self._retry_audio_with_atempo(video_path, seg, output_path, video_meta)

    def _retry_audio_with_atempo(
        self,
        video_path: Path,
        seg: TimelineSegment,
        output_path: Path,
        video_meta: VideoMetadata,
    ):
        """Fallback audio filter using built-in atempo."""
        has_orig_audio = video_meta.has_audio and self.orig_volume > 0.001
        tempo = max(1.0, min(2.0, seg.speed_applied or 1.0))
        audio_p = Path(seg.audio_path)
        a_common = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"]

        if has_orig_audio:
            filter_complex = (
                f"[0:a]volume={self.orig_volume:.4f},aresample=48000:async=1[bga]; "
                f"[1:a]atempo={tempo:.4f},volume={self.dub_volume:.4f},aresample=48000:async=1[duba]; "
                f"[bga][duba]amix=inputs=2:duration=first:dropout_transition=0[aout]"
            )
            cmd = [
                "ffmpeg", "-y",
                "-ss", str(seg.start_sec),
                "-t", str(seg.duration_sec),
                "-i", str(video_path),
                "-i", str(audio_p),
                "-vn",
                "-filter_complex", filter_complex,
                "-map", "[aout]",
            ] + a_common + [str(output_path)]
        else:
            filter_complex = f"[1:a]atempo={tempo:.4f},volume={self.dub_volume:.4f},aresample=48000:async=1,apad[aout]"
            cmd = [
                "ffmpeg", "-y",
                "-t", str(seg.duration_sec),
                "-i", str(audio_p),
                "-vn",
                "-filter_complex", filter_complex,
                "-map", "[aout]",
            ] + a_common + [str(output_path)]

        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
        if res.returncode != 0:
            raise RuntimeError(f"Failed to render audio segment {seg.seg_id}: {res.stderr.strip() or 'Unknown error'}")

    def _encode_single_segment(
        self,
        video_path: Path,
        seg: TimelineSegment,
        output_path: Path,
        video_meta: VideoMetadata,
        v_encoder_params: List[str],
    ):
        """Encode a single segment (gap or dub) with GPU-accelerated video stream."""
        target_fps = 30.0 if video_meta.fps <= 0 else min(60.0, video_meta.fps)
        a_common = [
            "-c:a", "aac",
            "-b:a", "192k",
            "-ar", "48000",
            "-ac", "2",
        ]

        has_orig_audio = video_meta.has_audio and self.orig_volume > 0.001

        if seg.seg_type == "gap":
            if has_orig_audio:
                filter_complex = f"[0:a]volume={self.orig_volume:.4f},aresample=48000:async=1[aout]"
                cmd = [
                    "ffmpeg", "-y",
                    "-ss", str(seg.start_sec),
                    "-t", str(seg.duration_sec),
                    "-i", str(video_path),
                    "-filter_complex", filter_complex,
                    "-map", "0:v:0",
                    "-map", "[aout]",
                ] + v_encoder_params + a_common + [str(output_path)]
            else:
                cmd = [
                    "ffmpeg", "-y",
                    "-ss", str(seg.start_sec),
                    "-t", str(seg.duration_sec),
                    "-i", str(video_path),
                    "-f", "lavfi", "-t", str(seg.duration_sec), "-i", "anullsrc=r=48000:cl=stereo",
                    "-map", "0:v:0",
                    "-map", "1:a:0",
                ] + v_encoder_params + a_common + [str(output_path)]

            is_gpu = any("nvenc" in p or "qsv" in p for p in v_encoder_params)
            if is_gpu:
                with _GPU_SEMAPHORE:
                    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
            else:
                res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")

            if res.returncode != 0:
                self._retry_with_cpu_atempo(video_path, seg, output_path, video_meta, target_fps)

        elif seg.seg_type == "dub":
            audio_p = Path(seg.audio_path)
            ratio = seg.ratio or 1.0

            if seg.sync_mode == "passthrough":
                if has_orig_audio:
                    filter_complex = (
                        f"[0:a]volume={self.orig_volume:.4f},aresample=48000:async=1[bga]; "
                        f"[1:a]volume={self.dub_volume:.4f},aresample=48000:async=1[duba]; "
                        f"[bga][duba]amix=inputs=2:duration=first:dropout_transition=0[aout]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", str(seg.start_sec),
                        "-t", str(seg.duration_sec),
                        "-i", str(video_path),
                        "-i", str(audio_p),
                        "-filter_complex", filter_complex,
                        "-map", "0:v:0",
                        "-map", "[aout]",
                    ] + v_encoder_params + a_common + [str(output_path)]
                else:
                    filter_complex = f"[1:a]volume={self.dub_volume:.4f},aresample=48000:async=1,apad[aout]"
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", str(seg.start_sec),
                        "-t", str(seg.duration_sec),
                        "-i", str(video_path),
                        "-i", str(audio_p),
                        "-filter_complex", filter_complex,
                        "-map", "0:v:0",
                        "-map", "[aout]",
                    ] + v_encoder_params + a_common + [str(output_path)]

            elif seg.sync_mode == "rubberband":
                tempo = max(1.0, min(2.0, seg.speed_applied or (1.0 / ratio)))

                if has_orig_audio:
                    filter_complex = (
                        f"[0:a]volume={self.orig_volume:.4f},aresample=48000:async=1[bga]; "
                        f"[1:a]rubberband=tempo={tempo:.4f},volume={self.dub_volume:.4f},aresample=48000:async=1[duba]; "
                        f"[bga][duba]amix=inputs=2:duration=first:dropout_transition=0[aout]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", str(seg.start_sec),
                        "-t", str(seg.duration_sec),
                        "-i", str(video_path),
                        "-i", str(audio_p),
                        "-filter_complex", filter_complex,
                        "-map", "0:v:0",
                        "-map", "[aout]",
                    ] + v_encoder_params + a_common + [str(output_path)]
                else:
                    filter_complex = f"[1:a]rubberband=tempo={tempo:.4f},volume={self.dub_volume:.4f},aresample=48000:async=1,apad[aout]"
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", str(seg.start_sec),
                        "-t", str(seg.duration_sec),
                        "-i", str(video_path),
                        "-i", str(audio_p),
                        "-filter_complex", filter_complex,
                        "-map", "0:v:0",
                        "-map", "[aout]",
                    ] + v_encoder_params + a_common + [str(output_path)]

            else:
                v_speed = seg.video_speed_applied or ratio
                setpts_factor = 1.0 / max(0.1, v_speed)

                if has_orig_audio:
                    bg_tempo = max(0.25, min(4.0, v_speed))
                    filter_complex = (
                        f"[0:v]setpts={setpts_factor:.4f}*PTS[vout]; "
                        f"[0:a]volume={self.orig_volume:.4f},rubberband=tempo={bg_tempo:.4f},aresample=48000:async=1[bga]; "
                        f"[1:a]volume={self.dub_volume:.4f},aresample=48000:async=1[duba]; "
                        f"[bga][duba]amix=inputs=2:duration=longest:dropout_transition=0[aout]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", str(seg.start_sec),
                        "-t", str(seg.duration_sec),
                        "-i", str(video_path),
                        "-i", str(audio_p),
                        "-filter_complex", filter_complex,
                        "-map", "[vout]",
                        "-map", "[aout]",
                    ] + v_encoder_params + a_common + [str(output_path)]
                else:
                    filter_complex = (
                        f"[0:v]setpts={setpts_factor:.4f}*PTS[vout]; "
                        f"[1:a]volume={self.dub_volume:.4f},aresample=48000:async=1[aout]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", str(seg.start_sec),
                        "-t", str(seg.duration_sec),
                        "-i", str(video_path),
                        "-i", str(audio_p),
                        "-filter_complex", filter_complex,
                        "-map", "[vout]",
                        "-map", "[aout]",
                    ] + v_encoder_params + a_common + [str(output_path)]

            is_gpu = any("nvenc" in p or "qsv" in p for p in v_encoder_params)
            if is_gpu:
                with _GPU_SEMAPHORE:
                    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
            else:
                res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")

            if res.returncode != 0:
                self._retry_with_cpu_atempo(video_path, seg, output_path, video_meta, target_fps)

    def _retry_with_cpu_atempo(
        self,
        video_path: Path,
        seg: TimelineSegment,
        output_path: Path,
        video_meta: VideoMetadata,
        target_fps: float,
    ):
        """Ultra-reliable CPU fallback filter using libx264 ultrafast and atempo."""
        has_orig_audio = video_meta.has_audio and self.orig_volume > 0.001
        ratio = seg.ratio or 1.0
        audio_p = Path(seg.audio_path) if seg.audio_path else None

        v_common = [
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "20",
            "-pix_fmt", "yuv420p",
            "-r", str(target_fps),
        ]
        a_common = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"]

        if seg.seg_type == "gap" or not audio_p or not audio_p.exists():
            if has_orig_audio:
                cmd = [
                    "ffmpeg", "-y",
                    "-ss", str(seg.start_sec),
                    "-t", str(seg.duration_sec),
                    "-i", str(video_path),
                    "-filter_complex", f"[0:a]volume={self.orig_volume:.4f},aresample=48000:async=1[aout]",
                    "-map", "0:v:0",
                    "-map", "[aout]",
                ] + v_common + a_common + [str(output_path)]
            else:
                cmd = [
                    "ffmpeg", "-y",
                    "-ss", str(seg.start_sec),
                    "-t", str(seg.duration_sec),
                    "-i", str(video_path),
                    "-f", "lavfi", "-t", str(seg.duration_sec), "-i", "anullsrc=r=48000:cl=stereo",
                    "-map", "0:v:0",
                    "-map", "1:a:0",
                ] + v_common + a_common + [str(output_path)]
        else:
            if seg.sync_mode == "passthrough":
                if has_orig_audio:
                    filter_complex = (
                        f"[0:a]volume={self.orig_volume:.4f},aresample=48000:async=1[bga]; "
                        f"[1:a]volume={self.dub_volume:.4f},aresample=48000:async=1[duba]; "
                        f"[bga][duba]amix=inputs=2:duration=first:dropout_transition=0[aout]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", str(seg.start_sec),
                        "-t", str(seg.duration_sec),
                        "-i", str(video_path),
                        "-i", str(audio_p),
                        "-filter_complex", filter_complex,
                        "-map", "0:v:0",
                        "-map", "[aout]",
                    ] + v_common + a_common + [str(output_path)]
                else:
                    filter_complex = f"[1:a]volume={self.dub_volume:.4f},aresample=48000:async=1,apad[aout]"
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", str(seg.start_sec),
                        "-t", str(seg.duration_sec),
                        "-i", str(video_path),
                        "-i", str(audio_p),
                        "-filter_complex", filter_complex,
                        "-map", "0:v:0",
                        "-map", "[aout]",
                    ] + v_common + a_common + [str(output_path)]

            elif seg.sync_mode == "rubberband":
                tempo = max(1.0, min(2.0, seg.speed_applied or (1.0 / ratio)))
                if has_orig_audio:
                    filter_complex = (
                        f"[0:a]volume={self.orig_volume:.4f},aresample=48000:async=1[bga]; "
                        f"[1:a]atempo={tempo:.4f},volume={self.dub_volume:.4f},aresample=48000:async=1[duba]; "
                        f"[bga][duba]amix=inputs=2:duration=first:dropout_transition=0[aout]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", str(seg.start_sec),
                        "-t", str(seg.duration_sec),
                        "-i", str(video_path),
                        "-i", str(audio_p),
                        "-filter_complex", filter_complex,
                        "-map", "0:v:0",
                        "-map", "[aout]",
                    ] + v_common + a_common + [str(output_path)]
                else:
                    filter_complex = f"[1:a]atempo={tempo:.4f},volume={self.dub_volume:.4f},aresample=48000:async=1,apad[aout]"
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", str(seg.start_sec),
                        "-t", str(seg.duration_sec),
                        "-i", str(video_path),
                        "-i", str(audio_p),
                        "-filter_complex", filter_complex,
                        "-map", "0:v:0",
                        "-map", "[aout]",
                    ] + v_common + a_common + [str(output_path)]

            else:
                v_speed = seg.video_speed_applied or ratio
                setpts_factor = 1.0 / max(0.1, v_speed)
                bg_tempo = max(0.25, min(4.0, v_speed))
                if has_orig_audio:
                    filter_complex = (
                        f"[0:v]setpts={setpts_factor:.4f}*PTS[vout]; "
                        f"[0:a]volume={self.orig_volume:.4f},atempo={bg_tempo:.4f},aresample=48000:async=1[bga]; "
                        f"[1:a]volume={self.dub_volume:.4f},aresample=48000:async=1[duba]; "
                        f"[bga][duba]amix=inputs=2:duration=longest:dropout_transition=0[aout]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", str(seg.start_sec),
                        "-t", str(seg.duration_sec),
                        "-i", str(video_path),
                        "-i", str(audio_p),
                        "-filter_complex", filter_complex,
                        "-map", "[vout]",
                        "-map", "[aout]",
                    ] + v_common + a_common + [str(output_path)]
                else:
                    filter_complex = (
                        f"[0:v]setpts={setpts_factor:.4f}*PTS[vout]; "
                        f"[1:a]volume={self.dub_volume:.4f},aresample=48000:async=1[aout]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", str(seg.start_sec),
                        "-t", str(seg.duration_sec),
                        "-i", str(video_path),
                        "-i", str(audio_p),
                        "-filter_complex", filter_complex,
                        "-map", "[vout]",
                        "-map", "[aout]",
                    ] + v_common + a_common + [str(output_path)]

        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
        if res.returncode != 0:
            err_msg = res.stderr.strip() if res.stderr else "Unknown FFmpeg error"
            raise RuntimeError(f"Failed to encode segment {seg.seg_id}: {err_msg}")
