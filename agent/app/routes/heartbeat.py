"""Heartbeat check-in: selfie hash + wallet signature → reset to ACTIVE."""

from __future__ import annotations

import logging
import time

from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import APIRouter, HTTPException

from .. import db
from ..models import HeartbeatRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/heartbeat", tags=["heartbeat"])


HEARTBEAT_FRESHNESS_WINDOW = 5 * 60  # seconds — reject obviously-replayed heartbeats


def heartbeat_challenge(plan_id: str, timestamp: int) -> str:
    return f"Heirloom heartbeat {plan_id} {timestamp}"


@router.post("/{plan_id}")
async def check_in(plan_id: str, body: HeartbeatRequest) -> dict:
    plan = await db.get_plan(plan_id)
    if not plan:
        raise HTTPException(404, "plan not found")

    now = int(time.time())
    if abs(now - body.timestamp) > HEARTBEAT_FRESHNESS_WINDOW:
        raise HTTPException(400, "heartbeat timestamp outside freshness window")

    # Verify wallet signature — the user proves possession of the wallet they
    # registered. The selfie alone proves a face; the signature proves *whose*.
    challenge = heartbeat_challenge(plan_id, body.timestamp)
    try:
        recovered = Account.recover_message(
            encode_defunct(text=challenge),
            signature=body.wallet_signature,
        )
    except Exception as exc:
        raise HTTPException(400, f"signature recovery failed: {exc}") from exc

    if recovered.lower() != plan.wallet_address.lower():
        raise HTTPException(
            403,
            f"signature recovered to {recovered.lower()}, expected {plan.wallet_address.lower()}",
        )

    phase_before = plan.current_phase.value
    await db.record_heartbeat(
        plan_id,
        timestamp=body.timestamp,
        selfie_hash=body.selfie_hash,
        wallet_signature=body.wallet_signature,
        phase_before=phase_before,
        face_match_distance=body.face_match_distance,
    )
    await db.reset_heartbeat_timer(plan_id)
    await db.log_event(
        plan_id,
        "HEARTBEAT",
        {
            "phase_before": phase_before,
            "selfie_hash": body.selfie_hash,
            "face_match_distance": body.face_match_distance,
            "timestamp": body.timestamp,
        },
    )
    logger.info("heartbeat plan=%s phase_before=%s", plan_id, phase_before)
    return {"status": "ok", "phase": "ACTIVE", "phase_before": phase_before}


@router.get("/{plan_id}/challenge")
async def get_challenge(plan_id: str) -> dict:
    """Frontend fetches this, signs the message string, then POSTs the heartbeat."""
    plan = await db.get_plan(plan_id)
    if not plan:
        raise HTTPException(404, "plan not found")
    ts = int(time.time())
    return {"timestamp": ts, "message": heartbeat_challenge(plan_id, ts)}
