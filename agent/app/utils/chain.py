"""Multi-chain helpers — RPC clients, balance fetching, recent-tx scan.

Public RPCs are rate-limited and flaky. Every call is wrapped to fail
gracefully — a failed analysis returns a "no recent activity" signal rather
than crashing the escalation engine.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from web3 import Web3

from ..config import ERC20_TOKENS, get_settings

logger = logging.getLogger(__name__)


def w3(chain_id: int) -> Web3:
    rpc = get_settings().chain_rpcs.get(chain_id)
    if not rpc:
        raise ValueError(f"no RPC configured for chain {chain_id}")
    return Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 15}))


def get_native_balance(chain_id: int, address: str) -> int:
    return int(w3(chain_id).eth.get_balance(Web3.to_checksum_address(address)))


# Minimal ERC-20 ABI (balanceOf, transfer, decimals, symbol)
ERC20_ABI = [
    {"constant": True, "inputs": [{"name": "_owner", "type": "address"}],
     "name": "balanceOf", "outputs": [{"name": "balance", "type": "uint256"}],
     "type": "function"},
    {"constant": False, "inputs": [
        {"name": "_to", "type": "address"}, {"name": "_value", "type": "uint256"}],
     "name": "transfer", "outputs": [{"name": "", "type": "bool"}], "type": "function"},
    {"constant": True, "inputs": [], "name": "decimals",
     "outputs": [{"name": "", "type": "uint8"}], "type": "function"},
    {"constant": True, "inputs": [], "name": "symbol",
     "outputs": [{"name": "", "type": "string"}], "type": "function"},
]


def get_erc20_balance(chain_id: int, token_addr: str, holder: str) -> int:
    contract = w3(chain_id).eth.contract(
        address=Web3.to_checksum_address(token_addr), abi=ERC20_ABI
    )
    return int(contract.functions.balanceOf(Web3.to_checksum_address(holder)).call())


async def fetch_recent_transactions(chain_id: int, address: str, lookback_blocks: int = 6500) -> list[dict[str, Any]]:
    """Cheap heuristic: scan recent blocks for sends/receives from `address`.

    For demo this is fine. Production would use Etherscan/Alchemy/etc. or an
    indexed provider — public RPC `eth_getLogs` over thousands of blocks is
    too slow and gets rate-limited.
    """
    try:
        web3 = w3(chain_id)
        latest = web3.eth.block_number
        start = max(0, latest - lookback_blocks)
        addr = Web3.to_checksum_address(address)

        # Sample every Nth block to keep API calls in the dozens
        sample_step = max(1, lookback_blocks // 30)
        sample_blocks = list(range(start, latest + 1, sample_step))[:30]

        results: list[dict[str, Any]] = []
        loop = asyncio.get_running_loop()
        for bn in sample_blocks:
            try:
                blk = await loop.run_in_executor(None, lambda: web3.eth.get_block(bn, True))
            except Exception:
                continue
            for tx in blk.transactions:
                tx_from = (tx["from"] or "").lower()
                tx_to = (tx.get("to") or "").lower() if tx.get("to") else ""
                if tx_from == addr.lower() or tx_to == addr.lower():
                    results.append({
                        "hash": tx["hash"].hex() if hasattr(tx["hash"], "hex") else str(tx["hash"]),
                        "from": tx_from,
                        "to": tx_to,
                        "value": str(tx.get("value", 0)),
                        "block_number": bn,
                        "timestamp": datetime.fromtimestamp(blk.timestamp, tz=timezone.utc).isoformat(),
                    })
        return results
    except Exception as exc:
        logger.warning("fetch_recent_transactions failed for chain %s: %s", chain_id, exc)
        return []


def chain_name(chain_id: int) -> str:
    return {
        1: "Ethereum",
        8453: "Base",
        137: "Polygon",
        11155111: "Sepolia",
        84532: "Base Sepolia",
    }.get(chain_id, f"chain-{chain_id}")


def format_balance_summary(chain_id: int, address: str) -> dict[str, Any]:
    """Fetch native + known-ERC-20 balances. Returns dict for prompt embedding."""
    summary: dict[str, Any] = {"chain": chain_name(chain_id), "chain_id": chain_id}
    try:
        wei = get_native_balance(chain_id, address)
        summary["native_wei"] = str(wei)
        summary["native_eth"] = float(Web3.from_wei(wei, "ether"))
    except Exception as exc:
        summary["native_error"] = str(exc)

    tokens: dict[str, str] = {}
    for sym, addr in ERC20_TOKENS.get(chain_id, {}).items():
        try:
            bal = get_erc20_balance(chain_id, addr, address)
            tokens[sym] = str(bal)
        except Exception as exc:
            tokens[sym] = f"error: {exc}"
    summary["tokens"] = tokens
    return summary
