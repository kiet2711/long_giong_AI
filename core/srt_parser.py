"""
Subtitle parser, timeline timeline segment builder, and gap detection.
"""

import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

try:
    import pysrt
except ImportError:
    pysrt = None


def clean_subtitle_text(text: str) -> str:
    """Remove HTML/ASS formatting tags from subtitle text."""
    if not text:
        return ""
    # Remove HTML tags like <i>, <b>, <font...>
    cleaned = re.sub(r"<[^>]+>", "", text)
    # Remove ASS/SSA tags like {\an8}, {\pos(x,y)}
    cleaned = re.sub(r"\{[^}]+\}", "", cleaned)
    # Replace multiple spaces/newlines with single space
    cleaned = " ".join(cleaned.split())
    return cleaned.strip()


def parse_time_str(time_str: str) -> float:
    """Convert SRT time string 'HH:MM:SS,mmm' or 'HH:MM:SS.mmm' to seconds float."""
    time_str = time_str.strip().replace(",", ".")
    parts = time_str.split(":")
    if len(parts) == 3:
        h, m, s = parts
        return int(h) * 3600 + int(m) * 60 + float(s)
    elif len(parts) == 2:
        m, s = parts
        return int(m) * 60 + float(s)
    return float(time_str)


def format_time_str(seconds: float) -> str:
    """Format seconds float to 'MM:SS.f' or 'HH:MM:SS.mmm'."""
    m = int(seconds // 60)
    s = seconds % 60
    return f"{m:02d}:{s:04.1f}"


def format_srt_timestamp(seconds: float) -> str:
    """Convert seconds to SRT timestamp 'HH:MM:SS,mmm'."""
    seconds = max(0.0, seconds)
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int(round((seconds - int(seconds)) * 1000))
    if millis >= 1000:
        secs += 1
        millis = 0
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


@dataclass
class SubtitleItem:
    """Single subtitle line item."""
    index: int
    start_sec: float
    end_sec: float
    duration_sec: float
    text_dub: str
    text_orig: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TimelineSegment:
    """
    Timeline block for audio/video processing:
    - 'dub': Subtitle line that requires AI voiceover.
    - 'gap': Silence or non-speech interval in original video.
    """
    seg_id: int
    seg_type: str  # 'dub' or 'gap'
    start_sec: float
    end_sec: float
    duration_sec: float
    text_dub: str = ""
    text_orig: str = ""
    audio_path: Optional[str] = None
    audio_duration_sec: Optional[float] = None
    ratio: Optional[float] = None  # duration_sec / audio_duration_sec
    sync_mode: Optional[str] = None  # 'rubberband', 'atempo', 'passthrough'
    speed_applied: Optional[float] = 1.0
    video_speed_applied: Optional[float] = 1.0  # Kept at 1.0 (video untouched)
    next_gap_sec: float = 0.0  # Available silence gap following this segment
    borrowed_gap_sec: float = 0.0  # Amount of gap duration borrowed by voice
    prosody_rate_applied: str = "1.0"  # Native SSML prosody rate
    speed_warning_level: str = "normal"  # 'normal', 'warning', 'critical'
    sync_desc: Optional[str] = ""
    output_segment_path: Optional[str] = None
    tts_error: Optional[str] = None
    is_failed: Optional[bool] = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)



