# Heirloom

> A sovereign agent that holds your seed phrase inside a TEE and autonomously distributes your assets to your beneficiaries if you stop checking in.

Heirloom is a crypto inheritance protocol. The user keeps and uses their own wallet normally. They give a copy of their seed phrase to an agent running inside an Intel TDX hardware enclave on EigenCompute — even the operator cannot read what's sealed inside. The user checks in periodically with a selfie and a wallet signature. If they stop checking in, the agent runs a multi-phase verification protocol — reminders, emergency-contact notifications, on-chain wallet-activity analysis by a language model — and then autonomously distributes their assets to pre-configured beneficiaries on the chains they specified. Every step is signed by the TEE-derived agent wallet so anyone can independently verify what happened.

---

## The problem

Roughly 3.8 million Bitcoin (~20% of supply) is permanently inaccessible — lost keys, dead owners, forgotten wallets. At current prices that is more than $400B locked away forever. Courts can grant heirs legal ownership of an estate, but the blockchain only recognizes the private key. No key, no funds.

Every existing solution gets the trade-off wrong:

| Solution | Approach | Why it fails |
|---|---|---|
| **Sarcophagus** | Decentralized dead-man's switch on Ethereum + Arweave; "Archaeologist" nodes hold encrypted shards | Token incentive collapsed; node operators have no economic reason to stay online |
| **Casa** | Custodial / semi-custodial inheritance product | Closed-source, expensive, requires trusting a single company — the opposite of self-custody |
| **Multisig** | 2-of-3 with spouse + child + lawyer | Requires every signer to remain crypto-literate and operate keys correctly indefinitely |
| **Shamir-based services** | Split the seed across guardians via Shamir's Secret Sharing | Requires a custom token; coordination on key reassembly is brittle |
| **CLI proof-of-concepts** | Open-source split-and-store tools | No TEE, no autonomous execution, no audit trail |

Heirloom seals the recovery material in hardware-encrypted memory that the operator cannot read, monitors liveness with a multi-phase escalation protocol, and autonomously executes distribution with a verifiable cryptographic audit trail.

---

## How it works

### Setup

1. The user opens Heirloom in a browser and enters their seed phrase.
2. The phrase is encrypted **in the browser** with an ephemeral AES-GCM key before it leaves the device.
3. The encrypted bundle is sent over TLS that **terminates inside the TEE** — the host operating system never sees the plaintext.
4. The agent decrypts the envelope, derives the wallet address, confirms it matches what the user declared, and re-encrypts the seed with a Fernet key derived from the TEE-only `MNEMONIC` (sealed storage).
5. The user configures beneficiaries (addresses + percentages summing to 100), emergency contacts (name + email), heartbeat interval (30/60/90 days), and which chains to monitor.

### Heartbeat

Each check-in:
- Selfie captured client-side; SHA-256 hash extracted; **the photo never leaves the device**.
- The user's wallet signs a per-check-in challenge produced by the agent (`Heirloom heartbeat <plan-id> <timestamp>`).
- The agent verifies the signature recovers to the registered wallet address and resets the plan to `ACTIVE`.

Optional: client-side face matching with face-api.js. A 128-dimensional descriptor extracted at setup is stored alongside the plan; subsequent heartbeats compare the live descriptor to the reference. The threshold (Euclidean distance) is configurable. The image itself is still never transmitted.

### Escalation

A five-phase state machine drives the protocol from healthy to terminal:

```
ACTIVE ──timer──▶ REMINDER ──timer──▶ EMERGENCY_CONTACT
                                         │
                                         │ timer
                                         ▼
                                   VERIFICATION ──active wallet──▶ extends self
                                         │
                                         │ timer + verdict NOT active
                                         ▼
                                    EXECUTION ──▶ COMPLETED
```

