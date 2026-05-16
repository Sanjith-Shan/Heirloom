---
name: "heirloom"
description: "Operate the Heirloom crypto dead-man's switch deployed on EigenCompute — configure beneficiaries, set heartbeat cadence, force phase transitions, run on-chain verifiability checks, and stage Demo Day rehearsals."
---

# Heirloom Skill

Heirloom is a TEE-resident agent that holds an encrypted copy of a wallet's seed phrase and autonomously distributes assets to beneficiaries if the owner stops checking in. This skill teaches a coding agent (Claude Code, Codex, etc.) how to operate it without learning the codebase from scratch.

## When to use

- The user asks to deploy, upgrade, configure, or rehearse Heirloom.
- The user asks to check status, run an analysis, force a phase, execute distribution, or reset.
- The user asks how the verifiability dashboard or KeyRegistrar lookup works for this app.

## Architecture (single-paragraph)

Two processes in one Docker image: a FastAPI agent (Python, `:8080`) that owns the state machine, key vault, and frontend, and a Node sidecar (`:9090`) that owns all EigenAI inference because the LLM Proxy is TypeScript-only. Inside the TEE, the sidecar auto-mints attested JWTs via `@layr-labs/ai-gateway-provider`. The TEE wallet (derived from KMS-injected `MNEMONIC`) signs every analysis verdict and execution log so the Verify page can recover the agent that produced them.

## Key files

| File | Purpose |
|------|---------|
| `agent/app/main.py` | FastAPI entrypoint, mounts routers, serves built frontend |
| `agent/app/services/escalation.py` | Phase state machine (`ACTIVE → REMINDER → EMERGENCY_CONTACT → VERIFICATION → EXECUTION`) |
| `agent/app/services/activity_analyzer.py` | EigenAI call (sidecar → direct gateway → on-chain mock) |
| `agent/app/services/executor.py` | Real on-chain transfers (web3.py, multi-chain, native + ERC-20) |
| `agent/app/services/key_vault.py` | Fernet-sealed seed storage, derived from TEE MNEMONIC |
| `agent/app/services/signer.py` | TEE wallet — signs every audit-relevant payload |
| `agent/app/routes/director.py` | `/api/director/*` — manual demo controls |
| `agent-sidecar/server.js` | Node Express, `POST /infer` for attested EigenAI calls |
| `frontend/src/pages/Director.tsx` | Demo control dashboard at `/director?key=...` |
| `frontend/src/pages/Verify.tsx` | Live signature recovery + on-chain probes |
| `Dockerfile` + `entrypoint.sh` | Boots both processes |
| `deploy.sh` | `docker buildx → ecloud deploy` wrapper |

## Common operations

### Local dev
```bash
# Backend
cd agent && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8080

# Sidecar (separate terminal)
cd agent-sidecar && npm install && npm start

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
```

### Deploy to EigenCompute
```bash
# Prereqs (one-time):
#   npm i -g @layr-labs/ecloud-cli && ecloud auth generate --store
#   ecloud billing subscribe && ecloud billing top-up --amount 50
#   docker login ghcr.io

REGISTRY=ghcr.io/<your-handle>/heirloom \
  RESEND_API_KEY=re_xxx DIRECTOR_KEY=demo-secret-2026 \
  ./deploy.sh
```
The script builds a `linux/amd64` image, pushes to the public registry, and runs `ecloud compute app deploy` with `--verifiable --repo --commit`.

### Verify a deployed instance
1. Open `https://verify-sepolia.eigencloud.xyz/app/<app-id>` — confirms image digest, EVM address, public env vars.
2. On the running app, hit `/verify` — runs the on-chain checks and signature recovery.
3. Cross-check the signer recovered from any analysis or execution log against the `agent_wallet_address` returned by `/api/health`.

### Director dashboard cheat-sheet
URL: `https://<your-app>/director?key=<DIRECTOR_KEY>`. Buttons:
- **Request heartbeat** — sends push to user PWA
- **Send reminder** — Resend email to user
- **Notify contacts** — Resend email to all emergency contacts
- **Run analysis** — fires real EigenAI call (or mock if sidecar+JWT both unavailable)
- **Dry run** — preview executor distribution math
- **Execute** — broadcasts real transactions on configured chains
- **Reset** — back to `ACTIVE` (for re-running the demo)

## Constraints (don't violate)

- Image MUST be `linux/amd64`. Check `docker manifest inspect` before deploy.
- App name MUST NOT contain spaces — verify dashboard shows `(unnamed)` otherwise.
- Container MUST run as root and bind to `0.0.0.0`.
- `MNEMONIC` is auto-injected — never set it via `--env`.
- `_PUBLIC` suffix puts an env var on-chain. Use only for boring metadata.
- Demo on `sepolia`, not `mainnet`. Mainnet networking can take 5+ min after `Running` status.

## Trust framing

Use "minimized, verifiable trust" — not "trustless." EigenVerify slashing is roadmap. The trust chain is: Intel TDX silicon → Google Confidential Space → Eigen Labs KMS → Lambda Inc. (AI inference) → developer key. The verify page surfaces this honestly.
