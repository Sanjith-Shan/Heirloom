"""Encrypted SQLite store. Single-plan-friendly for the demo, multi-plan ready."""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

import aiosqlite

from .config import get_settings
from .models import (
    Beneficiary,
    EmergencyContact,
    Event,
    HeartbeatRecord,
    Phase,
    Plan,
    utcnow_iso,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    user_email TEXT NOT NULL,
    beneficiaries_json TEXT NOT NULL,
    emergency_contacts_json TEXT NOT NULL,
    heartbeat_interval_days INTEGER NOT NULL,
    configured_chains_json TEXT NOT NULL,
    current_phase TEXT NOT NULL,
    phase_entered_at TEXT NOT NULL,
    last_heartbeat_at TEXT,
    face_descriptor_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sealed_keys (
    plan_id TEXT PRIMARY KEY,
    ciphertext BLOB NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE TABLE IF NOT EXISTS heartbeats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    selfie_hash TEXT NOT NULL,
    wallet_signature TEXT NOT NULL,
    phase_before TEXT NOT NULL,
    face_match_distance REAL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    plan_id TEXT PRIMARY KEY,
    subscription_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_plan ON events(plan_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_heartbeats_plan ON heartbeats(plan_id, id DESC);
"""


_db_path: Path | None = None


def _path() -> str:
    global _db_path
    if _db_path is None:
        _db_path = get_settings().db_path
    return str(_db_path)


async def init_db() -> None:
    async with aiosqlite.connect(_path()) as conn:
        await conn.executescript(SCHEMA)
        await conn.commit()


def _row_to_plan(row: aiosqlite.Row) -> Plan:
    return Plan(
        id=row["id"],
        wallet_address=row["wallet_address"],
        user_email=row["user_email"],
        beneficiaries=[Beneficiary(**b) for b in json.loads(row["beneficiaries_json"])],
        emergency_contacts=[EmergencyContact(**c) for c in json.loads(row["emergency_contacts_json"])],
        heartbeat_interval_days=row["heartbeat_interval_days"],
        configured_chains=json.loads(row["configured_chains_json"]),
        current_phase=Phase(row["current_phase"]),
        phase_entered_at=row["phase_entered_at"],
        last_heartbeat_at=row["last_heartbeat_at"],
        face_descriptor=json.loads(row["face_descriptor_json"]) if row["face_descriptor_json"] else None,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def create_plan(
    *,
    wallet_address: str,
    user_email: str,
    beneficiaries: list[Beneficiary],
    emergency_contacts: list[EmergencyContact],
    heartbeat_interval_days: int,
    configured_chains: list[int],
    face_descriptor: list[float] | None = None,
) -> Plan:
    pid = str(uuid.uuid4())
    now = utcnow_iso()
    async with aiosqlite.connect(_path()) as conn:
        conn.row_factory = aiosqlite.Row
        await conn.execute(
            """INSERT INTO plans (id, wallet_address, user_email, beneficiaries_json,
               emergency_contacts_json, heartbeat_interval_days, configured_chains_json,
               current_phase, phase_entered_at, last_heartbeat_at, face_descriptor_json,
               created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                pid,
                wallet_address.lower(),
                user_email,
                json.dumps([b.model_dump() for b in beneficiaries]),
                json.dumps([c.model_dump() for c in emergency_contacts]),
                heartbeat_interval_days,
                json.dumps(configured_chains),
                Phase.ACTIVE.value,
                now,
                None,
                json.dumps(face_descriptor) if face_descriptor else None,
                now,
                now,
            ),
        )
        await conn.commit()
        cur = await conn.execute("SELECT * FROM plans WHERE id = ?", (pid,))
        row = await cur.fetchone()
        return _row_to_plan(row)


async def get_plan(plan_id: str) -> Plan | None:
    async with aiosqlite.connect(_path()) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("SELECT * FROM plans WHERE id = ?", (plan_id,))
        row = await cur.fetchone()
        return _row_to_plan(row) if row else None


async def get_active_plan() -> Plan | None:
    """Single-plan demo helper: most recently created non-completed plan."""
    async with aiosqlite.connect(_path()) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            "SELECT * FROM plans WHERE current_phase NOT IN ('COMPLETED','CANCELLED') "
            "ORDER BY created_at DESC LIMIT 1"
        )
        row = await cur.fetchone()
        return _row_to_plan(row) if row else None


async def get_all_active_plans() -> list[Plan]:
    async with aiosqlite.connect(_path()) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            "SELECT * FROM plans WHERE current_phase NOT IN ('COMPLETED','CANCELLED')"
        )
        rows = await cur.fetchall()
        return [_row_to_plan(r) for r in rows]


async def update_plan_phase(plan_id: str, phase: Phase | str) -> None:
    pv = phase.value if isinstance(phase, Phase) else phase
    now = utcnow_iso()
    async with aiosqlite.connect(_path()) as conn:
        await conn.execute(
            "UPDATE plans SET current_phase = ?, phase_entered_at = ?, updated_at = ? WHERE id = ?",
            (pv, now, now, plan_id),
        )
        await conn.commit()


