"""Background scheduler.

Runs once-per-minute checks across all active plans, advancing phases when
their timer expires. In `DEMO_MODE`, automatic advancement is disabled —
the Director Dashboard drives transitions explicitly so the live pitch is
deterministic.
"""

from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from .. import db
from ..config import get_settings
from . import escalation

logger = logging.getLogger(__name__)
_scheduler: AsyncIOScheduler | None = None


async def _check_all_plans() -> None:
    plans = await db.get_all_active_plans()
    for plan in plans:
        if escalation.is_phase_expired(plan):
            logger.info("auto-advancing plan=%s phase=%s", plan.id, plan.current_phase.value)
            try:
                result = await escalation.advance_phase(plan)
                logger.info("advance result: %s", {k: v for k, v in result.items() if k != "execution"})
            except Exception:
                logger.exception("advance failed for plan=%s", plan.id)


def start() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler()
    s = get_settings()
    if s.demo_mode:
        logger.info("DEMO_MODE=true — heartbeat_monitor scheduled but no auto-advancement")
    else:
        _scheduler.add_job(_check_all_plans, "interval", minutes=1, id="check_all_plans")
        logger.info("heartbeat_monitor: auto-advancement every 1 min")
    _scheduler.start()


def stop() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None


def get_scheduler() -> AsyncIOScheduler | None:
    return _scheduler
