"""Pydantic models — request/response and internal data shapes."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Phase(str, Enum):
    ACTIVE = "ACTIVE"
    REMINDER = "REMINDER"
    EMERGENCY_CONTACT = "EMERGENCY_CONTACT"
    VERIFICATION = "VERIFICATION"
    EXECUTION = "EXECUTION"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Beneficiary(BaseModel):
    name: str
    address: str
    percentage: float = Field(ge=0, le=100)
    relationship: str | None = None

    @field_validator("address")
    @classmethod
    def lower_address(cls, v: str) -> str:
        return v.lower()


class EmergencyContact(BaseModel):
    name: str
    email: str
    relationship: str | None = None


class CreatePlanRequest(BaseModel):
    wallet_address: str
    encrypted_seed: str  # base64 ciphertext from frontend (TLS-protected channel into TEE)
    encryption_iv: str  # base64 IV
    encryption_key: str  # base64 ephemeral AES key (safe via TLS into TEE; ECIES is roadmap)
    beneficiaries: list[Beneficiary]
    emergency_contacts: list[EmergencyContact]
    user_email: str
    heartbeat_interval_days: int = 30
    configured_chains: list[int] = Field(default_factory=lambda: [84532])
    face_descriptor: list[float] | None = None  # face-api.js 128-dim descriptor (optional)

    @field_validator("wallet_address")
    @classmethod
    def lower_wallet(cls, v: str) -> str:
        return v.lower()

    @field_validator("beneficiaries")
    @classmethod
    def percentages_sum_to_100(cls, v: list[Beneficiary]) -> list[Beneficiary]:
        total = sum(b.percentage for b in v)
        if abs(total - 100.0) > 0.01:
            raise ValueError(f"Beneficiary percentages must sum to 100, got {total}")
        return v


class HeartbeatRequest(BaseModel):
    timestamp: int  # unix seconds
    selfie_hash: str  # SHA-256 hex
    wallet_signature: str
    face_match_distance: float | None = None  # face-api.js euclidean distance (optional)


class Plan(BaseModel):
    id: str
    wallet_address: str
    user_email: str
    beneficiaries: list[Beneficiary]
    emergency_contacts: list[EmergencyContact]
    heartbeat_interval_days: int
    configured_chains: list[int]
    current_phase: Phase
    phase_entered_at: str
    last_heartbeat_at: str | None = None
    face_descriptor: list[float] | None = None
    created_at: str
    updated_at: str

    def next_due_timestamp(self, durations: dict[str, int]) -> int:
        from datetime import datetime
        entered = datetime.fromisoformat(self.phase_entered_at)
        secs = durations.get(self.current_phase.value, 0)
        return int(entered.timestamp()) + secs


class HeartbeatRecord(BaseModel):
    id: int
    plan_id: str
    timestamp: int
    selfie_hash: str
    wallet_signature: str
    phase_before: str
    face_match_distance: float | None = None
    created_at: str


class Event(BaseModel):
    """Audit-log entry."""
    id: int
    plan_id: str
    kind: str  # 'PHASE_TRANSITION' | 'HEARTBEAT' | 'NOTIFICATION_SENT' |
               # 'EIGENAI_ANALYSIS' | 'EXTENSION' | 'EXECUTION' | 'DIRECTOR_ACTION'
    payload: dict[str, Any]
    created_at: str


class AnalysisResult(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    active_since_heartbeat: bool
    last_transaction_date: str | None = None
    transaction_count_since_heartbeat: int = 0
    confidence_owner_active: str = "NONE"  # HIGH | MEDIUM | LOW | NONE
    reasoning: str = ""
    # Receipt fields from EigenAI gateway response
    receipt_req_hash: str | None = None
    receipt_out_hash: str | None = None
    receipt_sig: str | None = None
    eigendalink: str | None = None
    model_id: str | None = None
    chain_id: int | None = None
    system_fingerprint: str | None = None
    is_mocked: bool = False  # true when KMS_AUTH_JWT missing


class StatusResponse(BaseModel):
    plan_id: str
    wallet_address: str
    current_phase: Phase
    phase_entered_at: str
    next_phase_at: int  # unix seconds
    last_heartbeat_at: str | None = None
    beneficiaries: list[Beneficiary]
    configured_chains: list[int]
    recent_events: list[Event]
    agent_wallet_address: str
    demo_mode: bool


class TransferReceipt(BaseModel):
    chain_id: int
    beneficiary_address: str
    asset: str  # 'ETH' or token symbol
    amount: str  # wei or token base units, as string to preserve precision
    tx_hash: str
    status: str  # 'sent' | 'failed' | 'skipped'
    reason: str | None = None


class ExecutionLog(BaseModel):
    plan_id: str
    executed_at: str
    transfers: list[TransferReceipt]
    agent_signature: str | None = None  # signed by TEE wallet
    agent_address: str | None = None
