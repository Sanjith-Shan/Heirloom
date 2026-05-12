"""EigenAI wallet-activity analysis.

This is the *cryptographically interesting* moment of the protocol: we ship a
deterministic prompt to EigenAI (seed=42) and get back a JSON verdict on
whether the wallet still looks "alive". The response itself is plain OpenAI-
compatible — there is no per-call signature; verifiability comes from the
upstream image-digest attestation. We sign the verdict with the TEE wallet
so the Verify page can recover the agent that produced it.

Inference path order:
  1. Local Node sidecar at SIDECAR_URL (uses @layr-labs/ai-gateway-provider —
     handles KMS attestation + JWT minting automatically inside the TEE).
  2. Direct AI Gateway HTTP with KMS_AUTH_JWT (for local dev or sidecar-down).
  3. Mocked verdict computed from real on-chain data (last resort — keeps the
     full demo flow working when neither path is available).

The Director Dashboard surfaces `inference_mode` so the audience can see
which path produced the verdict.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
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
from . import signer

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


def _parse_model_json(content: str) -> dict[str, Any]:
    """Best-effort JSON extraction. Strips fences if the model added any."""
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    return json.loads(text)


async def _try_sidecar(prompt: str) -> dict[str, Any] | None:
    """Call the Node sidecar at SIDECAR_URL/infer. Returns None if unreachable."""
    s = get_settings()
    url = s.sidecar_url.rstrip("/") + "/infer"
    body = {
        "model": s.eigen_model,
        "seed": 42,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(url, json=body)
        if r.status_code >= 400:
            logger.warning("sidecar /infer %s: %s", r.status_code, r.text[:300])
            return None
        return r.json()
    except Exception as exc:
        logger.info("sidecar unreachable (%s) — falling back", exc)
        return None


async def _try_direct_gateway(prompt: str) -> dict[str, Any] | None:
    """Direct POST to AI Gateway using KMS_AUTH_JWT. Returns None if not configured."""
    s = get_settings()
    if not s.kms_auth_jwt:
        return None
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
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                url,
                headers={"Authorization": f"Bearer {s.kms_auth_jwt}"},
                json=body,
            )
        if r.status_code >= 400:
            logger.warning("gateway direct %s: %s", r.status_code, r.text[:300])
            return None
        resp = r.json()
        # Normalize OpenAI -> sidecar-style envelope so the caller has one shape
        return {
            "text": resp["choices"][0]["message"]["content"],
            "model": resp.get("model") or s.eigen_model,
            "mode": "manual-jwt",
            "response_id": resp.get("id"),
            "usage": resp.get("usage"),
        }
    except Exception as exc:
        logger.warning("direct gateway call failed: %s", exc)
        return None


async def analyze(plan: Plan) -> AnalysisResult:
    s = get_settings()

    # Gather on-chain inputs
    loop = asyncio.get_running_loop()
    balances: list[dict[str, Any]] = []
    for chain_id in plan.configured_chains:
        try:
            summary = await loop.run_in_executor(
                None, format_balance_summary, chain_id, plan.wallet_address
            )
            balances.append(summary)
        except Exception as exc:
            balances.append(
                {"chain": chain_name(chain_id), "chain_id": chain_id, "error": str(exc)}
            )

    txs: list[dict[str, Any]] = []
    for chain_id in plan.configured_chains:
        chain_txs = await fetch_recent_transactions(chain_id, plan.wallet_address)
        txs.extend(chain_txs)

    prompt = _build_prompt(plan, txs, balances)
    prompt_hash = _sha256_hex(prompt)

    # Try sidecar, then direct, then mock
    inference_response: dict[str, Any] | None = await _try_sidecar(prompt)
    if inference_response is None:
        inference_response = await _try_direct_gateway(prompt)

    if inference_response is None:
        # Mock — but keep it honest: derived purely from real on-chain reads.
        active = bool(txs)
        most_recent = max((t["timestamp"] for t in txs), default=None) if txs else None
        result = _finalize(
            AnalysisResult(
                active_since_heartbeat=active,
                last_transaction_date=most_recent,
                transaction_count_since_heartbeat=len(txs),
                confidence_owner_active="MEDIUM" if active else "NONE",
                reasoning=(
                    f"Inference unavailable (no sidecar, no KMS_AUTH_JWT). "
                    f"Verdict derived from real on-chain data only: {len(txs)} txs "
                    f"across {len(plan.configured_chains)} chains."
                ),
                model_id=s.eigen_model,
                chain_id=plan.configured_chains[0] if plan.configured_chains else None,
                inference_mode="mocked",
                is_mocked=True,
                prompt_hash=prompt_hash,
            )
        )
        await db.log_event(plan.id, "EIGENAI_ANALYSIS", result.model_dump())
        return result

    # We have a real response — parse and finalize
    text = inference_response.get("text") or ""
    try:
        parsed = _parse_model_json(text)
    except Exception as exc:
        logger.warning("model returned non-JSON: %s", exc)
        parsed = {
            "active_since_heartbeat": False,
            "confidence_owner_active": "NONE",
            "reasoning": f"unparseable model output: {text[:200]}",
        }

    result = _finalize(
        AnalysisResult(
            active_since_heartbeat=bool(parsed.get("active_since_heartbeat")),
            last_transaction_date=parsed.get("last_transaction_date"),
            transaction_count_since_heartbeat=int(parsed.get("transaction_count_since_heartbeat") or 0),
            confidence_owner_active=parsed.get("confidence_owner_active", "NONE"),
            reasoning=parsed.get("reasoning", ""),
            model_id=inference_response.get("model") or s.eigen_model,
            response_id=inference_response.get("response_id"),
            chain_id=plan.configured_chains[0] if plan.configured_chains else None,
            inference_mode=inference_response.get("mode", "tee-attested"),
            is_mocked=False,
            prompt_hash=prompt_hash,
        )
    )
    await db.log_event(plan.id, "EIGENAI_ANALYSIS", result.model_dump())
    return result


def _finalize(result: AnalysisResult) -> AnalysisResult:
    """Sign the canonical verdict with the TEE wallet."""
    payload = {
        "active_since_heartbeat": result.active_since_heartbeat,
        "confidence_owner_active": result.confidence_owner_active,
        "transaction_count_since_heartbeat": result.transaction_count_since_heartbeat,
        "model_id": result.model_id,
        "prompt_hash": result.prompt_hash,
        "response_id": result.response_id,
        "inference_mode": result.inference_mode,
    }
    sig = signer.sign_payload(payload)
    return result.model_copy(
        update={
            "agent_signature": sig["signature"],
            "agent_address": sig["agent_address"],
        }
    )
