"""EigenAI wallet-activity analysis.

This is the *cryptographically interesting* moment: we ship a deterministic
prompt to EigenAI (gpt-oss-120b-f16, seed=42) and get back a JSON verdict on
whether the wallet still looks "alive" — plus a signed receipt that anyone
can replay and cross-check on-chain via KeyRegistrar.

If KMS_AUTH_JWT is missing (local dev with no JWT), the analyzer returns a
mocked verdict with `is_mocked=true` so the demo flow still proceeds end to
end. The Director Dashboard surfaces this state honestly.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from typing import Any

import httpx

from .. import db
from ..config import get_settings
from ..models import AnalysisResult, Plan
from ..utils.chain import (
    chain_name,
    fetch_recent_transactions,
    format_balance_summary,
)

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = (
    "You are a deterministic on-chain analyst. Respond ONLY with the requested JSON. "
    "No prose, no markdown fences."
)


def _build_prompt(plan: Plan, recent_txs: list[dict[str, Any]], balances: list[dict[str, Any]]) -> str:
    return (
        f"Analyze the following on-chain transaction history for wallet {plan.wallet_address}.\n\n"
        f"Recent transactions (last ~6500 blocks per chain):\n"
        f"{json.dumps(recent_txs, indent=2)[:4000]}\n\n"
        f"Current balances:\n"
        f"{json.dumps(balances, indent=2)}\n\n"
        f"Last heartbeat check-in: {plan.last_heartbeat_at}\n\n"
        f"Determine:\n"
        f"1. Is this wallet showing signs of active usage since the last heartbeat?\n"
        f"2. What is the most recent transaction date?\n"
        f"3. Confidence level that the wallet owner is still active "
        f"(HIGH/MEDIUM/LOW/NONE)\n\n"
        f"Respond ONLY with valid JSON:\n"
        f"{{\n"
        f'  "active_since_heartbeat": <boolean>,\n'
        f'  "last_transaction_date": "<ISO date or null>",\n'
        f'  "transaction_count_since_heartbeat": <int>,\n'
        f'  "confidence_owner_active": "<HIGH|MEDIUM|LOW|NONE>",\n'
        f'  "reasoning": "<brief explanation>"\n'
        f"}}"
    )


def _sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


async def _call_gateway(prompt: str) -> dict[str, Any]:
    """POST to AI Gateway /v1/chat/completions. Bearer KMS_AUTH_JWT.

    Returns the full response dict on success, or raises.
    """
    s = get_settings()
    url = s.eigen_gateway_url.rstrip("/") + "/v1/chat/completions"
    body = {
        "model": s.eigen_model,
        "seed": 42,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            url,
            headers={"Authorization": f"Bearer {s.kms_auth_jwt}"},
            json=body,
        )
    if r.status_code >= 400:
        raise RuntimeError(f"AI gateway {r.status_code}: {r.text[:500]}")
    return r.json()


def _parse_model_json(content: str) -> dict[str, Any]:
    """Best-effort JSON extraction. Strips fences if the model added any."""
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    # Take the first JSON-looking blob
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    return json.loads(text)


async def analyze(plan: Plan) -> AnalysisResult:
    s = get_settings()

    # Gather inputs in parallel-ish
    loop = asyncio.get_running_loop()
    balances: list[dict[str, Any]] = []
    for chain_id in plan.configured_chains:
        try:
            summary = await loop.run_in_executor(
                None, format_balance_summary, chain_id, plan.wallet_address
            )
            balances.append(summary)
        except Exception as exc:
            balances.append({"chain": chain_name(chain_id), "chain_id": chain_id, "error": str(exc)})

    txs: list[dict[str, Any]] = []
    for chain_id in plan.configured_chains:
        chain_txs = await fetch_recent_transactions(chain_id, plan.wallet_address)
        txs.extend(chain_txs)

    prompt = _build_prompt(plan, txs, balances)

    # If we don't have a JWT, mock — but use real on-chain data so the verdict
    # reflects reality even without inference.
    if not s.kms_auth_jwt:
        active = bool(txs)
        most_recent = max((t["timestamp"] for t in txs), default=None) if txs else None
        result = AnalysisResult(
            active_since_heartbeat=active,
            last_transaction_date=most_recent,
            transaction_count_since_heartbeat=len(txs),
            confidence_owner_active="MEDIUM" if active else "NONE",
            reasoning=(
                "Mocked verdict — KMS_AUTH_JWT not configured. Used real on-chain "
                f"data: {len(txs)} txs across {len(plan.configured_chains)} chains."
            ),
            model_id=s.eigen_model,
            chain_id=plan.configured_chains[0] if plan.configured_chains else None,
            is_mocked=True,
            receipt_req_hash=_sha256_hex(prompt),
            receipt_out_hash=None,
            receipt_sig=None,
        )
        await db.log_event(plan.id, "EIGENAI_ANALYSIS", result.model_dump())
        return result

    # Real call
    try:
        resp = await _call_gateway(prompt)
    except Exception as exc:
        logger.exception("EigenAI call failed")
        result = AnalysisResult(
            active_since_heartbeat=False,
            confidence_owner_active="NONE",
            reasoning=f"AI gateway error: {exc}",
            model_id=s.eigen_model,
            is_mocked=True,
            receipt_req_hash=_sha256_hex(prompt),
        )
        await db.log_event(plan.id, "EIGENAI_ANALYSIS", result.model_dump())
        return result

    # Extract content + receipt
    content = resp["choices"][0]["message"]["content"]
    try:
        parsed = _parse_model_json(content)
    except Exception as exc:
        logger.warning("model returned non-JSON: %s", exc)
        parsed = {
            "active_since_heartbeat": False,
            "confidence_owner_active": "NONE",
            "reasoning": f"unparseable model output: {content[:200]}",
        }

    receipt = resp.get("receipt", {})
    determinism = resp.get("determinism", {})

    result = AnalysisResult(
        active_since_heartbeat=bool(parsed.get("active_since_heartbeat")),
        last_transaction_date=parsed.get("last_transaction_date"),
        transaction_count_since_heartbeat=int(parsed.get("transaction_count_since_heartbeat") or 0),
        confidence_owner_active=parsed.get("confidence_owner_active", "NONE"),
        reasoning=parsed.get("reasoning", ""),
        model_id=resp.get("model") or s.eigen_model,
        chain_id=resp.get("chain_id"),
        receipt_req_hash=receipt.get("req_hash") or _sha256_hex(prompt),
        receipt_out_hash=receipt.get("out_hash"),
        receipt_sig=receipt.get("sig"),
        eigendalink=resp.get("eigendalink"),
        system_fingerprint=resp.get("system_fingerprint"),
        is_mocked=False,
    )
    await db.log_event(plan.id, "EIGENAI_ANALYSIS", result.model_dump())
    return result
