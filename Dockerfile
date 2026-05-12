# =============================================================================
# Heirloom — single-container deploy for EigenCompute Enterprise (Intel TDX)
# =============================================================================
# Multi-stage:
#   1. Build the React frontend (node)
#   2. Install Python deps + copy backend, then bake the frontend dist into it
#
# Constraints (from EigenCompute):
#   - FROM --platform=linux/amd64 (KMS strips other architectures)
#   - USER root (KMS expects to be able to write the auto-injected env vars)
#   - EXPOSE the port we listen on; bind to 0.0.0.0
#   - Caddy is auto-layered by the platform when TLS is enabled
# =============================================================================

# ---- Stage 1: build the frontend ----
FROM --platform=linux/amd64 node:20-slim AS frontend-builder

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY frontend/ ./
RUN npm run build

# ---- Stage 2: backend + bundled frontend ----
FROM --platform=linux/amd64 python:3.11-slim AS runtime

# Build deps for cryptography + web3 wheels
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY agent/requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY agent/ ./agent/

# Drop the built frontend right where main.py expects it
COPY --from=frontend-builder /build/dist ./frontend/dist

# Persistent disk for the SQLite DB + audit trail.
# EigenCompute mounts a volume at $USER_PERSISTENT_DATA_PATH (/mnt/disks/userdata).
ENV USER_PERSISTENT_DATA_PATH=/mnt/disks/userdata \
    DATABASE_PATH=/mnt/disks/userdata/heirloom.db \
    AUDIT_PATH=/mnt/disks/userdata/audit \
    HOST=0.0.0.0 \
    PORT=8080 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/agent

USER root

EXPOSE 8080

# In TEE: the KMS strips and re-injects MNEMONIC. We don't need to set it.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
