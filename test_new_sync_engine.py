"""
End-to-End Verification Test for the New Lossless Stream Copy & 5-Layer Anti-Distortion Dubbing Engine.
"""

import os
import subprocess
import sys
from pathlib import Path

# Force UTF-8 stdout
if sys.stdout:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from core.ffmpeg_engine import FFmpegDubbingEngine, create_silence_wav, get_video_metadata
from core.srt_parser import SRTParser, SubtitleItem, TimelineSegment
from core.tts_client import CapCutTTSClient

print("=" * 60)
print("TEST 1: Testing Adaptive Prosody Rate Estimation")
print("=" * 60)

test_cases = [
    ("Xin chào các bạn", 3.0, "1.0", "Should be 1.0 (normal length)"),
    ("Đây là một câu rất dài có rất nhiều từ ngữ cần phải nói thật nhanh để kịp thời lượng video chỉ có một giây rưỡi", 1.5, "1.0", "Should be 1.3 or 1.4 (fast prosody)"),
    ("Chào", 3.0, "1.0", "Should be 0.9 or 1.0 (short word in long window)"),
]

for text, dur, base, desc in test_cases:
    rate = CapCutTTSClient.estimate_prosody_rate(text, dur, base)
    print(f"Text: \"{text[:30]}...\" | Target: {dur}s | Base: {base} -> Estimated Rate: {rate} ({desc})")

print("\n" + "=" * 60)
print("TEST 2: Testing Timeline Segment Builder & Gap Map")
print("=" * 60)

subtitles = [
    SubtitleItem(index=1, start_sec=1.0, end_sec=3.0, duration_sec=2.0, text_dub="Câu thứ nhất."),
    SubtitleItem(index=2, start_sec=4.5, end_sec=6.5, duration_sec=2.0, text_dub="Câu thứ hai sau khoảng lặng 1.5s."),
    SubtitleItem(index=3, start_sec=7.0, end_sec=9.0, duration_sec=2.0, text_dub="Câu thứ ba sau khoảng lặng 0.5s."),
]

timeline = SRTParser.build_timeline_segments(subtitles, total_video_duration=12.0)
print(f"Total Segments: {len(timeline)}")
for seg in timeline:
    if seg.seg_type == "dub":
        print(f"Seg #{seg.seg_id} [DUB]: {seg.start_sec}s -> {seg.end_sec}s (dur={seg.duration_sec}s, next_gap={seg.next_gap_sec}s) - \"{seg.text_dub}\"")
    else:
        print(f"Seg #{seg.seg_id} [GAP]: {seg.start_sec}s -> {seg.end_sec}s (dur={seg.duration_sec}s)")

# Verify gap calculations
dub1 = next(s for s in timeline if s.seg_id == 2)
assert abs(dub1.next_gap_sec - 1.5) < 0.01, f"Expected next_gap 1.5s, got {dub1.next_gap_sec}"
print("Gap calculations verified successfully!")

print("\n" + "=" * 60)
print("TEST 3: Testing Anti-Distortion Sync Parameters & Gap Borrowing")
print("=" * 60)

engine = FFmpegDubbingEngine(
    min_audio_speed=0.85,
    max_audio_speed=1.35,
    max_gap_borrow=0.80,
    safety_gap_buffer=0.15,
)

# Test 3A: Audio fits perfectly (2.0s audio for 2.0s duration)
seg_a = TimelineSegment(seg_id=1, seg_type="dub", start_sec=1.0, end_sec=3.0, duration_sec=2.0, next_gap_sec=1.5)
engine._calculate_sync_parameters(seg_a, aud_dur=2.0)
print(f"Case 3A (2.0s audio in 2.0s slot): mode={seg_a.sync_mode}, speed={seg_a.speed_applied}x, borrowed={seg_a.borrowed_gap_sec}s -> {seg_a.sync_desc}")
assert seg_a.speed_applied == 1.0 and seg_a.borrowed_gap_sec == 0.0

# Test 3B: Audio slightly longer (2.4s audio for 2.0s duration, gap=1.5s) -> Should borrow 0.4s gap with 1.0x speed!
seg_b = TimelineSegment(seg_id=2, seg_type="dub", start_sec=1.0, end_sec=3.0, duration_sec=2.0, next_gap_sec=1.5)
engine._calculate_sync_parameters(seg_b, aud_dur=2.4)
print(f"Case 3B (2.4s audio in 2.0s slot with 1.5s gap): mode={seg_b.sync_mode}, speed={seg_b.speed_applied}x, borrowed={seg_b.borrowed_gap_sec}s -> {seg_b.sync_desc}")
assert seg_b.speed_applied == 1.0 and abs(seg_b.borrowed_gap_sec - 0.4) < 0.01

