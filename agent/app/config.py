"""Environment-driven configuration for the Heirloom agent."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # TEE wallet — auto-injected in EigenCompute, manual for local dev
    mnemonic: str = Field(
        default="test test test test test test test test test test test junk",
        alias="MNEMONIC",
    )

    # EigenAI — primary path is the local Node sidecar (handles attestation
    # automatically via @layr-labs/ai-gateway-provider). Direct gateway HTTP is
    # the fallback for environments where the sidecar can't run.
    sidecar_url: str = Field(default="http://127.0.0.1:9090", alias="SIDECAR_URL")
    eigen_gateway_url: str = Field(
        default="https://ai-gateway-dev.eigencloud.xyz",
        alias="EIGEN_GATEWAY_URL",
    )
    eigen_model: str = Field(default="anthropic/claude-sonnet-4.6", alias="EIGEN_MODEL")
    kms_auth_jwt: str = Field(default="", alias="KMS_AUTH_JWT")
    kms_server_url: str = Field(default="", alias="KMS_SERVER_URL")
    kms_public_key: str = Field(default="", alias="KMS_PUBLIC_KEY")

    # OpenAI direct fallback — used when Eigen Labs' AI Gateway rejects
    # KMS-issued JWTs (current platform-side issue). Key lives in the
    # KMS-encrypted env vars; never appears on-chain.
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-4o-mini", alias="OPENAI_MODEL")

    # Demo controls
    demo_mode: bool = Field(default=True, alias="DEMO_MODE")
    director_key: str = Field(default="demo-secret-2026", alias="DIRECTOR_KEY")
    demo_fast_timers: bool = Field(default=True, alias="DEMO_FAST_TIMERS")

    # Notifications
    resend_api_key: str = Field(default="", alias="RESEND_API_KEY")
    resend_from_email: str = Field(default="heirloom@example.com", alias="RESEND_FROM_EMAIL")
    vapid_public_key: str = Field(default="", alias="VAPID_PUBLIC_KEY")
    vapid_private_key: str = Field(default="", alias="VAPID_PRIVATE_KEY")
    vapid_subject: str = Field(default="mailto:heirloom@example.com", alias="VAPID_SUBJECT")

    # Storage paths
    database_path: str = Field(default="./data/heirloom.db", alias="DATABASE_PATH")
    audit_path: str = Field(default="./data/audit", alias="AUDIT_PATH")
    user_persistent_data_path: str = Field(default="./data", alias="USER_PERSISTENT_DATA_PATH")

    # Server
    host: str = Field(default="0.0.0.0", alias="HOST")
    port: int = Field(default=8080, alias="PORT")
    public_url: str = Field(default="", alias="PUBLIC_URL")

    # Multi-chain RPCs
    rpc_url_1: str = Field(default="https://eth.llamarpc.com", alias="RPC_URL_1")
    rpc_url_8453: str = Field(default="https://mainnet.base.org", alias="RPC_URL_8453")
    rpc_url_137: str = Field(default="https://polygon-rpc.com", alias="RPC_URL_137")
    rpc_url_11155111: str = Field(default="https://rpc.sepolia.org", alias="RPC_URL_11155111")
    rpc_url_84532: str = Field(default="https://sepolia.base.org", alias="RPC_URL_84532")

    @property
    def chain_rpcs(self) -> dict[int, str]:
        return {
            1: self.rpc_url_1,
            8453: self.rpc_url_8453,
            137: self.rpc_url_137,
            11155111: self.rpc_url_11155111,
            84532: self.rpc_url_84532,
        }

    @property
    def db_path(self) -> Path:
        p = Path(self.database_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def audit_dir(self) -> Path:
        p = Path(self.audit_path)
        p.mkdir(parents=True, exist_ok=True)
        return p


@lru_cache
def get_settings() -> Settings:
    return Settings()


# Phase durations (seconds). DEMO_FAST_TIMERS shrinks them so the scheduler
# can drive a full lifecycle in under a minute for testing.
def phase_durations() -> dict[str, int]:
    s = get_settings()
    if s.demo_fast_timers:
        return {
            "ACTIVE": 30,
            "REMINDER": 15,
            "EMERGENCY_CONTACT": 15,
            "VERIFICATION": 15,
        }
    return {
        "ACTIVE": 30 * 24 * 3600,
        "REMINDER": 7 * 24 * 3600,
        "EMERGENCY_CONTACT": 7 * 24 * 3600,
        "VERIFICATION": 7 * 24 * 3600,
    }


# Hardcoded ERC-20 list per chain (symbol → address). Demo-only.
ERC20_TOKENS: dict[int, dict[str, str]] = {
    1: {
        "USDC": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "USDT": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        "DAI": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        "WETH": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    },
    8453: {
        "USDC": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "WETH": "0x4200000000000000000000000000000000000006",
    },
    11155111: {},  # testnet — no canonical addresses
    84532: {},
}
