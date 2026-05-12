"""Director Dashboard — manual demo controls.

Each endpoint is a button on `/director?key=...` in the frontend. The Director
Dashboard is *the* presentation tool: every escalation step is fired by a
button click, so the pitch is deterministic — no timer anxiety, no waiting.

All endpoints take `?key=...` and verify against `DIRECTOR_KEY` to keep the
URL useless if leaked screenshots show up in the wild.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from .. import db
from ..config import get_settings
from ..models import Phase, Plan
from ..services import activity_analyzer, escalation, executor, key_vault, notifier

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/director", tags=["director"])


def _verify(key: str) -> None:
    if key != get_settings().director_key:
        raise HTTPException(403, "invalid director key")


async def _active_plan() -> Plan:
    plan = await db.get_active_plan()
    if not plan:
        raise HTTPException(404, "no active plan")
    return plan


@router.post("/advance-phase")
async def advance_phase(key: str = Query(...)) -> dict:
    _verify(key)
    plan = await _active_plan()
    result = await escalation.advance_phase(plan)
    await db.log_event(plan.id, "DIRECTOR_ACTION", {"action": "advance_phase", "result_summary": {
        "transitioned": result.get("transitioned"),
        "from": result.get("from"),
        "to": result.get("to"),
        "extended": result.get("extended"),
    }})
    return result


@router.post("/request-heartbeat")
async def request_heartbeat(key: str = Query(...)) -> dict:
    _verify(key)
    plan = await _active_plan()
    result = await notifier.send_push_notification(
        plan, "Time to check in! Open Heirloom and take your selfie."
    )
    await db.log_event(plan.id, "DIRECTOR_ACTION", {"action": "request_heartbeat", "result": result})
    return {"status": "push attempted", "result": result}


@router.post("/send-reminder")
async def send_reminder(key: str = Query(...)) -> dict:
    _verify(key)
    plan = await _active_plan()
    result = await notifier.send_user_reminder(plan)
    await db.log_event(plan.id, "DIRECTOR_ACTION", {"action": "send_reminder", "result": result})
    return {"status": "reminder dispatched", "result": result}


@router.post("/notify-contacts")
async def notify_contacts(key: str = Query(...)) -> dict:
    _verify(key)
    plan = await _active_plan()
    results = await notifier.notify_emergency_contacts(plan)
    await db.log_event(plan.id, "DIRECTOR_ACTION", {"action": "notify_contacts", "count": len(results)})
    return {"status": "emergency contacts notified", "results": results}


@router.post("/run-analysis")
async def run_analysis(key: str = Query(...)) -> dict:
    _verify(key)
    plan = await _active_plan()
    result = await activity_analyzer.analyze(plan)
    await db.log_event(plan.id, "DIRECTOR_ACTION", {"action": "run_analysis"})
    return {"analysis": result.model_dump()}


@router.get("/dry-run")
async def dry_run(key: str = Query(...)) -> dict:
    """What would execute, without broadcasting. Safe pre-execution preview."""
    _verify(key)
    plan = await _active_plan()
    return await executor.dry_run(plan)


@router.post("/execute")
async def execute(key: str = Query(...)) -> dict:
    _verify(key)
    plan = await _active_plan()
    log = await executor.execute_distribution(plan)
    await db.log_event(plan.id, "DIRECTOR_ACTION", {"action": "execute"})
    return {"execution": log.model_dump()}


@router.post("/reset")
async def reset(key: str = Query(...)) -> dict:
    _verify(key)
    plan = await _active_plan()
    await db.reset_heartbeat_timer(plan.id)
    await db.log_event(plan.id, "DIRECTOR_ACTION", {"action": "reset"})
    return {"status": "reset to ACTIVE"}


@router.post("/cancel-plan")
async def cancel_plan(key: str = Query(...)) -> dict:
    _verify(key)
    plan = await _active_plan()
    await db.update_plan_phase(plan.id, Phase.CANCELLED)
    await db.log_event(plan.id, "DIRECTOR_ACTION", {"action": "cancel_plan"})
    return {"status": "cancelled"}


@router.get("/info")
async def info(key: str = Query(...)) -> dict:
    _verify(key)
    plan = await db.get_active_plan()
    return {
        "has_active_plan": plan is not None,
        "plan_id": plan.id if plan else None,
        "current_phase": plan.current_phase.value if plan else None,
        "demo_mode": get_settings().demo_mode,
    }
