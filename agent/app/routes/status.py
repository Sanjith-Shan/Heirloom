"""Public status — phase, countdown, audit trail. Used by Dashboard, Director,
AuditTrail and Verify pages.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .. import db
from ..config import get_settings, phase_durations
from ..models import HeartbeatRecord, StatusResponse
from ..services.signer import agent_address

router = APIRouter(prefix="/api/status", tags=["status"])


@router.get("/{plan_id}", response_model=StatusResponse)
async def get_status(plan_id: str) -> StatusResponse:
    plan = await db.get_plan(plan_id)
    if not plan:
        raise HTTPException(404, "plan not found")

    durations = phase_durations()
    next_phase_at = plan.next_due_timestamp(durations)
    events = await db.get_events(plan_id, limit=50)

    return StatusResponse(
        plan_id=plan.id,
        wallet_address=plan.wallet_address,
        current_phase=plan.current_phase,
        phase_entered_at=plan.phase_entered_at,
        next_phase_at=next_phase_at,
        last_heartbeat_at=plan.last_heartbeat_at,
        beneficiaries=plan.beneficiaries,
        configured_chains=plan.configured_chains,
        recent_events=events,
        agent_wallet_address=agent_address(),
        demo_mode=get_settings().demo_mode,
    )


@router.get("/{plan_id}/heartbeats", response_model=list[HeartbeatRecord])
async def list_heartbeats(plan_id: str, limit: int = 50) -> list[HeartbeatRecord]:
    plan = await db.get_plan(plan_id)
    if not plan:
        raise HTTPException(404, "plan not found")
    return await db.get_heartbeats(plan_id, limit=limit)
