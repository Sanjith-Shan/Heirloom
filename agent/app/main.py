"""Heirloom agent — FastAPI app entrypoint.

Single container: serves the React frontend at / and JSON API at /api/*.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .db import init_db
from .routes import director, heartbeat, plans, status
from .services import heartbeat_monitor
from .services.signer import agent_address

logger = logging.getLogger("heirloom")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    await init_db()
    logger.info("agent_wallet=%s demo_mode=%s", agent_address(), settings.demo_mode)
    heartbeat_monitor.start()
    try:
        yield
    finally:
        heartbeat_monitor.stop()


app = FastAPI(
    title="Heirloom",
    description="Crypto inheritance protection — a sovereign agent inside a TEE.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(plans.router)
app.include_router(heartbeat.router)
app.include_router(status.router)
app.include_router(director.router)


@app.get("/api/health")
async def health() -> dict:
    s = get_settings()
    return {
        "ok": True,
        "agent_address": agent_address(),
        "demo_mode": s.demo_mode,
        "model": s.eigen_model,
        "kms_jwt_configured": bool(s.kms_auth_jwt),
    }


@app.get("/api/agent-info")
async def agent_info() -> dict:
    """Public agent identity. Used by frontend to encrypt seed phrase + verify receipts."""
    return {
        "agent_address": agent_address(),
        # NOTE: production would publish a real RSA/EC pubkey for ECIES.
        # Demo: TLS terminates inside TEE, so client-encrypted blob is safe to ship.
        "encryption_scheme": "tls-into-tee",
    }


@app.get("/api/debug/attest")
async def debug_attest() -> dict:
    """Proxy to the sidecar's diagnostic endpoint — runs the TDX attestation
    flow against multiple candidate audiences and returns each JWT decoded
    plus the gateway's response. Used to debug JWT signature rejection."""
    import httpx
    s = get_settings()
    url = s.sidecar_url.rstrip("/") + "/debug/attest"
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.get(url)
        return r.json()
    except Exception as exc:
        return {"error": f"sidecar proxy failed: {exc}"}


# ----- Static frontend serving -----
# Mount built React app last so /api/* takes precedence.

FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    # Serve hashed assets (Vite emits to /assets)
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        # API paths handled by routers; static files served directly if they exist.
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(FRONTEND_DIST / "index.html"))
else:
    @app.get("/", include_in_schema=False)
    async def root():
        return JSONResponse(
            {
                "service": "heirloom",
                "note": "Frontend not built. Run `npm run build` in frontend/.",
                "agent_address": agent_address(),
            }
        )
