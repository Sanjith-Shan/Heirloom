#!/usr/bin/env bash
# Boots the Node inference sidecar and the FastAPI agent in the same container.
# If the sidecar dies, the container exits — uvicorn cannot operate without
# inference for the verification phase.
set -e

trap 'kill 0' EXIT INT TERM

echo "[entrypoint] starting Node inference sidecar on :${SIDECAR_PORT:-9090}..."
node /app/agent-sidecar/server.js &
SIDECAR_PID=$!

# Give the sidecar a moment to bind. Real readiness is gated by FastAPI's
# /api/health endpoint, which probes the sidecar.
sleep 1

if ! kill -0 "$SIDECAR_PID" 2>/dev/null; then
  echo "[entrypoint] sidecar failed to start"
  exit 1
fi

echo "[entrypoint] starting FastAPI on :${PORT:-8080}..."
exec uvicorn app.main:app --host "${HOST:-0.0.0.0}" --port "${PORT:-8080}"
