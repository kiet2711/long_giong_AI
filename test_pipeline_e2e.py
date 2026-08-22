"""
End-to-End Pipeline Integration Test.
"""

import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from core.ffmpeg_engine import FFmpegDubbingEngine, get_video_metadata
from core.srt_parser import SRTParser
from core.tts_client import CapCutTTSClient

print("=== Running End-to-End Dubbing & Concat Test ===")
video_path = Path("temp/synthetic_test.mp4")
srt_path = Path("temp/sample_test.srt")
out_video = Path("temp/final_dubbed_test.mp4")
work_dir = Path("temp/e2e_work")

subs = SRTParser.parse_srt_file(srt_path)
client = CapCutTTSClient()
engine = FFmpegDubbingEngine(tts_client=client, num_workers=2)

def on_prog(payload):
    print(f"   [{payload['percent']}%] {payload['stage'].upper()}: {payload['message']}")

result = engine.process_dubbing_pipeline(
    video_path=video_path,
    subtitles=subs,
    output_video_path=out_video,
    work_dir=work_dir,
    voice="BV421_vivn_streaming",
    progress_cb=on_prog,
)

print("\nPipeline finished!")
print(f"Final output video path: {result['output_path']}")
meta = get_video_metadata(out_video)
print(f"Output Video Duration: {meta.duration:.2f}s, Resolution: {meta.width}x{meta.height}, FPS: {meta.fps}")