- **ACTIVE** — heartbeat received within the configured interval. Default 30 days.
- **REMINDER** — interval elapsed. Reminder email goes to the user. Default 7-day window.
- **EMERGENCY_CONTACT** — reminder window elapsed. Each emergency contact gets an email asking them to prompt the user. Default 7-day window.
- **VERIFICATION** — emergency-contact window elapsed. The agent runs a deterministic on-chain wallet activity analysis through a language model. If the verdict is `HIGH` or `MEDIUM` confidence the wallet owner is still active, the plan extends back; otherwise it proceeds.
- **EXECUTION** — terminal. The agent unseals the seed inside the TEE, derives the user's wallet, scans balances on every configured chain, and broadcasts native + ERC-20 transfers split by beneficiary percentages. The full execution log is signed by the TEE wallet.

Any heartbeat at any non-terminal phase resets to `ACTIVE`.

### Inference

The verification phase needs an LLM call. Heirloom uses a fallback chain so a single broken provider never halts the protocol:

1. **Local Node sidecar** — TypeScript Express server running in the same container on `127.0.0.1:9090`. Uses `@layr-labs/ai-gateway-provider` to mint short-lived JWTs from the EigenCompute KMS via TDX attestation, then calls Eigen Labs' AI Gateway. This is the canonical, fully-attested path.
2. **Direct AI Gateway HTTP** — same gateway, but using a manually-issued `KMS_AUTH_JWT`. Used when the sidecar can't run.
3. **Direct OpenAI** — a fallback to OpenAI's API. The key is held in KMS-encrypted env vars; the call still happens from inside the TEE.
4. **On-chain heuristic** — last resort. The verdict is derived purely from real on-chain reads (transaction count + last seen) when no inference provider is available.

In every case the verdict is signed with the TEE-derived agent wallet so the audit trail records *which deployed agent* produced the analysis, regardless of the upstream provider.

### Execution

```python
# Stored key approach. Sketch:
account = key_vault.derive_wallet(plan_id)      # decrypt + derive inside TEE
for chain_id in plan.configured_chains:
    web3 = w3(chain_id)
    balance = get_native_balance(chain_id, account.address)
    distributable = balance - reserved_gas
    for beneficiary in plan.beneficiaries:
        amount = distributable * beneficiary.percentage // 100
        tx = build_tx(to=beneficiary.address, value=amount, ...)
        signed = account.sign_transaction(tx)
        tx_hash = web3.eth.send_raw_transaction(signed.raw_transaction)
        record(tx_hash)
    distribute_erc20s_similarly()
log = sign_execution_log(transfers)             # signed by TEE wallet
audit.write(log)                                # to TEE-mounted persistent disk
notifier.notify_execution_complete(plan)        # emails to all contacts
```

Real `web3.py`, real signed transactions broadcast on every configured chain. No mocks, no off-chain promises.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  User device (browser or installed PWA)                              │
│   Setup · Heartbeat · Dashboard · Verify                             │
└─────────┬──────────────────┬──────────────────┬─────────────────────┘
          │ AES-GCM          │ SHA-256(selfie)  │ HTTPS reads
          │ envelope         │ + wallet sig     │
          ▼                  ▼                  ▼
