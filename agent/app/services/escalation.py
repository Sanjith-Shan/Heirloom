"""Phase transition state machine.

The state machine has five operational phases plus terminal `COMPLETED` /
`CANCELLED`:

  ACTIVE ──(timer)──> REMINDER ──(timer)──> EMERGENCY_CONTACT
                                                │
                                                │ (timer)
                                                ▼
                                          VERIFICATION ──(active wallet)──> back-extends self
                                                │
                                                │ (timer + verdict NOT active)
                                                ▼
                                          EXECUTION ──> COMPLETED

Any heartbeat resets to ACTIVE. The Director can force-advance for the demo.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from .. import db
from ..config import phase_durations
from ..models import Phase, Plan
from . import activity_analyzer, executor, notifier

logger = logging.getLogger(__name__)


TRANSITIONS: dict[str, str] = {
    Phase.ACTIVE.value: Phase.REMINDER.value,
    Phase.REMINDER.value: Phase.EMERGENCY_CONTACT.value,
    Phase.EMERGENCY_CONTACT.value: Phase.VERIFICATION.value,
    Phase.VERIFICATION.value: Phase.EXECUTION.value,
}


def is_phase_expired(plan: Plan) -> bool:
    """True if phase_entered_at + duration < now."""
    durations = phase_durations()
    secs = durations.get(plan.current_phase.value)
    if secs is None:
        return False  # terminal phases never expire
    entered = datetime.fromisoformat(plan.phase_entered_at)
    elapsed = (datetime.now(timezone.utc) - entered).total_seconds()
    return elapsed >= secs


async def advance_phase(plan: Plan) -> dict[str, Any]:
    """Move plan forward one phase, executing all phase-entry side effects.

    Returns a dict describing what happened — used by the Director Dashboard
    to render the result of the click.
    """
    current = plan.current_phase.value
    if current not in TRANSITIONS:
        return {"transitioned": False, "reason": f"phase {current} is terminal"}

    target = TRANSITIONS[current]
    side_effects: dict[str, Any] = {}

    # VERIFICATION phase has special branching: if EigenAI says wallet is
    # active, we don't transition to EXECUTION — we extend.
    if current == Phase.VERIFICATION.value:
        analysis = await activity_analyzer.analyze(plan)
        side_effects["analysis"] = analysis.model_dump()
        if analysis.confidence_owner_active in ("HIGH", "MEDIUM"):
            await db.extend_phase(plan.id, seconds=-phase_durations()["VERIFICATION"])
            await db.log_event(
                plan.id,
                "EXTENSION",
                {"reason": "wallet appears active per EigenAI", "analysis": analysis.model_dump()},
            )
            return {"transitioned": False, "extended": True, **side_effects}

    # Phase-entry side effects
    if target == Phase.REMINDER.value:
        side_effects["reminder"] = await notifier.send_user_reminder(plan)
    elif target == Phase.EMERGENCY_CONTACT.value:
        side_effects["emergency_contacts"] = await notifier.notify_emergency_contacts(plan)
    elif target == Phase.VERIFICATION.value:
        analysis = await activity_analyzer.analyze(plan)
        side_effects["analysis"] = analysis.model_dump()
        if analysis.confidence_owner_active in ("HIGH", "MEDIUM"):
            # Wallet showed activity — don't even formally enter VERIFICATION,
            # extend the prior phase instead.
            await db.extend_phase(plan.id, seconds=-phase_durations()["EMERGENCY_CONTACT"])
            await db.log_event(
                plan.id,
                "EXTENSION",
                {"reason": "wallet appears active per EigenAI", "analysis": analysis.model_dump()},
            )
            return {"transitioned": False, "extended": True, **side_effects}

    # Persist phase change
    await db.update_plan_phase(plan.id, target)
    await db.log_event(
        plan.id,
        "PHASE_TRANSITION",
        {"from": current, "to": target, **side_effects},
    )

    # EXECUTION fires on entry, terminal
    if target == Phase.EXECUTION.value:
        try:
            log = await executor.execute_distribution(plan)
            side_effects["execution"] = log.model_dump()
        except Exception as exc:
            logger.exception("execution failed")
            side_effects["execution_error"] = str(exc)
            await db.log_event(plan.id, "EXECUTION_ERROR", {"error": str(exc)})

    return {"transitioned": True, "from": current, "to": target, **side_effects}
