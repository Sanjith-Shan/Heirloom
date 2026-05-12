"""Sealed seed-phrase storage.

The user's seed phrase is encrypted by the browser with an ephemeral AES-GCM
key. The whole bundle (key + IV + ciphertext) arrives over TLS that terminates
*inside* the TEE — the key is never visible to the host. The agent decrypts
once, then re-encrypts with a TEE-derived storage key (Fernet) before saving.

Decryption requires the MNEMONIC env var, which only exists inside the TEE.
"""

from __future__ import annotations

import base64
import hashlib
import logging
from functools import lru_cache

from cryptography.fernet import Fernet
from eth_account import Account

from .. import db
from ..config import get_settings
from ..utils.crypto import aes_gcm_decrypt, b64decode

# eth-account HD wallet support
Account.enable_unaudited_hdwallet_features()

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _storage_fernet() -> Fernet:
    """Storage key bound to the TEE wallet.

    The agent's MNEMONIC is auto-injected by KMS and is stable across
    upgrades, so the storage key is too — sealed seeds remain decryptable
    after image upgrades by the same app ID.
    """
    s = get_settings()
    account = Account.from_mnemonic(s.mnemonic)
    raw = hashlib.sha256(b"heirloom-storage-v1\x00" + bytes.fromhex(account.key.hex()[2:])).digest()
    return Fernet(base64.urlsafe_b64encode(raw))


def open_envelope(*, key_b64: str, iv_b64: str, ciphertext_b64: str) -> str:
    """Decrypt the AES-GCM envelope sent by the frontend. Returns plaintext seed."""
    key = b64decode(key_b64)
    iv = b64decode(iv_b64)
    ct = b64decode(ciphertext_b64)
    plaintext = aes_gcm_decrypt(key, iv, ct)
    return plaintext.decode("utf-8")


def seal(seed_phrase: str) -> bytes:
    return _storage_fernet().encrypt(seed_phrase.encode("utf-8"))


def unseal(ciphertext: bytes) -> str:
    return _storage_fernet().decrypt(ciphertext).decode("utf-8")


async def store(plan_id: str, seed_phrase: str) -> None:
    sealed = seal(seed_phrase)
    await db.store_sealed_key(plan_id, sealed)


async def retrieve(plan_id: str) -> str:
    sealed = await db.get_sealed_key(plan_id)
    if sealed is None:
        raise KeyError(f"no sealed key for plan {plan_id}")
    return unseal(sealed)


async def derive_wallet(plan_id: str):
    """Return an eth_account.Account derived from the user's stored seed."""
    seed = await retrieve(plan_id)
    return Account.from_mnemonic(seed)


def derived_address_from_seed(seed_phrase: str) -> str:
    """Helper for the frontend's address-confirmation flow (called pre-store)."""
    return Account.from_mnemonic(seed_phrase).address