╔═══════════════════════════════════════════════════════════════════════╗
║   Heirloom agent — EigenCompute Intel TDX TEE                         ║
║                                                                       ║
║   Python FastAPI on :8080                                             ║
║   ├ Key vault (Fernet seal, key derived from TEE-only MNEMONIC)       ║
║   ├ Heartbeat (verifies wallet sig, resets phase)                     ║
║   ├ Escalation state machine                                          ║
║   ├ Notifier (email via Resend, optional Web Push via VAPID)          ║
║   ├ Activity analyzer (calls sidecar or fallback)                     ║
║   ├ Executor (web3.py, multi-chain, native + ERC-20)                  ║
║   ├ Audit logger (every action signed by the TEE wallet)              ║
║   └ Static frontend (React/Vite bundled into the same image)          ║
║                                                                       ║
║   Node sidecar on 127.0.0.1:9090                                      ║
║   └ @layr-labs/ai-gateway-provider — mints attested JWTs from KMS,    ║
║     calls Eigen Labs AI Gateway. FastAPI calls this over loopback.    ║
║                                                                       ║
║   Storage:                                                            ║
║   ├ SQLite (encrypted seeds, plan state, audit events) on a           ║
║   │ persistent volume that survives image upgrades                    ║
║   └ Audit JSON files on the same volume, each carrying a TEE-wallet   ║
║     signature                                                         ║
║                                                                       ║
║   Identity: TEE wallet derived from KMS-injected MNEMONIC             ║
║   (BIP-39 → BIP-32/44 m/44'/60'/0'/0/0). Stable across restarts and   ║
║   image upgrades; lost on app termination.                            ║
╚═══════════════════════════════════════════════════════════════════════╝
          │                            │
          ▼                            ▼
   AI Gateway (EigenAI)          EVM chains (Ethereum, Base, etc.)
   deterministic prompts,        real broadcasts on EXECUTION
   attestation-derived auth
```

Full architectural detail (including alternatives considered and rejected) is in [`docs/architecture.md`](docs/architecture.md).

---

## Tech stack

- **Backend**: Python 3.11, FastAPI, uvicorn, web3.py, eth-account, aiosqlite, httpx, cryptography (Fernet), APScheduler
- **Inference sidecar**: Node.js 20, Express, `@layr-labs/ai-gateway-provider`, `@layr-labs/ecloud-sdk`, Vercel AI SDK
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, ethers v6, face-api.js, vite-plugin-pwa
- **Email**: Resend (HTTP API)
- **Deployment**: EigenCompute (Intel TDX TEE on Google Confidential Space), verifiable git-source build
- **Inference**: Eigen Labs AI Gateway (`anthropic/claude-sonnet-4.6` and others), with OpenAI as a secondary provider
- **Container**: single Docker image bundling FastAPI + sidecar + built frontend, started via `entrypoint.sh`

---

## Project structure

```
heirloom/
├── README.md                  This file
├── CLAUDE.md                  Engineering reference (architecture notes,
│                              corrections, deployment shape)
├── SKILL.md                   Operating skill for coding agents
├── docs/
│   ├── architecture.md        Detailed system design + alternatives
│   └── product-feedback.md    Feedback for Eigen Labs
├── Dockerfile                 Multi-stage: frontend build → sidecar deps
│                              → Python runtime with Node bundled in
├── entrypoint.sh              Boots sidecar then FastAPI in one process tree
├── deploy.sh                  Wraps `ecloud compute app deploy --verifiable`
├── eigencloud-platform.md     EigenCloud platform reference
├── agent/
│   ├── requirements.txt
│   ├── .env.example
│   └── app/
│       ├── main.py            FastAPI entrypoint, lifespan, static serving
│       ├── config.py          Pydantic Settings, env vars, RPCs, ERC-20 list
│       ├── models.py          Pydantic models — request/response shapes
│       ├── db.py              SQLite (aiosqlite) — plans, heartbeats, events
│       ├── routes/
│       │   ├── plans.py       Create / read inheritance plans
│       │   ├── heartbeat.py   Receive selfie hash + wallet signature
│       │   ├── status.py      Public status + audit trail
│       │   └── director.py    Operator endpoints (advance phase, etc.)
│       ├── services/
│       │   ├── key_vault.py   Open envelope, seal/unseal seed phrase
│       │   ├── signer.py      TEE wallet — sign audit payloads
│       │   ├── heartbeat_monitor.py  Background scheduler
│       │   ├── escalation.py  Phase transition state machine
│       │   ├── notifier.py    Email (Resend) + push (VAPID, stub)
│       │   ├── activity_analyzer.py  Inference fallback chain
│       │   ├── executor.py    On-chain distribution (native + ERC-20)
│       │   └── audit.py       Persistent audit log
│       └── utils/
│           ├── crypto.py      AES-GCM helpers
│           └── chain.py       web3 client per chain, balance fetching
├── agent-sidecar/             Node Express server bundled in same image
│   ├── package.json
│   └── server.js
└── frontend/
    ├── package.json
    ├── vite.config.ts         + PWA plugin
    ├── tailwind.config.ts
    ├── index.html
    ├── public/
    │   ├── manifest.json      PWA manifest
    │   └── models/            face-api.js model weights (~12MB)
    └── src/
        ├── App.tsx
        ├── pages/             Landing, Setup, Dashboard, Heartbeat,
        │                      Director, AuditTrail, Verify
        ├── components/        CameraCapture, PhaseIndicator,
        │                      CountdownTimer, EventLog, TxLink
        └── lib/
            ├── api.ts         Typed FastAPI client
            ├── crypto.ts      Browser AES-GCM seed encryption
            ├── faceMatch.ts   face-api.js wrapper
            ├── verify.ts      Recover signers + canonical-JSON digest
            └── onchain.ts     Read AppController + KeyRegistrar live
```

---

## Local development

Three processes — backend, sidecar, frontend — running in parallel.

### Prerequisites

- Python 3.11+
- Node.js 20+ and npm
- A test BIP-39 mnemonic (the `.env.example` ships with the standard `test test test … junk` phrase)
- (Optional) a Resend API key for real email delivery
- (Optional) an OpenAI API key for the secondary inference path

### Setup

```bash
# Backend
cd agent
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env

# Sidecar
cd ../agent-sidecar && npm install

# Frontend
cd ../frontend && npm install
```

### Run

```bash
# Terminal 1 — sidecar (port 9090, loopback only)
cd agent-sidecar && npm start

# Terminal 2 — backend (port 8080, serves API + built frontend)
cd agent && source .venv/bin/activate
uvicorn app.main:app --reload --port 8080

# Terminal 3 — frontend dev server with hot reload (port 5173)
cd frontend && npm run dev
```

The frontend dev server proxies API calls to `http://127.0.0.1:8080`. To run the full stack as it ships in production (frontend bundled into the FastAPI container), `cd frontend && npm run build` then visit the backend's port directly.

---

## Deployment

Heirloom is built to deploy as a single container to [EigenCompute](https://docs.eigencloud.xyz/eigencompute/get-started/eigencompute-overview). The platform layers Caddy (TLS) and a KMS client on top of the user image, runs it on a TDX-enabled GCE instance inside Google Confidential Space, and pins the deployed image digest to a public git commit.

### Prerequisites

```bash
npm install -g @layr-labs/ecloud-cli
ecloud auth login              # or `ecloud auth gen` for a fresh key
ecloud billing subscribe       # apply your EigenCloud preview coupon
```

### Deploy

```bash
./deploy.sh
```

The script uses **verifiable git-source build mode** — EigenCompute clones the public repo at the pinned commit, builds the image on its own infrastructure, and verifies the build provenance. There is no local docker push.

Behind the scenes:

```bash
ecloud compute app deploy \
  --name Heirloom-DMS \
  --instance-type g1-standard-4t \
  --env-file .env.deploy \
  --log-visibility public \
  --verifiable \
  --repo https://github.com/<owner>/<repo> \
  --commit <sha> \
  --build-dockerfile Dockerfile \
  --resource-usage-monitoring enable
```

Key constraints (enforced by the platform):
- Container image must be `linux/amd64`. The provided Dockerfile pins this with `--platform=linux/amd64`.
- Container must run as `root`. The KMS injects environment variables that require root permissions to write.
- Container binds to `0.0.0.0`. Caddy is auto-layered for TLS termination when a `DOMAIN` is set.
- App name must contain no spaces, otherwise the verifiability dashboard shows `(unnamed)`.
- The image must come from a public source (either a public GitHub repo for verifiable builds or a public registry).

### After deploy

The CLI prints the app ID. Use it to:

- View live status: `ecloud compute app info <app-id>`
- Stream logs: `ecloud compute app logs <app-id> --watch`
- Inspect the image and provenance on the verifiability dashboard: `https://verify-sepolia.eigencloud.xyz/app/<app-id>` (or `verify.eigencloud.xyz` for mainnet)
- Upgrade in place to a newer commit: `ecloud compute app upgrade <app-id> --commit <new-sha> --verifiable --repo …`

---

## Configuration

All configuration is via environment variables. The full template is in [`agent/.env.example`](agent/.env.example).

| Variable | Required | Description |
|---|---|---|
| `MNEMONIC` | Auto-injected in TEE | BIP-39 phrase; KMS derives this from the app ID. The user must NOT set it in production. Test value provided for local dev. |
| `DIRECTOR_KEY` | Yes | Secret used to authenticate operator endpoints |
| `EIGEN_GATEWAY_URL` | No | Defaults to `https://ai-gateway-dev.eigencloud.xyz` |
| `EIGEN_MODEL` | No | Defaults to `anthropic/claude-sonnet-4.6` |
| `KMS_AUTH_JWT` | No | Manual override JWT (bypasses attestation, used for local dev) |
| `KMS_SERVER_URL`, `KMS_PUBLIC_KEY` | Auto-injected in TEE | Used by the sidecar for attestation-derived JWT minting |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | No | Secondary inference path |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | No | Real email delivery; logged-only stub if absent |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | No | Web Push notifications (currently a stub) |
| `RPC_URL_<chain_id>` | No | Override the default public RPC for any chain |
| `DATABASE_PATH`, `AUDIT_PATH`, `USER_PERSISTENT_DATA_PATH` | No | Defaults targeted at the TEE-mounted volume `/mnt/disks/userdata` |
| `HOST`, `PORT` | No | Server binding; defaults to `0.0.0.0:8080` |
| `SIDECAR_URL`, `SIDECAR_PORT`, `SIDECAR_HOST` | No | Loopback addressing for the Node sidecar |

Variables suffixed `_PUBLIC` (e.g. `EIGEN_MODEL_PUBLIC=...`) are stored on-chain in cleartext via `AppUpgraded` events and are visible to anyone. Use this only for non-sensitive metadata. Everything else is encrypted by the KMS and decrypted only inside the enclave.

---

## Trust model

Heirloom is honest about what it requires you to trust. The trust chain, in order:

1. **Intel TDX silicon** — the hardware-rooted enclave. Compromise here breaks every cloud TEE.
2. **Google Confidential Space** — runs the TDX VM and provides attestation evidence.
3. **Eigen Labs KMS** — verifies attestation and injects the `MNEMONIC` and inference JWTs.
4. **EigenCompute platform** — pins the deployed image digest on-chain in `AppController`.
5. **Inference provider** (Eigen Labs AI Gateway, OpenAI as secondary) — sees the prompt and produces the verdict.
6. **The developer** — controls future upgrades to this image. Until [EigenVerify](https://eigenverify.eigencloud.xyz) slashing ships, a malicious upgrade could exfiltrate sealed seeds.

Mitigations:
- All code is open-source and the deployed image is built from a pinned public commit (verifiable git-source build).
- Anyone can monitor `AppUpgraded` events on `AppController` and verify each new image digest matches a published commit.
- Every audit-relevant payload (analysis verdicts, execution logs) is signed by the TEE-derived wallet, and the wallet address is published. A compromised future image cannot retroactively forge signatures from past versions.
- Frame the system as **minimized, verifiable trust** — not "trustless." `EigenVerify` slashing is on the roadmap and will close the developer-trust gap once it ships.

---

## Verifiability

Anyone can independently verify a deployment without trusting Heirloom or its operator.

### Verify the deployed image

```bash
ecloud compute app info <app-id>
ecloud compute app releases <app-id>
```

The `releases` command shows the image digest, source repo, source commit SHA, and build provenance signature. Cross-check the commit on GitHub.

The official verifiability dashboard at `https://verify-sepolia.eigencloud.xyz/app/<app-id>` (or `verify.eigencloud.xyz` for mainnet) renders the same data plus the public env vars and the EVM/Solana addresses derived from the app's KMS-issued MNEMONIC.

### Verify a signed audit event

Every analysis verdict and execution log is signed by the TEE-derived agent wallet over a canonical JSON digest:

```python
canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
digest    = hashlib.sha256(canonical.encode()).hexdigest()
signature = tee_wallet.sign_message(encode_defunct(text=digest))
```

To verify in any language:

```ts
import { ethers } from "ethers";
const recovered = ethers.verifyMessage(digest, "0x" + signature);
// recovered must equal the published agent wallet address
```

The Verify page in the frontend (`/verify`) does this in-browser for every recent audit event and additionally probes `AppController` and `KeyRegistrar` on Sepolia to confirm those contracts are deployed at the expected addresses.

### Replay an analysis verdict

Activity analysis is deterministic: same prompt + same model + `seed=42` produces the same output on the same GPU SKU. The analysis result records `prompt_hash` (sha256 of the canonical prompt) and `model_id`. Anyone can replay the same prompt against the same model and confirm the verdict.

---

## Operator console

The `/director` route exposes a control surface for an operator (or for end-to-end testing). It is protected by a secret `DIRECTOR_KEY` and is never linked from the main UI.

| Endpoint | Effect |
|---|---|
| `POST /api/director/advance-phase` | Force-advance the active plan to its next phase |
| `POST /api/director/request-heartbeat` | Send a Web Push to the user's PWA prompting them to check in |
| `POST /api/director/send-reminder` | Dispatch the user-reminder email immediately |
| `POST /api/director/notify-contacts` | Dispatch emergency-contact emails immediately |
| `POST /api/director/run-analysis` | Run the wallet-activity analysis and surface the signed verdict |
| `GET  /api/director/dry-run` | Preview what `EXECUTE` would broadcast without actually broadcasting |
| `POST /api/director/execute` | Trigger asset distribution immediately |
| `POST /api/director/cancel-plan` | Mark the plan `CANCELLED` |
| `POST /api/director/reset` | Reset to `ACTIVE` and clear the heartbeat timer |
| `GET  /api/director/info` | Report active-plan summary |

In normal operation a background `APScheduler` job polls every minute and advances phases automatically when their timer expires. Setting `DEMO_MODE=true` disables auto-advancement so the operator drives transitions explicitly.

---

## Roadmap

Out of scope for the current alpha; intended next:

- **Real liveness detection**: integrate a passive single-image anti-spoof SDK (e.g. IDLive Face / Facia, ~99.8% anti-spoof accuracy). Today's selfie + wallet-sig is sufficient for proof-of-concept but not adversarial.
- **SSA Death Master File integration**: 85M+ records, requires NTIS certification. Currently mocked in the verification step.
- **Smart contract wallet integration**: long-term the right answer for asset access; today we use the simpler stored-key approach.
- **Non-EVM chains**: Bitcoin, Solana, Cosmos. Architecture supports adding any chain a Python library can talk to.
- **EigenDA writes**: persist signed audit receipts to EigenDA in addition to the local TEE-mounted disk for off-host tamper-resistance. Currently no first-party Python or stable JS SDK; pending platform work.
- **EigenVerify slashing**: closes the developer-upgrade trust gap. Not yet live in alpha.
- **Production ECIES envelope**: today the seed phrase rides TLS into the TEE. Production should publish a real public key for ECIES so the envelope is end-to-end encrypted independent of TLS.
- **Web Push (VAPID)**: notifier has the wiring but no production VAPID keys generated.
- **Hardware-key heartbeat**: support YubiKey / Passkey / hardware wallet sign-ins as an alternative to a software wallet signature.

---

## Acknowledgments

- [EigenCompute](https://docs.eigencloud.xyz/eigencompute/get-started/eigencompute-overview) for the TDX TEE platform and KMS-injected identity primitives
- [Layr-Labs/ecloud-inference-example](https://github.com/Layr-Labs/ecloud-inference-example) — canonical pattern for the AI Gateway integration
- [face-api.js](https://github.com/justadudewhohacks/face-api.js) — client-side face detection and recognition
- [Resend](https://resend.com) — transactional email
