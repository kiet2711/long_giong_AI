"""
Live CapCut TTS API Generation Test.
"""

import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from core.tts_client import CapCutTTSClient
from mutagen.mp3 import MP3

client = CapCutTTSClient()
test_text = "Xin chào, đây là bản thử nghiệm giọng đọc tự động."
out_file = Path("temp/live_tts_test.mp3")

print(f"Calling CapCut TTS API for text: '{test_text}'...")
try:
    path = client.generate_speech_to_file(
        text=test_text,
        output_file=out_file,
        voice="BV421_vivn_streaming",
        rate="1.0",
    )
    audio = MP3(path)
    print(f"Success! Audio saved to: {path}")
    print(f"Audio Duration: {audio.info.length:.2f} seconds, Bitrate: {audio.info.bitrate // 1000} kbps")
except Exception as e:
    print(f"TTS API Error: {e}")
