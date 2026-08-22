"""
Pure Python cryptography, payload signing, and request authentication for CapCut TTS API.
"""

import base64
import hashlib
import json
import secrets
import time
import uuid
from typing import Any, Dict, Optional, Tuple, Union

BASE_URL = "https://editor-api-sg.capcutapi.com"

DEFAULT_DEVICE = {
    "aid": "359289",
    "app_name": "CapCut",
    "appvr": "8.7.0",
    "version_name": "8.7.0",
    "version_code": "8.7.0",
    "channel": "capcutpc_google",
    "device_platform": "mac",
    "device_type": "MacBookPro17,4",
    "device_brand": "MacBookPro17,4",
    "os_version": "15.7.4",
    "device_id": "76471456455646328721",
    "iid": "76471456455646328721",
    "region": "VN",
    "loc": "VN",
    "lan": "vi-VN",
    "pf": "3",
    "tdid": "76471456455646328721",
}

TTS_SIGN_PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmTd34Lw4b7IuldSXh/zY
CMla+ITdGG5TeWz6ad+OySd4r+IrY45AoqrYUxhQ2dl+7z+i7r/5vEa8rr39BYfB
8AGMQLmZA8HmgpWBsqrn/V6daUALkKnkLb70Fn32CJigIuGXAYqxUdGuI340aC+0
v5Es3puJsHyzf01/AelE4Cdc6bZhQrASJLBh8R3BQToYClmDVSDUQk28o8sl/guA
Z4n303Vj+6Siv1HayPCdV6kpVVnMBAG4+umUbwGmn132N3fgpzLarFF3XyWmS1zh
D/J07iM/rP8GDO9IskHNHd2phrO0G6KzrcFAnTBHjVv+hCBEfzN/no3FNA9AuC36
mwIDAQAB
-----END PUBLIC KEY-----"""


class CapCutSignError(Exception):
    """Raised when signature generation fails."""
    pass


def compact_json(obj: Any) -> str:
    """Format python object into compact JSON string without whitespace."""
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def make_x_ss_stub(body_text: str) -> str:
    """Generate x-ss-stub header value (MD5 of request body)."""
    return hashlib.md5(body_text.encode("utf-8")).hexdigest()


def make_trace_id() -> str:
    """Generate unique W3C trace parent header ID."""
    seed = uuid.uuid4().hex[:32]
    return f"00-{seed}-{seed[:16]}-01"


def escape_xml(text: str) -> str:
    """Escape special XML characters for SSML generation."""
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _der_len(data: bytes, pos: int) -> Tuple[int, int]:
    first = data[pos]
    pos += 1
    if first < 0x80:
        return first, pos
    nbytes = first & 0x7F
    return int.from_bytes(data[pos : pos + nbytes], "big"), pos + nbytes


def _der_value(data: bytes, pos: int, tag: int) -> Tuple[bytes, int]:
    if data[pos] != tag:
        raise CapCutSignError(f"Bad DER tag: expected 0x{tag:02x}, got 0x{data[pos]:02x}")
    length, pos = _der_len(data, pos + 1)
    return data[pos : pos + length], pos + length


def _der_int(data: bytes, pos: int) -> Tuple[int, int]:
    raw, pos = _der_value(data, pos, 0x02)
    return int.from_bytes(raw.lstrip(b"\x00"), "big"), pos


def rsa_public_numbers_from_pem(pem: str) -> Tuple[int, int]:
    """Parse RSA modulus and exponent numbers from PEM formatted public key."""
    try:
        b64 = "".join(line for line in pem.splitlines() if not line.startswith("-----"))
        der = base64.b64decode(b64)
        outer, pos = _der_value(der, 0, 0x30)
        if pos != len(der):
            raise CapCutSignError("Trailing data in public key")
        _, pos = _der_value(outer, 0, 0x30)  # AlgorithmIdentifier
        bit_string, pos = _der_value(outer, pos, 0x03)
        if pos != len(outer) or not bit_string or bit_string[0] != 0:
            raise CapCutSignError("Bad subjectPublicKeyInfo")
        rsa_seq, pos = _der_value(bit_string[1:], 0, 0x30)
        if pos != len(bit_string[1:]):
            raise CapCutSignError("Trailing data in RSA public key")
        modulus, pos = _der_int(rsa_seq, 0)
        exponent, pos = _der_int(rsa_seq, pos)
        if pos != len(rsa_seq):
            raise CapCutSignError("Trailing integer data in RSA public key")
        return modulus, exponent
    except Exception as exc:
        if isinstance(exc, CapCutSignError):
            raise
        raise CapCutSignError(f"Failed to parse RSA PEM public key: {exc}") from exc


def rsa_encrypt_pkcs1v15(message: Union[str, bytes], pem: str = TTS_SIGN_PUBLIC_KEY_PEM) -> str:
    """
    Encrypt message using RSA PKCS#1 v1.5 with pure Python standard library.
    Returns Base64 encoded signature.
    """
    modulus, exponent = rsa_public_numbers_from_pem(pem)
    key_len = (modulus.bit_length() + 7) // 8
    msg = message.encode("utf-8") if isinstance(message, str) else bytes(message)
    if len(msg) > key_len - 11:
        raise CapCutSignError("Message too long for RSA PKCS#1 v1.5 padding")
    ps_len = key_len - len(msg) - 3
    ps = bytearray()
    while len(ps) < ps_len:
        chunk = secrets.token_bytes(ps_len - len(ps))
        ps.extend(b for b in chunk if b != 0)
    encoded = b"\x00\x02" + bytes(ps[:ps_len]) + b"\x00" + msg
    encrypted = pow(int.from_bytes(encoded, "big"), exponent, modulus).to_bytes(key_len, "big")
    return base64.b64encode(encrypted).decode("ascii")


def make_tts_payload_sign(ssml: str, extra_info: Optional[str], device_id: str, app_id: str) -> str:
    """Generate RSA PKCS#1 v1.5 signature for TTS task inner payload."""
    ssml_md5 = hashlib.md5(ssml.encode("utf-8")).hexdigest()
    sign_input = f"appid:{app_id}&did:{device_id}&creditDisable:false&ssml:{ssml_md5}"
    if extra_info is not None:
        sign_input += f"&extraInfo:{extra_info}"
    return rsa_encrypt_pkcs1v15(sign_input)