class SRTParser:
    """Parser for single or paired SRT subtitle files."""

    @staticmethod
    def parse_srt_file(file_path: Union[str, Path]) -> List[SubtitleItem]:
        """Parse an SRT file into a list of SubtitleItem objects."""
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"SRT file not found: {file_path}")

        encodings = ["utf-8-sig", "utf-8", "cp1258", "latin-1"]
        raw_text = None
        for enc in encodings:
            try:
                with open(path, "r", encoding=enc) as f:
                    raw_text = f.read()
                break
            except UnicodeDecodeError:
                continue

        if raw_text is None:
            raise ValueError(f"Unable to decode SRT file {file_path} with supported encodings.")

        # Fallback to manual regex parsing if pysrt is absent or fails
        items: List[SubtitleItem] = []
        blocks = re.split(r"\n\s*\n", raw_text.strip())

        for block in blocks:
            lines = [l.strip() for l in block.splitlines() if l.strip()]
            if not lines:
                continue

            # First line might be index or timecode
            time_line_idx = 0
            if "-->" in lines[0]:
                time_line_idx = 0
            elif len(lines) > 1 and "-->" in lines[1]:
                time_line_idx = 1
            else:
                continue

            time_parts = lines[time_line_idx].split("-->")
            if len(time_parts) != 2:
                continue

            start_sec = parse_time_str(time_parts[0])
            end_sec = parse_time_str(time_parts[1])
            duration_sec = max(0.0, end_sec - start_sec)

            text_lines = lines[time_line_idx + 1 :]
            full_text = clean_subtitle_text(" ".join(text_lines))

            if full_text:
                items.append(
                    SubtitleItem(
                        index=len(items) + 1,
                        start_sec=round(start_sec, 3),
                        end_sec=round(end_sec, 3),
                        duration_sec=round(duration_sec, 3),
                        text_dub=full_text,
                    )
                )

        return items

    @classmethod
    def parse_paired_srt(
        cls,
        dub_srt_path: Union[str, Path],
        orig_srt_path: Optional[Union[str, Path]] = None,
    ) -> List[SubtitleItem]:
        """Parse dubbed SRT and optionally merge original language text from original SRT."""
        dub_items = cls.parse_srt_file(dub_srt_path)
        if not orig_srt_path:
            return dub_items

        orig_items = cls.parse_srt_file(orig_srt_path)
        for i, item in enumerate(dub_items):
            if i < len(orig_items):
                item.text_orig = orig_items[i].text_dub
            else:
                item.text_orig = ""
        return dub_items

    @classmethod
    def build_timeline_segments(
        cls,
        subtitles: List[SubtitleItem],
        total_video_duration: Optional[float] = None,
        min_gap_sec: float = 0.05,
    ) -> List[TimelineSegment]:
        """
        Build continuous timeline segments interleaving dubbed subtitle segments with gap intervals,
        and calculate available next silence gaps for intelligent gap borrowing.
        """
        segments: List[TimelineSegment] = []
        current_time = 0.0
        seg_id = 1

        for sub in subtitles:
            actual_start = max(current_time, sub.start_sec)
            actual_end = max(actual_start + 0.1, sub.end_sec)
            actual_duration = round(actual_end - actual_start, 3)

            # Check gap before this subtitle
            gap_duration = round(actual_start - current_time, 3)
            if gap_duration >= min_gap_sec:
                segments.append(
                    TimelineSegment(
                        seg_id=seg_id,
                        seg_type="gap",
                        start_sec=round(current_time, 3),
                        end_sec=round(actual_start, 3),
                        duration_sec=gap_duration,
                        sync_mode="passthrough",
                    )
                )
                seg_id += 1
                current_time = actual_start

            # Add dubbed subtitle segment
            segments.append(
                TimelineSegment(
                    seg_id=seg_id,
                    seg_type="dub",
                    start_sec=round(actual_start, 3),
                    end_sec=round(actual_end, 3),
                    duration_sec=actual_duration,
                    text_dub=sub.text_dub,
                    text_orig=sub.text_orig,
                )
            )
            seg_id += 1
            current_time = actual_end

        # Check trailing gap at the end of video
        if total_video_duration and (total_video_duration - current_time) >= min_gap_sec:
            segments.append(
                TimelineSegment(
                    seg_id=seg_id,
                    seg_type="gap",
                    start_sec=round(current_time, 3),
                    end_sec=round(total_video_duration, 3),
                    duration_sec=round(total_video_duration - current_time, 3),
                    sync_mode="passthrough",
                )
            )

        # Compute next_gap_sec for each dub segment to enable Smart Gap Borrowing
        for i, seg in enumerate(segments):
            if seg.seg_type == "dub":
                if i + 1 < len(segments) and segments[i + 1].seg_type == "gap":
                    seg.next_gap_sec = round(segments[i + 1].duration_sec, 3)
                else:
                    seg.next_gap_sec = 0.0

        return segments

    @classmethod
    def export_synced_srt(
        cls,
        timeline_segs: List[TimelineSegment],
        output_srt_path: Union[str, Path],
    ) -> Path:
        """Export SRT file aligned with actual voiceover timing on the original video timeline."""
        out_path = Path(output_srt_path)
        lines = []
        sub_index = 1

        for seg in timeline_segs:
            if seg.seg_type == "dub":
                start_t = seg.start_sec
                # If voice borrowed gap, adjust end time accordingly
                borrowed = seg.borrowed_gap_sec or 0.0
                end_t = round(seg.start_sec + seg.duration_sec + borrowed, 3)

                lines.append(f"{sub_index}")
                lines.append(f"{format_srt_timestamp(start_t)} --> {format_srt_timestamp(end_t)}")
                lines.append(seg.text_dub)
                lines.append("")

                sub_index += 1

        out_path.write_text("\n".join(lines), encoding="utf-8")
        return out_path

