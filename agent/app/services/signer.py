"""TEE wallet — derives an Ethereum account from the auto-injected MNEMONIC
and signs audit receipts.

This wallet is *not* the user's wallet — it's the agent's stable identity,
deterministic from the EigenCompute app ID. Anyone can recover it from a
signed receipt and cross-check against `verify.eigencloud.xyz` to confirm
the receipt was produced by this specific deployed app.
"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from typing import Any

from eth_account import Account
from eth_account.messages import encode_defunct

from ..config import get_settings

Account.enable_unaudited_hdwallet_features()


@lru_cache(maxsize=1)
def _account():
    return Account.from_mnemonic(get_settings().mnemonic)


def agent_address() -> str:
    return _account().address


def sign_message(message: str) -> str:
    msg = encode_defunct(text=message)
    signed = _account().sign_message(msg)
    return signed.signature.hex()


def sign_payload(payload: dict[str, Any]) -> dict[str, str]:
    """Canonicalize a JSON payload, sign its sha256, return both digest and sig."""
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return {
        "digest": digest,
        "signature": sign_message(digest),
        "agent_address": agent_address(),
    }


def sign_execution_log(execution_log: list[dict[str, Any]]) -> dict[str, Any]:
    """Sign a distribution execution log — used as the verifiable receipt."""
    return {
        "transfers": execution_log,
        **sign_payload({"transfers": execution_log}),
    }
