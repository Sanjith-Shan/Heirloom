#!/usr/bin/env bash
# Heirloom deployment script — wraps `ecloud` CLI with verifiable build flags.
# Run from the repo root.
set -euo pipefail

APP_NAME="${APP_NAME:-heirloom}"
INSTANCE="${INSTANCE:-enterprise-1}"

# Public env vars (go on-chain in AppUpgraded events — keep boring/marketing only)
PUBLIC_VARS=(
  "DEMO_MODE_PUBLIC=true"
  "EIGEN_MODEL_PUBLIC=gpt-oss-120b-f16"
)

# Sealed env vars (KMS-encrypted, off-chain)
SEALED_VARS=(
  "DIRECTOR_KEY=${DIRECTOR_KEY:-demo-secret-2026}"
  "RESEND_API_KEY=${RESEND_API_KEY:-}"
  "KMS_AUTH_JWT=${KMS_AUTH_JWT:-}"   # only needed for local-equivalent runs
)

# 1) Make sure the app exists (idempotent — `app create` errors if exists, fine)
ecloud compute app create --name "$APP_NAME" --language python || true

# 2) Build via the CLI's verifiable-build path. Requires a public commit.
COMMIT="$(git rev-parse HEAD)"
REPO="$(git remote get-url origin 2>/dev/null || echo 'local')"

ENV_ARGS=()
for v in "${PUBLIC_VARS[@]}" "${SEALED_VARS[@]}"; do
  ENV_ARGS+=(--env "$v")
done

echo ">>> Deploying $APP_NAME @ $COMMIT"
echo ">>> Repo: $REPO"
echo ">>> Instance: $INSTANCE"

ecloud compute app deploy "$APP_NAME" \
  --instance-type "$INSTANCE" \
  --verifiable \
  --repo "$REPO" \
  --commit "$COMMIT" \
  --log-visibility public \
  "${ENV_ARGS[@]}"

# 3) Configure TLS (separate command — runs Caddy inside TEE)
ecloud compute app configure tls "$APP_NAME"

# 4) Show app info + tail logs
ecloud compute app info "$APP_NAME"
echo
echo ">>> Tail logs with: ecloud compute app logs $APP_NAME --watch"
