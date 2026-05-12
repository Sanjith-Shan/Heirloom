#!/usr/bin/env bash
# Heirloom — build, push, and deploy to EigenCompute (Intel TDX, sepolia).
#
# Prereqs (one-time):
#   npm install -g @layr-labs/ecloud-cli
#   docker login ghcr.io   # or docker login (Docker Hub)
#   ecloud auth generate --store
#   ecloud billing subscribe
#   ecloud billing top-up --amount 50
#
# Usage:
#   ./deploy.sh                       # uses sensible defaults
#   APP_NAME=heirloom-staging ./deploy.sh
#   REGISTRY=ghcr.io/your-handle/heirloom ./deploy.sh
#   TAG=v0.2 ./deploy.sh
#   RESEND_API_KEY=... DIRECTOR_KEY=... ./deploy.sh

set -euo pipefail

# ----- Config (override via env) -----
APP_NAME="${APP_NAME:-Heirloom-DMS}"               # NO SPACES (verify dashboard)
INSTANCE="${INSTANCE:-g1-standard-2t}"             # Intel TDX
REGISTRY="${REGISTRY:-ghcr.io/sanjith-shan/heirloom}"
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo latest)}"
NETWORK="${NETWORK:-sepolia}"
DOMAIN="${DOMAIN:-}"                                # set if you have a custom domain

IMAGE_REF="${REGISTRY}:${TAG}"

echo "==========================================="
echo "Heirloom deploy"
echo "  App:       $APP_NAME"
echo "  Instance:  $INSTANCE"
echo "  Image:     $IMAGE_REF"
echo "  Network:   $NETWORK"
echo "==========================================="

# ----- 1. Pre-flight checks -----
command -v docker  >/dev/null || { echo "docker not found"; exit 1; }
command -v ecloud  >/dev/null || { echo "ecloud CLI not found — npm i -g @layr-labs/ecloud-cli"; exit 1; }
docker buildx version >/dev/null 2>&1 || { echo "docker buildx not available"; exit 1; }

# ----- 2. Build & push linux/amd64 image to public registry -----
# arm64 deploys silently then crashes inside the TEE. Buildx forces amd64.
echo
echo "==> docker buildx build --platform linux/amd64 --push"
docker buildx build \
    --platform linux/amd64 \
    -t "$IMAGE_REF" \
    --push \
    .

# ----- 3. Set ecloud network -----
echo
echo "==> ecloud compute env set $NETWORK"
ecloud compute env set "$NETWORK" --yes || true

# ----- 4. Configure TLS (idempotent — generates Caddyfile + .env.example.tls) -----
echo
echo "==> ecloud compute app configure tls"
ecloud compute app configure tls || true

# ----- 5. Build deploy-time .env from template -----
ENV_FILE=".env.deploy"
cp agent/.env.example "$ENV_FILE"

# Strip placeholder MNEMONIC (KMS injects the real one in TEE)
sed -i.bak '/^MNEMONIC=/d' "$ENV_FILE" && rm -f "$ENV_FILE.bak"

{
  # _PUBLIC vars: visible on-chain via AppUpgraded events. Keep boring.
  echo "DEMO_MODE_PUBLIC=true"
  echo "EIGEN_MODEL_PUBLIC=anthropic/claude-sonnet-4.6"
  # Sealed (KMS-encrypted) vars
  [ -n "${DIRECTOR_KEY:-}"   ] && echo "DIRECTOR_KEY=$DIRECTOR_KEY"
  [ -n "${RESEND_API_KEY:-}" ] && echo "RESEND_API_KEY=$RESEND_API_KEY"
  [ -n "${RESEND_FROM_EMAIL:-}" ] && echo "RESEND_FROM_EMAIL=$RESEND_FROM_EMAIL"
  # Manual JWT — only needed if the sidecar's attestation flow fails
  [ -n "${KMS_AUTH_JWT:-}"   ] && echo "KMS_AUTH_JWT=$KMS_AUTH_JWT"
  # Domain hint (optional)
  [ -n "$DOMAIN" ] && echo "DOMAIN=$DOMAIN"
  echo "APP_PORT=8080"
} >> "$ENV_FILE"

# ----- 6. Deploy with verifiable build flags -----
COMMIT="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
REPO="$(git remote get-url origin 2>/dev/null || echo local)"

echo
echo "==> ecloud compute app deploy"
ecloud compute app deploy \
    --name "$APP_NAME" \
    --image-ref "$IMAGE_REF" \
    --instance-type "$INSTANCE" \
    --env-file "$ENV_FILE" \
    --log-visibility public \
    --verifiable \
    --repo "$REPO" \
    --commit "$COMMIT" \
    --verbose

# ----- 7. Set profile (no spaces in name!) and surface verify URL -----
APP_ID="$(ecloud compute app info --json 2>/dev/null | jq -r '.appId // empty' 2>/dev/null || true)"
if [ -n "$APP_ID" ]; then
    ecloud compute app profile set "$APP_ID" \
        --name "$APP_NAME" \
        --description "Crypto dead-man's switch — TEE-resident inheritance protocol" \
        --website "https://github.com/Sanjith-Shan/Heirloom" 2>/dev/null || true

    echo
    echo "==========================================="
    echo "Verifiability dashboard:"
    echo "  https://verify-${NETWORK}.eigencloud.xyz/app/${APP_ID}"
    echo "==========================================="
fi

echo
echo "==> ecloud compute app info"
ecloud compute app info

echo
echo "Tail logs with:  ecloud compute app logs --watch"
