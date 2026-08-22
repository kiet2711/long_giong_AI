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


class FFmpegDubbingEngine:
    """
    Main engine to coordinate TTS generation, segment alignment,
    parallel FFmpeg encoding, and final concatenation.
    """

    def __init__(
        self,
        tts_client: Optional[CapCutTTSClient] = None,
        min_ratio: float = 0.90,
        max_ratio: float = 1.15,
        orig_volume: float = 0.15,
        dub_volume: float = 1.20,
        num_workers: int = 4,
    ):
        self.tts_client = tts_client or CapCutTTSClient()
        self.min_ratio = min_ratio
        self.max_ratio = max_ratio
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
        3. Measure audio durations, calculate ratio, and assign sync mode (rubberband vs setpts).
        4. Encode segments in parallel via FFmpeg.
        5. Concat demux all segments into final MP4 video.
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

            # Calculate ratio: Video Segment Duration / AI Audio Duration
            ratio = seg.duration_sec / max(0.01, aud_dur)
            seg.ratio = round(ratio, 3)

            # Assign Sync Mode (04a: rubberband vs 04b: setpts)
            if self.min_ratio <= ratio <= self.max_ratio:
                seg.sync_mode = "rubberband"
            else:
                seg.sync_mode = "setpts"

            completed_tts += 1
            pct = 10.0 + (completed_tts / max(1, total_dubs)) * 35.0
            report(
                pct,
                "tts",
                f"Đã tạo {completed_tts}/{total_dubs} audio: \"{seg.text_dub[:25]}...\" (Ratio: {seg.ratio:.2f}x)",
                {"seg_id": seg.seg_id, "ratio": seg.ratio, "sync_mode": seg.sync_mode},
            )
            return seg

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(self.num_workers, 200))) as executor:
            futures = [executor.submit(task_gen_tts, seg) for seg in dub_segs]
            for f in concurrent.futures.as_completed(futures):
                f.result()

        # ---------------------------------------------------------------------
        # Step 3: Encode each segment in parallel using FFmpeg
        # ---------------------------------------------------------------------
        report(45.0, "encode", f"Bắt đầu encode song song {total_segs} segments bằng FFmpeg...")
        completed_segs = 0

        # Standard video encoding parameters for seamless concat
        target_fps = 30.0 if video_meta.fps <= 0 else min(60.0, video_meta.fps)

        def task_encode_seg(seg: TimelineSegment) -> str:
            nonlocal completed_segs
            out_seg_path = seg_dir / f"seg_{seg.seg_id:04d}.mp4"
            seg.output_segment_path = str(out_seg_path)

            self._encode_single_segment(
                video_path=video_p,
                seg=seg,
                output_path=out_seg_path,
                video_meta=video_meta,
                target_fps=target_fps,
            )

            completed_segs += 1
            pct = 45.0 + (completed_segs / max(1, total_segs)) * 45.0
            report(
                pct,
                "encode",
                f"Đã render segment {completed_segs}/{total_segs} [{seg.seg_type.upper()}] "
                f"({seg.duration_sec:.1f}s, mode: {seg.sync_mode})",
                {"seg_id": seg.seg_id, "seg_type": seg.seg_type, "sync_mode": seg.sync_mode},
            )
            return str(out_seg_path)

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(self.num_workers, 64))) as executor:
            futures = [executor.submit(task_encode_seg, seg) for seg in timeline_segs]
            for f in concurrent.futures.as_completed(futures):
                f.result()

        # Sort timeline segments by seg_id
        timeline_segs.sort(key=lambda s: s.seg_id)

        # ---------------------------------------------------------------------
        # Step 4: Concat Demuxer (-c copy)
        # ---------------------------------------------------------------------
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

    def _encode_single_segment(
        self,
        video_path: Path,
        seg: TimelineSegment,
        output_path: Path,
        video_meta: VideoMetadata,
        target_fps: float,
    ):
        """Encode a single segment (gap or dub) with normalized streams."""
        # Common video encoding parameters
        v_common = [
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-r", str(target_fps),
            "-preset", "veryfast",
            "-crf", "20",
        ]
        # Common audio encoding parameters
        a_common = [
            "-c:a", "aac",
            "-b:a", "192k",
            "-ar", "48000",
            "-ac", "2",
        ]

        has_orig_audio = video_meta.has_audio and self.orig_volume > 0.001

        if seg.seg_type == "gap":
            # Gap Segment: Cut original video and audio with 1.0x speed, applying global orig_volume
            if has_orig_audio:
                filter_complex = f"[0:a]volume={self.orig_volume:.4f}[aout]"
                cmd = [
                    "ffmpeg", "-y",
                    "-ss", str(seg.start_sec),
                    "-t", str(seg.duration_sec),
                    "-i", str(video_path),
                    "-filter_complex", filter_complex,
                    "-map", "0:v:0",
                    "-map", "[aout]",
                ] + v_common + a_common + [str(output_path)]
            else:
                # Add silent audio track if original video has no audio or orig_volume is 0 (muted)
                cmd = [
                    "ffmpeg", "-y",
                    "-ss", str(seg.start_sec),
                    "-t", str(seg.duration_sec),
                    "-i", str(video_path),
                    "-f", "lavfi", "-t", str(seg.duration_sec), "-i", "anullsrc=r=48000:cl=stereo",
                    "-map", "0:v:0",
                    "-map", "1:a:0",
                ] + v_common + a_common + [str(output_path)]

            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if res.returncode != 0:
                raise RuntimeError(f"Failed to encode GAP segment {seg.seg_id}: {res.stderr}")

        elif seg.seg_type == "dub":
            # Dub Segment: Apply 04a (rubberband) or 04b (setpts)
            audio_p = Path(seg.audio_path)
            ratio = seg.ratio or 1.0

            if seg.sync_mode == "rubberband":
                # 04a: Keep video 1.0x, stretch audio
                # audio stretch tempo = 1 / ratio
                tempo = max(0.5, min(2.0, 1.0 / ratio))

                if has_orig_audio:
                    filter_complex = (
                        f"[0:a]volume={self.orig_volume:.4f}[bga]; "
                        f"[1:a]rubberband=tempo={tempo:.4f},volume={self.dub_volume:.4f}[duba]; "
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
                    filter_complex = f"[1:a]rubberband=tempo={tempo:.4f},volume={self.dub_volume:.4f}[aout]"
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
                # 04b: Change video speed using setpts, keep pristine AI voice 1.0x
                # setpts factor = 1 / ratio (makes video longer or shorter to match audio)
                setpts_factor = 1.0 / ratio

                if has_orig_audio:
                    # stretch background audio to match video duration
                    bg_tempo = max(0.5, min(2.0, ratio))
                    filter_complex = (
                        f"[0:v]setpts={setpts_factor:.4f}*PTS[vout]; "
                        f"[0:a]volume={self.orig_volume:.4f},rubberband=tempo={bg_tempo:.4f}[bga]; "
                        f"[1:a]volume={self.dub_volume:.4f}[duba]; "
                        f"[bga][duba]amix=inputs=2:duration=second:dropout_transition=0[aout]"
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
                        f"[1:a]volume={self.dub_volume:.4f}[aout]"
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

            res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if res.returncode != 0:
                # If rubberband failed, retry with atempo
                if "rubberband" in cmd[cmd.index("-filter_complex") + 1]:
                    self._retry_with_atempo(video_path, seg, output_path, video_meta, target_fps)
                else:
                    raise RuntimeError(f"Failed to encode DUB segment {seg.seg_id}: {res.stderr}")

    def _retry_with_atempo(
        self,
        video_path: Path,
        seg: TimelineSegment,
        output_path: Path,
        video_meta: VideoMetadata,
        target_fps: float,
    ):
        """Fallback filter using built-in atempo if rubberband has library issues."""
        has_orig_audio = video_meta.has_audio and self.orig_volume > 0.001
        ratio = seg.ratio or 1.0
        tempo = max(0.5, min(2.0, 1.0 / ratio))
        audio_p = Path(seg.audio_path)

        v_common = [
            "-c:v", "libx264", "-pix_fmt", "yuv420p",
            "-r", str(target_fps), "-preset", "veryfast", "-crf", "20",
        ]
        a_common = [
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
        ]

        if has_orig_audio:
            filter_complex = (
                f"[0:a]volume={self.orig_volume:.4f}[bga]; "
                f"[1:a]atempo={tempo:.4f},volume={self.dub_volume:.4f}[duba]; "
                f"[bga][duba]amix=inputs=2:duration=first:dropout_transition=0[aout]"
            )
        else:
            filter_complex = f"[1:a]atempo={tempo:.4f},volume={self.dub_volume:.4f}[aout]"

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

        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if res.returncode != 0:
            raise RuntimeError(f"Failed retry with atempo on segment {seg.seg_id}: {res.stderr}")
