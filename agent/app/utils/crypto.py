"""Crypto helpers — derive symmetric keys from TEE MNEMONIC, AES-GCM decrypt
client-encrypted seed phrases.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def b64decode(s: str) -> bytes:
    return base64.b64decode(s)


def b64encode(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def aes_gcm_decrypt(key: bytes, iv: bytes, ciphertext: bytes, aad: bytes | None = None) -> bytes:
    """Decrypt AES-GCM. AAD must match the value used at encryption time (or both None)."""
    return AESGCM(key).decrypt(iv, ciphertext, aad)


def aes_gcm_encrypt(key: bytes, iv: bytes, plaintext: bytes, aad: bytes | None = None) -> bytes:
    return AESGCM(key).encrypt(iv, plaintext, aad)


def derive_storage_key(seed_material: bytes, label: bytes = b"heirloom-storage-v1") -> bytes:
    """Deterministic 32-byte key from seed material + label. SHA-256(label || seed)."""
    return hashlib.sha256(label + b"\x00" + seed_material).digest()
