"""
Verification test for Gemini Client Integration.
"""

import sys
from core.gemini_client import (
    AVAILABLE_GEMINI_MODELS,
    GeminiClient,
    GeminiKeyPool,
)

if sys.stdout:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

print("=" * 60)
print("1. Checking Gemini Models Catalog")
print("=" * 60)
for m in AVAILABLE_GEMINI_MODELS:
    print(f"  - [{m['id']}]: {m['name']}")

assert len(AVAILABLE_GEMINI_MODELS) >= 5, "Missing models"

print("\n" + "=" * 60)
print("2. Checking Key Pool & Rotation")
print("=" * 60)
pool = GeminiKeyPool(["AIzaSyKey11111111111", "AIzaSyKey22222222222", "AIzaSyKey33333333333"])
print(f"Total keys: {pool.total_keys}")
print(f"Active key initial: {pool.mask_key(pool.get_active_key())}")
assert "1111" in pool.get_active_key()

pool.rotate_key()
print(f"Active key after rotation 1: {pool.mask_key(pool.get_active_key())}")
assert "2222" in pool.get_active_key()

pool.rotate_key()
print(f"Active key after rotation 2: {pool.mask_key(pool.get_active_key())}")
assert "3333" in pool.get_active_key()

pool.rotate_key()
print(f"Active key after rotation 3 (wrapped): {pool.mask_key(pool.get_active_key())}")
assert "1111" in pool.get_active_key()

print("\n" + "=" * 60)
print("3. Checking GeminiClient methods")
print("=" * 60)
client = GeminiClient(pool, default_model="gemini-2.5-flash-lite")
info = pool.get_keys_info()
print(f"Keys info: {info}")
assert len(info) == 3

print("\n" + "=" * 60)
print("ALL GEMINI INTEGRATION TESTS PASSED SUCCESSFULLY!")
print("=" * 60)