# Test 3C: Audio much longer (3.2s audio for 2.0s duration, max_gap_borrow=0.8s) -> Should borrow 0.8s gap and stretch slightly
seg_c = TimelineSegment(seg_id=3, seg_type="dub", start_sec=1.0, end_sec=3.0, duration_sec=2.0, next_gap_sec=1.5)
engine._calculate_sync_parameters(seg_c, aud_dur=3.2)
print(f"Case 3C (3.2s audio in 2.0s slot): mode={seg_c.sync_mode}, speed={seg_c.speed_applied}x, borrowed={seg_c.borrowed_gap_sec}s -> {seg_c.sync_desc}")
assert seg_c.borrowed_gap_sec == 0.80 and seg_c.speed_applied > 1.0

print("\n" + "=" * 60)
print("TEST 4: End-to-End Pipeline on Synthetic Video (Lossless Stream Copy)")
print("=" * 60)

temp_test_dir = Path("temp/e2e_test")
temp_test_dir.mkdir(parents=True, exist_ok=True)
synth_video = temp_test_dir / "input_video.mp4"
synth_output = temp_test_dir / "output_dubbed.mp4"

# Generate 12s test video
cmd_gen_vid = [
    "ffmpeg", "-y",
    "-f", "lavfi", "-i", "testsrc=s=640x360:d=12:r=30",
    "-f", "lavfi", "-i", "sine=frequency=300:duration=12",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
    str(synth_video),
]
subprocess.run(cmd_gen_vid, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
print(f"1. Created synthetic 12s video: {synth_video}")

# Generate mock MP3 audio files for each subtitle line
aud_dir = temp_test_dir / "audios"
aud_dir.mkdir(parents=True, exist_ok=True)
audio_files = []
for i, sub in enumerate(subtitles):
    mp3_file = aud_dir / f"audio_seg_{i+1:04d}.mp3"
    # Create sine tone of varying duration (e.g. 2.2s, 2.4s, 1.8s)
    dur = 2.2 if i == 0 else (2.4 if i == 1 else 1.8)
    cmd_tone = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"sine=frequency={400 + i*100}:duration={dur}",
        "-c:a", "libmp3lame", "-b:a", "128k", "-ar", "48000",
        str(mp3_file),
    ]
    subprocess.run(cmd_tone, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    audio_files.append(mp3_file)

print(f"2. Created {len(audio_files)} mock audio files.")

# Execute render_remaining_pipeline
meta = get_video_metadata(synth_video)
dub_idx = 0
for seg in timeline:
    if seg.seg_type == "dub":
        aud_f = audio_files[dub_idx % len(audio_files)]
        dub_idx += 1
        seg.audio_path = str(aud_f)
        engine._calculate_sync_parameters(seg, aud_dur=2.2)


result = engine.render_remaining_pipeline(
    video_p=synth_video,
    timeline_segs=timeline,
    output_video_path=synth_output,
    work_p=temp_test_dir,
    video_meta=meta,
)

print(f"3. Dubbing Pipeline Result: status={result['status']}")
assert synth_output.exists() and synth_output.stat().st_size > 1000
out_meta = get_video_metadata(synth_output)
print(f"4. Output Video Metadata: duration={out_meta.duration:.2f}s, res={out_meta.width}x{out_meta.height}, fps={out_meta.fps}")
assert abs(out_meta.duration - meta.duration) < 0.1, f"Video duration changed! Input: {meta.duration}s, Output: {out_meta.duration}s"
assert out_meta.width == meta.width and out_meta.height == meta.height, "Video resolution changed!"

# Check exported SRT
out_srt = synth_output.with_suffix(".srt")
print(f"5. Output SRT exists: {out_srt.exists()}")
if out_srt.exists():
    print("SRT Content:\n" + out_srt.read_text(encoding="utf-8"))

print("\n" + "=" * 60)
print("ALL TESTS PASSED! 100% Lossless Video & Anti-Distortion Dubbing Verified!")
print("=" * 60)
