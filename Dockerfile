# =============================================================================
# Heirloom — single-container deploy for EigenCompute (Intel TDX, g1-standard-2t)
# =============================================================================
# Bundles two processes:
#   - FastAPI agent (Python 3.11) on :8080 — main API + static frontend
#   - Node sidecar  (Node 20)       on :9090 — handles attested EigenAI calls
#
# Constraints from EigenCompute:
#   - linux/amd64 only (KMS rejects other arches; build with `docker buildx`)
#   - USER root (KMS injects MNEMONIC env var into the container)
#   - Bind to 0.0.0.0; Caddy is auto-layered for TLS
#   - Image must be pushed to a public registry (GHCR / Docker Hub) — TEE
#     pulls at deploy time, no local images allowed
# =============================================================================

# ---- Stage 1: build the React frontend ----
FROM --platform=linux/amd64 node:20-slim AS frontend-builder

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: install Node sidecar deps (production only) ----
FROM --platform=linux/amd64 node:20-slim AS sidecar-builder

WORKDIR /build
COPY agent-sidecar/package.json agent-sidecar/package-lock.json* ./
RUN npm install --no-audit --no-fund --omit=dev
COPY agent-sidecar/ ./

# ---- Stage 3: runtime (Python + bundled Node) ----
FROM --platform=linux/amd64 python:3.11-slim AS runtime

# Install Node 20 alongside Python (sidecar needs Node)
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential ca-certificates curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get purge -y --auto-remove gnupg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps first (best layer caching)
COPY agent/requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Backend
COPY agent/ ./agent/

# Built frontend dropped where main.py expects it
COPY --from=frontend-builder /build/dist ./frontend/dist

# Sidecar (with node_modules baked in)
COPY --from=sidecar-builder /build ./agent-sidecar

# Multi-process entrypoint
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Persistent disk for SQLite + audit trail. EigenCompute mounts a volume
# at $USER_PERSISTENT_DATA_PATH (/mnt/disks/userdata).
ENV USER_PERSISTENT_DATA_PATH=/mnt/disks/userdata \
    DATABASE_PATH=/mnt/disks/userdata/heirloom.db \
    AUDIT_PATH=/mnt/disks/userdata/audit \
    HOST=0.0.0.0 \
    PORT=8080 \
    SIDECAR_URL=http://127.0.0.1:9090 \
    SIDECAR_PORT=9090 \
    SIDECAR_HOST=127.0.0.1 \
    EIGEN_GATEWAY_URL=https://ai-gateway-dev.eigencloud.xyz \
    EIGEN_MODEL=anthropic/claude-sonnet-4.6 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/agent

USER root

EXPOSE 8080

CMD ["./entrypoint.sh"]