async def reset_heartbeat_timer(plan_id: str) -> None:
    """Set phase to ACTIVE and refresh phase_entered_at + last_heartbeat_at."""
    now = utcnow_iso()
    async with aiosqlite.connect(_path()) as conn:
        await conn.execute(
            """UPDATE plans SET current_phase = 'ACTIVE', phase_entered_at = ?,
               last_heartbeat_at = ?, updated_at = ? WHERE id = ?""",
            (now, now, now, plan_id),
        )
        await conn.commit()


async def extend_phase(plan_id: str, seconds: int) -> None:
    """Push phase_entered_at forward by `seconds` to delay the next transition."""
    async with aiosqlite.connect(_path()) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute("SELECT phase_entered_at FROM plans WHERE id = ?", (plan_id,))
        row = await cur.fetchone()
        if not row:
            return
        from datetime import datetime, timedelta, timezone
        entered = datetime.fromisoformat(row["phase_entered_at"])
        new_entered = (entered + timedelta(seconds=seconds)).astimezone(timezone.utc).isoformat()
        await conn.execute(
            "UPDATE plans SET phase_entered_at = ?, updated_at = ? WHERE id = ?",
            (new_entered, utcnow_iso(), plan_id),
        )
        await conn.commit()


# Sealed keys ----------------------------------------------------------------

async def store_sealed_key(plan_id: str, ciphertext: bytes) -> None:
    async with aiosqlite.connect(_path()) as conn:
        await conn.execute(
            "INSERT OR REPLACE INTO sealed_keys (plan_id, ciphertext, created_at) VALUES (?, ?, ?)",
            (plan_id, ciphertext, utcnow_iso()),
        )
        await conn.commit()


async def get_sealed_key(plan_id: str) -> bytes | None:
    async with aiosqlite.connect(_path()) as conn:
        cur = await conn.execute("SELECT ciphertext FROM sealed_keys WHERE plan_id = ?", (plan_id,))
        row = await cur.fetchone()
        return row[0] if row else None


# Heartbeats -----------------------------------------------------------------

async def record_heartbeat(
    plan_id: str,
    *,
    timestamp: int,
    selfie_hash: str,
    wallet_signature: str,
    phase_before: str,
    face_match_distance: float | None = None,
) -> int:
    async with aiosqlite.connect(_path()) as conn:
        cur = await conn.execute(
            """INSERT INTO heartbeats (plan_id, timestamp, selfie_hash, wallet_signature,
               phase_before, face_match_distance, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (plan_id, timestamp, selfie_hash, wallet_signature, phase_before, face_match_distance, utcnow_iso()),
        )
        await conn.commit()
        return cur.lastrowid or 0


async def get_heartbeats(plan_id: str, limit: int = 100) -> list[HeartbeatRecord]:
    async with aiosqlite.connect(_path()) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            "SELECT * FROM heartbeats WHERE plan_id = ? ORDER BY id DESC LIMIT ?",
            (plan_id, limit),
        )
        rows = await cur.fetchall()
        return [
            HeartbeatRecord(
                id=r["id"],
                plan_id=r["plan_id"],
                timestamp=r["timestamp"],
                selfie_hash=r["selfie_hash"],
                wallet_signature=r["wallet_signature"],
                phase_before=r["phase_before"],
                face_match_distance=r["face_match_distance"],
                created_at=r["created_at"],
            )
            for r in rows
        ]


# Events ---------------------------------------------------------------------

async def log_event(plan_id: str, kind: str, payload: dict[str, Any]) -> int:
    async with aiosqlite.connect(_path()) as conn:
        cur = await conn.execute(
            "INSERT INTO events (plan_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)",
            (plan_id, kind, json.dumps(payload, default=str), utcnow_iso()),
        )
        await conn.commit()
        return cur.lastrowid or 0


async def get_events(plan_id: str, limit: int = 100) -> list[Event]:
    async with aiosqlite.connect(_path()) as conn:
        conn.row_factory = aiosqlite.Row
        cur = await conn.execute(
            "SELECT * FROM events WHERE plan_id = ? ORDER BY id DESC LIMIT ?",
            (plan_id, limit),
        )
        rows = await cur.fetchall()
        return [
            Event(
                id=r["id"],
                plan_id=r["plan_id"],
                kind=r["kind"],
                payload=json.loads(r["payload_json"]),
                created_at=r["created_at"],
            )
            for r in rows
        ]


# Push subscriptions ---------------------------------------------------------

async def store_push_subscription(plan_id: str, subscription: dict[str, Any]) -> None:
    async with aiosqlite.connect(_path()) as conn:
        await conn.execute(
            "INSERT OR REPLACE INTO push_subscriptions (plan_id, subscription_json, created_at) VALUES (?, ?, ?)",
            (plan_id, json.dumps(subscription), utcnow_iso()),
        )
        await conn.commit()


async def get_push_subscription(plan_id: str) -> dict[str, Any] | None:
    async with aiosqlite.connect(_path()) as conn:
        cur = await conn.execute(
            "SELECT subscription_json FROM push_subscriptions WHERE plan_id = ?", (plan_id,)
        )
        row = await cur.fetchone()
        return json.loads(row[0]) if row else None
