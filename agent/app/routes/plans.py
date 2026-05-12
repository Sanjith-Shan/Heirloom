"""Plan creation and read endpoints."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from .. import db
from ..models import CreatePlanRequest, Plan
from ..services import key_vault

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/plans", tags=["plans"])


@router.post("", response_model=Plan)
async def create_plan(req: CreatePlanRequest) -> Plan:
    """Create a new inheritance plan.

    Receives an AES-GCM envelope containing the seed phrase. The TEE-side
    decrypt confirms the seed derives to the declared `wallet_address` before
    persisting. Anything else is rejected.
    """
    # Step 1: open envelope (TLS terminates inside TEE; key+iv+ct safe in transit)
    try:
        seed = key_vault.open_envelope(
            key_b64=req.encryption_key,
            iv_b64=req.encryption_iv,
            ciphertext_b64=req.encrypted_seed,
        )
    except Exception as exc:
        logger.exception("envelope decrypt failed")
        raise HTTPException(400, f"envelope decrypt failed: {exc}") from exc

    # Step 2: confirm derived address matches what the user declared
    try:
        derived = key_vault.derived_address_from_seed(seed).lower()
    except Exception as exc:
        raise HTTPException(400, f"invalid seed phrase: {exc}") from exc

    if derived != req.wallet_address.lower():
        raise HTTPException(
            400,
            f"seed-derived address {derived} does not match declared {req.wallet_address.lower()}",
        )

    # Step 3: create plan, then seal & store the seed under that plan ID
    plan = await db.create_plan(
        wallet_address=req.wallet_address,
        user_email=req.user_email,
        beneficiaries=req.beneficiaries,
        emergency_contacts=req.emergency_contacts,
        heartbeat_interval_days=req.heartbeat_interval_days,
        configured_chains=req.configured_chains,
        face_descriptor=req.face_descriptor,
    )
    await key_vault.store(plan.id, seed)
    await db.log_event(
        plan.id,
        "PLAN_CREATED",
        {
            "wallet_address": plan.wallet_address,
            "beneficiary_count": len(plan.beneficiaries),
            "interval_days": plan.heartbeat_interval_days,
            "configured_chains": plan.configured_chains,
        },
    )
    logger.info("plan_created id=%s wallet=%s", plan.id, plan.wallet_address)
    return plan


@router.get("/{plan_id}", response_model=Plan)
async def get_plan(plan_id: str) -> Plan:
    plan = await db.get_plan(plan_id)
    if not plan:
        raise HTTPException(404, "plan not found")
    return plan


@router.get("", response_model=Plan)
async def get_active_plan_route() -> Plan:
    """Single-plan demo helper. Returns the most recent active plan."""
    plan = await db.get_active_plan()
    if not plan:
        raise HTTPException(404, "no active plan")
    return plan
