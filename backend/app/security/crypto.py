from __future__ import annotations

import base64
import hashlib
import hmac
import json
from decimal import Decimal
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import get_settings


def sha256_hex(data: bytes | str) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def _json_default(obj: Any) -> Any:
    """Make DB NUMERIC/Decimal (and similar) JSON-safe."""
    if isinstance(obj, Decimal):
        return float(obj)
    if hasattr(obj, "isoformat"):
        return obj.isoformat()
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def canonical_json(payload: Any) -> str:
    return json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=_json_default,
    )


def dumps_json(payload: Any) -> str:
    """json.dumps for DB-bound jsonb payloads (Decimal-safe)."""
    return json.dumps(payload, ensure_ascii=False, default=_json_default)


def hash_payload(payload: Any) -> str:
    return sha256_hex(canonical_json(payload))


def hmac_sign(data: bytes | str) -> str:
    settings = get_settings()
    if isinstance(data, str):
        data = data.encode("utf-8")
    key = settings.artifact_hmac_key.encode("utf-8")
    return hmac.new(key, data, hashlib.sha256).hexdigest()


def _aes_key() -> bytes:
    raw = get_settings().app_master_encryption_key.strip()
    # Accept keys without padding
    padded = raw + ("=" * (-len(raw) % 4))
    try:
        key = base64.urlsafe_b64decode(padded)
    except Exception as exc:  # noqa: BLE001
        raise ValueError("APP_MASTER_ENCRYPTION_KEY must be urlsafe base64 of 32 bytes") from exc
    if len(key) != 32:
        raise ValueError("APP_MASTER_ENCRYPTION_KEY must decode to 32 bytes")
    return key


def encrypt_text(plaintext: str) -> str:
    key = _aes_key()
    aes = AESGCM(key)
    nonce = hashlib.sha256(plaintext.encode("utf-8") + key[:8]).digest()[:12]
    ct = aes.encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.urlsafe_b64encode(nonce + ct).decode("ascii")


def decrypt_text(token: str) -> str:
    key = _aes_key()
    raw = base64.urlsafe_b64decode(token)
    nonce, ct = raw[:12], raw[12:]
    aes = AESGCM(key)
    return aes.decrypt(nonce, ct, None).decode("utf-8")
