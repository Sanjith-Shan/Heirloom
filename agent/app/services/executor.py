"""Asset distribution executor.

This is the dead-man's-switch's terminal action: derive the user's wallet
from the sealed seed, scan balances on configured chains, and split each
asset across beneficiaries by their configured percentages. Every transfer
is recorded; the whole log is signed by the TEE wallet so anyone can verify
which deployed agent produced it.

For Demo Day the configured chain is Base Sepolia (84532) — a real testnet
transaction that shows up on Basescan in seconds.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from web3 import Web3

from .. import db
from ..config import ERC20_TOKENS, get_settings
from ..models import ExecutionLog, Plan, TransferReceipt
from ..utils.chain import (
    ERC20_ABI,
    chain_name,
    get_erc20_balance,
    get_native_balance,
    w3,
)
from . import audit, key_vault, notifier, signer

logger = logging.getLogger(__name__)


async def execute_distribution(plan: Plan) -> ExecutionLog:
    """Run the actual distribution. Mutating, on-chain — irreversible.

    Returns an ExecutionLog with per-transfer receipts and a TEE-wallet signature
    over the whole log.
    """
    account = await key_vault.derive_wallet(plan.id)
    transfers: list[TransferReceipt] = []
    loop = asyncio.get_running_loop()

    for chain_id in plan.configured_chains:
        try:
            web3 = w3(chain_id)
        except Exception as exc:
            transfers.append(
                TransferReceipt(
                    chain_id=chain_id,
                    beneficiary_address="-",
                    asset="ETH",
                    amount="0",
                    tx_hash="",
                    status="skipped",
                    reason=f"no rpc: {exc}",
                )
            )
            continue

        await _distribute_native(web3, account, plan, chain_id, transfers, loop)
        await _distribute_tokens(web3, account, plan, chain_id, transfers, loop)

    receipt = signer.sign_execution_log([t.model_dump() for t in transfers])
    log = ExecutionLog(
        plan_id=plan.id,
        executed_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        transfers=transfers,
        agent_signature=receipt["signature"],
        agent_address=receipt["agent_address"],
    )

    audit_record = await audit.write_to_eigenda({**receipt, "plan_id": plan.id, "executed_at": log.executed_at})

    await db.log_event(
        plan.id,
        "EXECUTION",
        {
            "transfer_count": len(transfers),
            "transfers": [t.model_dump() for t in transfers],
            "agent_address": receipt["agent_address"],
            "agent_signature": receipt["signature"],
            "audit_record": audit_record,
        },
    )
    await db.update_plan_phase(plan.id, "COMPLETED")

    try:
        await notifier.notify_execution_complete(plan, {"transfer_count": len(transfers)})
    except Exception:
        logger.exception("execution-complete notification failed")

    return log


# ---------------------- internals ----------------------

async def _distribute_native(web3: Web3, account, plan: Plan, chain_id: int,
                              transfers: list[TransferReceipt], loop) -> None:
    try:
        balance_wei = await loop.run_in_executor(
            None, get_native_balance, chain_id, account.address
        )
    except Exception as exc:
        transfers.append(TransferReceipt(
            chain_id=chain_id, beneficiary_address="-", asset="ETH",
            amount="0", tx_hash="", status="skipped", reason=f"balance fetch failed: {exc}",
        ))
        return

    if balance_wei <= 0:
        transfers.append(TransferReceipt(
            chain_id=chain_id, beneficiary_address="-", asset="ETH",
            amount="0", tx_hash="", status="skipped", reason="zero balance",
        ))
        return

    # Reserve enough native for one tx per beneficiary
    try:
        gas_price = web3.eth.gas_price
    except Exception:
        gas_price = web3.to_wei(2, "gwei")
    per_tx_gas = 21000
    total_reserved = gas_price * per_tx_gas * len(plan.beneficiaries)
    distributable = max(0, balance_wei - total_reserved)

    if distributable <= 0:
        transfers.append(TransferReceipt(
            chain_id=chain_id, beneficiary_address="-", asset="ETH",
            amount="0", tx_hash="", status="skipped",
            reason="balance insufficient to cover gas across beneficiaries",
        ))
        return

    base_nonce = web3.eth.get_transaction_count(account.address)
    for i, b in enumerate(plan.beneficiaries):
        amount = distributable * int(b.percentage * 100) // 10_000  # percentage with .01 precision
        if amount <= 0:
            continue
        tx = {
            "to": Web3.to_checksum_address(b.address),
            "value": amount,
            "gas": per_tx_gas,
            "gasPrice": gas_price,
            "nonce": base_nonce + i,
            "chainId": chain_id,
        }
        try:
            signed = account.sign_transaction(tx)
            tx_hash = web3.eth.send_raw_transaction(signed.raw_transaction)
            transfers.append(TransferReceipt(
                chain_id=chain_id, beneficiary_address=b.address, asset="ETH",
                amount=str(amount), tx_hash=tx_hash.hex(), status="sent",
            ))
        except Exception as exc:
            transfers.append(TransferReceipt(
                chain_id=chain_id, beneficiary_address=b.address, asset="ETH",
                amount=str(amount), tx_hash="", status="failed", reason=str(exc),
            ))


async def _distribute_tokens(web3: Web3, account, plan: Plan, chain_id: int,
                              transfers: list[TransferReceipt], loop) -> None:
    tokens = ERC20_TOKENS.get(chain_id, {})
    if not tokens:
        return

    for symbol, token_addr in tokens.items():
        try:
            bal = await loop.run_in_executor(
                None, get_erc20_balance, chain_id, token_addr, account.address
            )
        except Exception:
            continue
        if bal <= 0:
            continue

        contract = web3.eth.contract(
            address=Web3.to_checksum_address(token_addr), abi=ERC20_ABI
        )
        base_nonce = web3.eth.get_transaction_count(account.address)
        for i, b in enumerate(plan.beneficiaries):
            amount = bal * int(b.percentage * 100) // 10_000
            if amount <= 0:
                continue
            try:
                tx = contract.functions.transfer(
                    Web3.to_checksum_address(b.address), amount
                ).build_transaction({
                    "from": account.address,
                    "nonce": base_nonce + i,
                    "gas": 80_000,
                    "gasPrice": web3.eth.gas_price,
                    "chainId": chain_id,
                })
                signed = account.sign_transaction(tx)
                tx_hash = web3.eth.send_raw_transaction(signed.raw_transaction)
                transfers.append(TransferReceipt(
                    chain_id=chain_id, beneficiary_address=b.address, asset=symbol,
                    amount=str(amount), tx_hash=tx_hash.hex(), status="sent",
                ))
            except Exception as exc:
                transfers.append(TransferReceipt(
                    chain_id=chain_id, beneficiary_address=b.address, asset=symbol,
                    amount=str(amount), tx_hash="", status="failed", reason=str(exc),
                ))


# ---------------------- demo helpers ----------------------

async def dry_run(plan: Plan) -> dict[str, Any]:
    """What WOULD execute, without actually broadcasting. For Director preview."""
    account = await key_vault.derive_wallet(plan.id)
    summary: dict[str, Any] = {"agent_user_address": account.address, "chains": []}
    loop = asyncio.get_running_loop()
    for chain_id in plan.configured_chains:
        try:
            wei = await loop.run_in_executor(None, get_native_balance, chain_id, account.address)
        except Exception as exc:
            summary["chains"].append({"chain_id": chain_id, "error": str(exc)})
            continue
        per_b = []
        for b in plan.beneficiaries:
            per_b.append({
                "name": b.name,
                "address": b.address,
                "percentage": b.percentage,
                "would_receive_wei": str(wei * int(b.percentage * 100) // 10_000),
            })
        summary["chains"].append({
            "chain_id": chain_id,
            "chain_name": chain_name(chain_id),
            "native_balance_wei": str(wei),
            "distribution": per_b,
        })
    return summary
