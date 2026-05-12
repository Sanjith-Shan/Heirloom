#!/usr/bin/env bash
# Heirloom — deploy to EigenCompute (Intel TDX, sepolia, verifiable git build).
#
# Uses ecloud's git-source verifiable build mode: the platform builds the
# image from a pinned commit of the public GitHub repo, so the image digest
# is provably tied to the source. No local docker push required.
#
# One-time prereqs:
#   npm install -g @layr-labs/ecloud-cli
#   ecloud auth login           # or `ecloud auth gen` then store
#   ecloud billing subscribe
#   ecloud billing top-up --amount 50
#
# Usage:
#   ./deploy.sh                                  # defaults
#   APP_NAME=Heirloom-Staging ./deploy.sh
#   RESEND_API_KEY=re_xxx DIRECTOR_KEY=... ./deploy.sh
#   USE_IMAGE_REF=1 IMAGE_REF=ghcr.io/x/heirloom:tag ./deploy.sh   # prebuilt mode

set -euo pipefail

# ----- Config (override via env) -----
APP_NAME="${APP_NAME:-Heirloom-DMS}"          # NO SPACES (verify dashboard reqt)
INSTANCE="${INSTANCE:-g1-standard-4t}"        # Intel TDX (smallest TDX option)
NETWORK="${NETWORK:-sepolia}"
REPO_URL="${REPO_URL:-https://github.com/Sanjith-Shan/Heirloom}"
COMMIT="${COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
BUILD_DOCKERFILE="${BUILD_DOCKERFILE:-Dockerfile}"

DESCRIPTION="${DESCRIPTION:-Crypto inheritance protocol — TEE-resident sovereign agent}"
WEBSITE="${WEBSITE:-https://github.com/Sanjith-Shan/Heirloom}"

echo "================================================================"
echo " Heirloom deploy"
echo "   App:        $APP_NAME"
echo "   Instance:   $INSTANCE"
echo "   Network:    $NETWORK"
echo "   Mode:       ${USE_IMAGE_REF:+prebuilt image-ref}${USE_IMAGE_REF:-verifiable git build}"
echo "   Repo:       $REPO_URL"
echo "   Commit:     $COMMIT"
echo "================================================================"

# ----- 1. Pre-flight -----
command -v ecloud >/dev/null || { echo "ecloud CLI not found — npm i -g @layr-labs/ecloud-cli"; exit 1; }
command -v git    >/dev/null || { echo "git not found"; exit 1; }

# ----- 2. Set environment + warn on uncommitted changes -----
ecloud compute env set "$NETWORK" --yes >/dev/null

if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    echo
    echo "WARNING: working tree has uncommitted changes."
    echo "Verifiable build deploys commit $COMMIT — local edits won't ship."
    echo
fi

# ----- 3. Configure TLS (generates Caddyfile + .env.example.tls; idempotent) -----
echo "==> ecloud compute app configure tls"
ecloud compute app configure tls >/dev/null 2>&1 || true

# ----- 4. Compose deploy-time .env (no MNEMONIC — KMS injects in TEE) -----
ENV_FILE=".env.deploy"
cp agent/.env.example "$ENV_FILE"
# Strip MNEMONIC, KMS_AUTH_JWT placeholder lines
sed -i.bak -E '/^(MNEMONIC|KMS_AUTH_JWT|KMS_SERVER_URL|KMS_PUBLIC_KEY)=/d' "$ENV_FILE"
rm -f "$ENV_FILE.bak"

{
    # _PUBLIC suffix → on-chain via AppUpgraded events
    echo "DEMO_MODE_PUBLIC=true"
    echo "EIGEN_MODEL_PUBLIC=anthropic/claude-sonnet-4.6"
    # Sealed (KMS-encrypted) overrides
    [ -n "${DIRECTOR_KEY:-}" ]      && echo "DIRECTOR_KEY=$DIRECTOR_KEY"
    [ -n "${RESEND_API_KEY:-}" ]    && echo "RESEND_API_KEY=$RESEND_API_KEY"
    [ -n "${RESEND_FROM_EMAIL:-}" ] && echo "RESEND_FROM_EMAIL=$RESEND_FROM_EMAIL"
    # Optional manual JWT (only useful if sidecar attestation flow is broken)
    [ -n "${KMS_AUTH_JWT:-}" ]      && echo "KMS_AUTH_JWT=$KMS_AUTH_JWT"
    # APP_PORT is read by Caddy when TLS is configured
    echo "APP_PORT=8080"
    [ -n "${DOMAIN:-}" ] && echo "DOMAIN=$DOMAIN"
} >> "$ENV_FILE"

echo "==> deploy env file: $ENV_FILE"

# ----- 5. Deploy -----
DEPLOY_FLAGS=(
    --environment "$NETWORK"
    --name "$APP_NAME"
    --description "$DESCRIPTION"
    --website "$WEBSITE"
    --instance-type "$INSTANCE"
    --env-file "$ENV_FILE"
    --log-visibility public
    --verifiable
    --verbose
)

if [ -n "${USE_IMAGE_REF:-}" ]; then
    [ -z "${IMAGE_REF:-}" ] && { echo "USE_IMAGE_REF set but IMAGE_REF empty"; exit 1; }
    DEPLOY_FLAGS+=(--image-ref "$IMAGE_REF")
else
    DEPLOY_FLAGS+=(
        --repo "$REPO_URL"
        --commit "$COMMIT"
        --build-dockerfile "$BUILD_DOCKERFILE"
    )
fi

echo
echo "==> ecloud compute app deploy ${DEPLOY_FLAGS[*]}"
ecloud compute app deploy "${DEPLOY_FLAGS[@]}"

# ----- 6. Surface verify dashboard URL -----
echo
echo "==> ecloud compute app list"
ecloud compute app list || true

echo
echo "================================================================"
echo " Verifiability dashboard:"
echo "   https://verify-${NETWORK}.eigencloud.xyz/app/<app-id-from-list>"
echo
echo " Tail logs:        ecloud compute app logs --watch"
echo " Restart:          ecloud compute app stop && ecloud compute app start"
echo " Upgrade in place: ecloud compute app upgrade <app-id> --commit <new-sha>"
echo "================================================================"
