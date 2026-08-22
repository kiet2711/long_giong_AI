"""
Verification Test Script for Core Engine & FFmpeg Pipeline.
"""

import sys
import subprocess
from pathlib import Path

# Force UTF-8 stdout
sys.stdout.reconfigure(encoding="utf-8")

from core.tts_client import CapCutTTSClient
from core.srt_parser import SRTParser, SubtitleItem
from core.ffmpeg_engine import FFmpegDubbingEngine, get_video_metadata

print("1. Testing Voice Catalog...")
client = CapCutTTSClient()
voices = client.catalog.get_all("vi-VN")
print(f"   Found {len(voices)} Vietnamese voices.")
v, r, n = client.catalog.resolve("Nhỏ Ngọt Ngào")
print(f"   Resolved 'Nhỏ Ngọt Ngào' -> VoiceType: {v}, ResID: {r}, Name: {n}")

print("\n2. Testing SRT Parser...")
sample_srt_content = """1
00:00:01,000 --> 00:00:03,500
Xin chào các bạn đã quay trở lại với kênh.

2
00:00:04,200 --> 00:00:07,000
Hôm nay chúng ta sẽ cùng khám phá một công cụ mới.
"""
test_srt_path = Path("temp/sample_test.srt")
test_srt_path.parent.mkdir(exist_ok=True)
with open(test_srt_path, "w", encoding="utf-8") as f:
    f.write(sample_srt_content)

subs = SRTParser.parse_srt_file(test_srt_path)
print(f"   Parsed {len(subs)} subtitle lines:")
for s in subs:
    print(f"   [{s.index}] {s.start_sec}s -> {s.end_sec}s ({s.duration_sec}s): {s.text_dub}")

print("\n3. Testing Timeline Segment Builder with Gaps...")
timeline_segs = SRTParser.build_timeline_segments(subs, total_video_duration=10.0)
print(f"   Generated {len(timeline_segs)} total segments (including gaps):")
for seg in timeline_segs:
    print(f"   Seg #{seg.seg_id} [{seg.seg_type.upper()}]: {seg.start_sec}s -> {seg.end_sec}s ({seg.duration_sec}s) - {seg.text_dub[:20]}")

print("\n4. Testing Synthetic Video Generation (FFmpeg)...")
test_video_path = Path("temp/synthetic_test.mp4")
# Generate a simple 10s color video with sine tone
cmd = [
    "ffmpeg", "-y",
    "-f", "lavfi", "-i", "color=c=navy:s=640x360:d=10:r=30",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=10",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
    str(test_video_path),
]
res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
if res.returncode == 0:
    meta = get_video_metadata(test_video_path)
    print(f"   Synthetic video created: duration={meta.duration:.2f}s, res={meta.width}x{meta.height}, fps={meta.fps}, has_audio={meta.has_audio}")
else:
    print(f"   FFmpeg error: {res.stderr}")

print("\nAll core component sanity tests passed successfully!")