def make_sign_header(url: str, appvr: str, device_time: str, tdid: str) -> str:
    """Generate CapCut HTTP request sign header."""
    path = url.split("?", 1)[0]
    sign_str = f"9e2c|{path[-7:]}|3|{appvr}|{device_time}|{tdid}|11ac"
    return hashlib.md5(sign_str.encode("utf-8")).hexdigest()


def common_query(device: Dict[str, Any], babi_param: Any = None, include_region: bool = True) -> Dict[str, str]:
    """Build standard query parameter dict for CapCut API calls."""
    q = {
        "app_name": device.get("app_name", "CapCut"),
        "device_type": device.get("device_type", "MacBookPro17,4"),
        "os_version": device.get("os_version", "15.7.4"),
        "channel": device.get("channel", "capcutpc_google"),
        "version_name": device.get("version_name", "8.7.0"),
        "device_brand": device.get("device_brand", "MacBookPro17,4"),
        "device_id": str(device.get("device_id", "76471456455646328721")),
        "iid": str(device.get("iid", "76471456455646328721")),
        "version_code": device.get("version_code", "8.7.0"),
        "device_platform": device.get("device_platform", "mac"),
        "aid": str(device.get("aid", "359289")),
    }
    if include_region:
        q["region"] = device.get("region", "VN")
    if babi_param is not None:
        q["babi_param"] = compact_json(babi_param)
    return q


def base_headers(device: Dict[str, Any], body_text: str, appid: bool = False) -> Dict[str, str]:
    """Build base HTTP headers required by CapCut API endpoints."""
    now = str(int(time.time()))
    headers = {
        "content-type": "application/json",
        "appvr": device.get("appvr", "8.7.0"),
        "ch": device.get("channel", "capcutpc_google"),
        "device-time": now,
        "lan": device.get("lan", "vi-VN"),
        "loc": device.get("loc", "VN"),
        "pf": device.get("pf", "3"),
        "sign-ver": "1",
        "tdid": str(device.get("tdid", "76471456455646328721")),
        "x-ss-stub": make_x_ss_stub(body_text),
        "x-ss-dp": str(device.get("aid", "359289")),
        "x-khronos": now,
        "x-tt-trace-id": make_trace_id(),
        "user-agent": "Cronet/TTNetVersion:1d7cc3b1 2025-07-16 QuicVersion:52c2b40d 2025-04-03",
        "accept-encoding": "gzip, deflate",
        "store-country-code": device.get("loc", "VN").lower(),
        "store-country-code-src": "did",
        "is-dispatch-us-ttp": "0",
        "is-app-region-us-ttp": "0",
    }
    if appid:
        headers["app-sdk-version"] = device.get("appvr", "8.7.0")
        headers["appid"] = str(device.get("aid", "359289"))
    return headers
