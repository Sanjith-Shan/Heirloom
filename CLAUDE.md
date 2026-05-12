# Heirloom — Crypto Dead Man's Switch
## Claude Code Project Context & Architecture

---

## 0. ARCHITECTURE NOTES (v0.2 — overrides what follows)

These corrections supersede anything inconsistent in sections below. Source of truth: `eigencloud-platform.md` plus first-hand reading of `Layr-Labs/ecloud-inference-example` and `Layr-Labs/skill.md` on 2026-05-11.

**Inference uses a Node sidecar.** The official LLM Proxy (`@layr-labs/ai-gateway-provider`) is TypeScript-only and there is no Python equivalent. We ship a tiny Express server in `agent-sidecar/` inside the same Docker image. FastAPI calls it over loopback at `http://127.0.0.1:9090/infer`. Inside the TEE the sidecar auto-mints attested JWTs from the KMS via the SDK; locally it falls back to `KMS_AUTH_JWT`. See `agent-sidecar/server.js` and `entrypoint.sh`.

**The AI Gateway response has no per-call signature.** Older notes promised `receipt.req_hash / out_hash / sig` fields — those don't exist. The response is plain OpenAI-compatible. Verifiability comes from (a) the upstream image-digest attestation that pinned the deployed model + agent code, and (b) the agent's TEE wallet signing the *verdict* (so anyone can prove which deployed app produced an analysis result). The Verify page recovers the agent address from this signature using `canonicalDigest({...}) → ethers.verifyMessage`.

**Default model is `anthropic/claude-sonnet-4.6`.** The `gpt-oss-120b-f16` open-weight model is supported but the routed Anthropic models work better for the JSON-output prompt we use.

**Instance type is `g1-standard-2t` (Intel TDX).** Older notes said `enterprise-1` — that's stale.

**Deploy command shape:**
```bash
docker buildx build --platform linux/amd64 -t ghcr.io/<you>/heirloom:<tag> --push .
ecloud compute env set sepolia --yes
ecloud compute app configure tls
ecloud compute app deploy --name Heirloom-DMS --image-ref ghcr.io/<you>/heirloom:<tag> \
    --instance-type g1-standard-2t --env-file .env.deploy --log-visibility public \
    --verifiable --repo <git-url> --commit <sha> --verbose
```
Image must live in a public registry (GHCR / Docker Hub) — TEE pulls at deploy time. App name must contain no spaces, otherwise the verifiability dashboard shows `(unnamed)`. The wrapper script `./deploy.sh` handles all of this.

**Verifiability dashboard URL:** `https://verify-sepolia.eigencloud.xyz/app/<app-id>` (or `verify.eigencloud.xyz` on mainnet). Public runtime attestations were not yet shipped as of April 2026 — pre-empt this on stage.

---

## 1. WHAT THIS IS

Heirloom is a sovereign agent running on EigenCloud that protects crypto assets from being lost forever when the owner dies or becomes incapacitated. The user stores an encrypted copy of their wallet's seed phrase inside a TEE (hardware-sealed secure enclave). They check in periodically via a selfie-based heartbeat. If they stop checking in, the agent runs a multi-phase verification protocol, then autonomously distributes assets to pre-configured beneficiaries.

Deployed as an EigenCompute app. Presented at Eigen Labs' Private Preview Demo Day on **May 12, 2026**.

---

## 2. WHY THIS MATTERS

### The problem
- ~3.8 million Bitcoin (~20% of supply) is permanently inaccessible — lost keys, dead owners, forgotten wallets. At current prices that's $400B+.
- 2026 is the year the first generation of serious crypto holders (now in their 50s-60s) is aging into estate planning.
- Courts can grant legal ownership to heirs, but the blockchain only recognizes the private key. No key = no funds, forever.
- Famous case: James Howells threw away a hard drive with 8,000 BTC (worth $885M+). Spent years trying to excavate a landfill. Denied.

### What exists and why it's all broken
| Solution | How it works | Why it fails |
|----------|-------------|-------------|
| **Sarcophagus** | Decentralized dead man's switch on Ethereum + Arweave. "Archaeologist" nodes hold encrypted data, release on missed attestation. SARCO token incentivizes operators. | Token crashed 96% to $0.002. Zero trading volume. 1,100 holders. Node operators have no incentive to stay online. Effectively dead. |
| **Casa** | $250/year custody service. Semi-custodial. | Closed source, centralized, expensive. Trusting a company with your keys. Opposite of self-custody. |
| **Safe Haven / Inheriti** | Shamir's Secret Sharing for inheritance. | Requires their token. Minimal adoption. Platform trust required. |
| **Multisig wallets** | 2-of-3 with spouse + child + lawyer. | Requires all parties to be crypto-literate, coordinate key ceremonies, maintain opsec indefinitely. Most families can't. |
| **Deadhand Protocol** | Open-source CLI, splits seed into shards. | CLI tool, not a service. No TEE. No autonomous execution. Proof of concept only. |

### The gap Heirloom fills
No existing solution seals the recovery material in hardware-encrypted memory that even the service operator can't access, monitors liveness with a multi-phase escalation protocol, and autonomously executes distribution with a verifiable audit trail. Heirloom does all three.

---

## 3. EIGENCLOUD PLATFORM REFERENCE

Refer to `eigencloud-platform.md` as the authoritative source for all EigenCloud details. Key points for this project:

### EigenCompute
- Docker containers in Intel TDX TEEs on Google Confidential Space.
- **MNEMONIC**: BIP-39 phrase auto-injected by KMS, derived from app ID. Stable across restarts and image upgrades. Developer cannot set it.
- **Wallet**: BIP-32/BIP-44 derivation from MNEMONIC. Use `eth-account` in Python.
- `_PUBLIC` env vars go on-chain in `AppUpgraded` events.
- Dockerfile must be `linux/amd64`, run as root.
- TLS via Caddy inside TEE (`ecloud compute app configure tls`).
- Enterprise tier (Intel TDX) required for real TEE guarantees.

### EigenAI / AI Gateway
- Endpoint: `POST https://ai-gateway-dev.eigencloud.xyz/v1/chat/completions`
- Auth: `Authorization: Bearer <JWT>` (NOT a static API key)
- JWT acquisition inside TEE: use `@layr-labs/ecloud-sdk/attest` (TypeScript). No Python SDK exists.
- **Workaround for Python backend**: either (a) Node.js sidecar for JWT acquisition, (b) hardcode `KMS_AUTH_JWT` env var for local dev / get one from `#ext-private-preview`, or (c) thin TS service.
- Models: `gpt-oss-120b-f16` (open-weight, fully verifiable), `anthropic/claude-sonnet-4.6` (routed, signed receipt but weaker verifiability).
- Determinism: `seed=42` → bit-identical output on same GPU SKU. ~1.8% latency overhead.
- Response includes: `receipt.req_hash`, `receipt.out_hash`, `receipt.sig` (operator signature), `eigendalink`.
- Verification: `signer = ethers.verifyMessage(req_hash || out_hash || model_id || chain_id, "0x" + sig)` → check against KeyRegistrar.

### EigenDA
- Tamper-resistant storage with KZG commitments.
- Use for: heartbeat audit trail, execution logs, EigenAI analysis receipts.

### ecloud CLI commands
```bash
npm install -g @layr-labs/ecloud-cli
ecloud auth generate --store
ecloud billing subscribe  # use credit code EigenPreview000
ecloud compute app create --name heirloom --language typescript
ecloud compute app deploy --instance-type enterprise-1
ecloud compute app configure tls
ecloud compute app info
ecloud compute app logs --watch
ecloud compute app upgrade heirloom
```

### Trust model (be honest about in presentation)
- Alpha: developer is still trusted. Malicious image upgrade could exfiltrate sealed data.
- Trust chain: Intel TDX silicon → Google Confidential Space → Eigen Labs KMS → Lambda Inc. (AI inference) → developer key.
- Mitigation: open-source code, verifiable builds (`--verifiable --repo --commit`), monitor `AppUpgraded` events.
- `EigenVerify` slashing is roadmap, not live. Frame as "minimized, verifiable trust" not "trustless."

### Contract addresses (for verification ceremony)
- AppController Sepolia: `0x0dd810a6ffba6a9820a10d97b659f07d8d23d4E2`
- AppController Mainnet: `0xc38d35Fc995e75342A21CBd6D770305b142Fbe67`
- KeyRegistrar Sepolia: `0xA4dB30D08d8bbcA00D40600bee9F029984dB162a`

---

## 4. ARCHITECTURE

### System overview
```
┌─────────────────────────────────────────────────────────┐
│  User's Device (Desktop or Mobile PWA)                  │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Setup Flow  │  │ Heartbeat    │  │ Dashboard     │  │
│  │ (seed input │  │ (selfie      │  │ (status,      │  │
│  │  + config)  │  │  check-in)   │  │  audit trail) │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬───────┘  │
└─────────┼────────────────┼──────────────────┼───────────┘
          │ HTTPS          │ HTTPS            │ HTTPS
          ▼                ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│  Heirloom Agent (EigenCompute TEE)                      │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │ Key Vault│ │Heartbeat │ │Escalation│ │ Executor  │  │
│  │ Service  │ │ Monitor  │ │ Engine   │ │ (transfer)│  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐               │
│  │ EigenAI  │ │ Notifier │ │ Audit    │               │
│  │ Analyzer │ │ (email)  │ │ Logger   │               │
│  └──────────┘ └──────────┘ └──────────┘               │
│                                                         │
│  Encrypted SQLite DB │ TEE Wallet (MNEMONIC)            │
└─────────────────────────────────────────────────────────┘
          │                              │
          ▼                              ▼
   EigenDA (audit trail)          Ethereum / L2s
                                  (asset transfers)
```

### Approach: Stored Key (Approach 2)

The user keeps their wallet and uses it normally. They give a copy of their seed phrase to the agent for safekeeping inside the TEE. When the dead man's switch triggers, the agent uses the stored seed phrase to move the user's assets.

**Setup flow:**
1. User connects to Heirloom web app.
2. Enters their seed phrase into a client-side form. The page derives the wallet address from it to confirm it's correct.
3. Frontend encrypts the seed phrase using the agent's public key (published, verifiable on-chain).
4. Encrypted blob is sent to the agent over HTTPS (TLS inside TEE).
5. Agent decrypts inside enclave, re-encrypts with internal storage key, saves to encrypted SQLite.
6. User configures: beneficiary addresses + percentages, heartbeat interval (30/60/90 days), emergency contacts (email), supported chains to scan.
7. User takes initial selfie heartbeat to activate the plan.

**Why this approach over alternatives:**
- Full deposit (give all assets to agent) = user loses access while alive. Unacceptable.
- Token approvals (ERC-20 `approve()`) = only works for tokens, not native ETH. User must re-approve if balances change. Brittle.
- Smart contract wallet integration = best long-term answer but requires user to migrate wallets. Too complex for 2-week build.
- Pre-signed transactions = break when user makes any transaction (nonce invalidation). Impractical.
- Stored key = user keeps full use of their wallet, agent can handle any asset on any EVM chain, simplest to implement.

### Heartbeat mechanism

**Check-in flow:**
1. User opens Heirloom on their phone (PWA installed to home screen).
2. Taps "I'm here" button.
3. Front camera activates via `navigator.mediaDevices.getUserMedia()`.
4. User takes a selfie.
5. Photo is hashed client-side (SHA-256). Hash is sent to agent. Photo itself is NOT stored on the server (privacy).
6. User signs a challenge message with their wallet (wallet signature = cryptographic proof of identity).
7. Agent records: `{timestamp, selfie_hash, wallet_signature, ip_geolocation_hash}`.
8. Heartbeat clock resets.

**Why selfie + wallet signature (not just one or the other):**
- Wallet signature alone = a script could automate it. Doesn't prove a human is present.
- Selfie alone = doesn't prove the specific user is present (could be anyone).
- Both together = reasonable proof of liveness. Not bulletproof, but sufficient for the trust model.
- For Demo Day: the selfie is a UX demonstration, not a security guarantee. Production would add liveness detection SDK (passive, single-image — services like IDLive Face or Facia at 99.8% anti-spoof accuracy).

### Optional: face matching with face-api.js (build last, skip if tight on time)

**face-api.js** is a browser-side face recognition library built on TensorFlow.js. It can extract a 128-dimensional "face descriptor" from a photo and compare two descriptors to determine if they're the same person. Runs entirely client-side — no server calls, no API costs, no privacy issues from uploading face data.

**How it works in Heirloom:**
1. During setup: user takes a reference selfie. face-api.js extracts the 128-d descriptor. The descriptor (NOT the image) is sent to the agent and stored alongside the plan.
2. During heartbeat: user takes a selfie. face-api.js extracts descriptor client-side. Compares against stored reference. If Euclidean distance < 0.6 → match → "Identity confirmed ✓" shown on screen.
3. The match/no-match result is included in the heartbeat payload for the audit trail.

**Implementation:**
```tsx
// frontend/src/lib/faceMatch.ts
import * as faceapi from 'face-api.js';

// Load models once on app start (~5-10MB total download)
export async function loadFaceModels() {
  await faceapi.nets.ssdMobilenetv1.loadFromUri('/models');
  await faceapi.nets.faceLandmark68Net.loadFromUri('/models');
  await faceapi.nets.faceRecognitionNet.loadFromUri('/models');
}

// Extract face descriptor from an image element or canvas
export async function getFaceDescriptor(input: HTMLVideoElement | HTMLCanvasElement): Promise<Float32Array | null> {
  const detection = await faceapi
    .detectSingleFace(input)
    .withFaceLandmarks()
    .withFaceDescriptor();
  return detection?.descriptor ?? null;
}

// Compare two descriptors (returns true if same person)
export function isMatch(ref: Float32Array, candidate: Float32Array, threshold = 0.6): boolean {
  return faceapi.euclideanDistance(ref, candidate) < threshold;
}
```

**Face-api.js model files**: download the pre-trained model weights from the face-api.js repo and place in `frontend/public/models/`. Files needed: `ssd_mobilenetv1_model-weights_manifest.json`, `face_landmark_68_model-weights_manifest.json`, `face_recognition_model-weights_manifest.json` + their shard files.

**Tradeoffs:**
- Adds ~5-10MB to frontend download (model weights). Acceptable for a demo, heavy for production.
- Not spoofing-resistant. Someone could hold up a photo of the user. Fine for demo.
- Adds ~30-40 lines of code total. Low effort if everything else is working.
- Nice visual "wow" moment at Demo Day: judges see "Identity confirmed ✓" flash green.
- **Decision: build this LAST. Only if core flow is complete and stable.**

### Escalation protocol

Five phases, configurable durations. Default total: ~51 days from missed heartbeat to execution.

```
Phase 1: ACTIVE (heartbeat window)
  └─ User checks in within configured interval (30/60/90 days)
  └─ Each check-in resets to Phase 1

Phase 2: REMINDER (7 days)
  └─ Trigger: heartbeat interval expires without check-in
  └─ Actions: push notification to PWA daily, email to user daily
  └─ Resolution: user checks in → back to Phase 1

Phase 3: EMERGENCY_CONTACT (7 days)
  └─ Trigger: Phase 2 expires without check-in
  └─ Actions: email/SMS to all configured emergency contacts
  └─ Message: "Your family member hasn't responded to their Heirloom check-in for X days.
     If they're okay, please have them log in. If something has happened, their plan
     will execute automatically after the verification period."
  └─ Resolution: user checks in → back to Phase 1

Phase 4: VERIFICATION (7 days)
  └─ Trigger: Phase 3 expires without check-in
  └─ Actions:
     a) EigenAI wallet activity analysis (deterministic, signed receipt)
        - Fetches recent transactions from user's wallet via RPC
        - Sends to EigenAI: "Analyze on-chain activity. Is this wallet active?"
        - If wallet IS active → extend Phase 4 by another 7 days, log reason
        - If wallet is INACTIVE → proceed to Phase 5
     b) Death records check (production roadmap)
        - SSA Death Master File has 85M+ records. Requires NTIS certification.
        - For demo: mock this integration, explain in presentation.
  └─ Resolution: user checks in → back to Phase 1

Phase 5: EXECUTION
  └─ Trigger: Phase 4 expires, all verification confirms inactivity
  └─ Actions:
     a) Agent unseals seed phrase inside TEE
     b) Derives wallet private key
     c) Scans balances across configured chains (ETH, ERC-20s)
     d) Executes transfers: each beneficiary gets their configured percentage
     e) Agent co-signs each transfer receipt with its own TEE wallet
     f) Full execution log written to EigenDA
     g) Final notification to all emergency contacts: "Distribution complete."
  └─ Irreversible after this point
```

### EigenAI integration (wallet activity analysis)

```python
ACTIVITY_ANALYSIS_PROMPT = """Analyze the following on-chain transaction history for wallet {address}.

Recent transactions (last 90 days):
{transaction_list}

Current balances:
{balance_summary}

Last heartbeat check-in: {last_heartbeat_date}

Determine:
1. Is this wallet showing signs of active usage since the last heartbeat?
2. What is the most recent transaction date?
3. Confidence level that the wallet owner is still active (HIGH/MEDIUM/LOW/NONE)

Respond ONLY with valid JSON:
{{
  "active_since_heartbeat": <boolean>,
  "last_transaction_date": "<ISO date or null>",
  "transaction_count_since_heartbeat": <int>,
  "confidence_owner_active": "<HIGH|MEDIUM|LOW|NONE>",
  "reasoning": "<brief explanation>"
}}"""
```

The response's `receipt.sig` is stored as verifiable proof. Anyone can replay the exact same prompt with the same seed and get the identical output + signature.

### Notification system

For Demo Day, use simple HTTP webhooks:
- **Email**: SendGrid API or Resend API (both have free tiers, simple REST calls)
- **Push notifications**: Web Push API via VAPID protocol. The PWA's service worker receives pushes even when app is closed.
- **SMS**: Twilio API (optional, email is sufficient for demo)

Store notification config in the user's plan:
```json
{
  "user_email": "user@example.com",
  "emergency_contacts": [
    {"name": "Jane Doe", "email": "jane@example.com", "relationship": "spouse"},
    {"name": "Bob Smith", "email": "bob@example.com", "relationship": "attorney"}
  ]
}
```

---

## 5. TECH STACK

```
EigenCompute TEE Container:
├── Python 3.11+ (FastAPI)
│   ├── uvicorn (ASGI server)
│   ├── web3.py (Ethereum interaction, wallet derivation, balance checks, transfers)
│   ├── eth-account (seed phrase → private key → signing)
│   ├── httpx (HTTP client for EigenAI gateway, notification webhooks, RPC calls)
│   ├── pydantic (data validation)
│   ├── apscheduler (background job scheduler for heartbeat monitoring)
│   ├── cryptography (encryption/decryption of stored seed phrases)
│   └── aiosqlite (async encrypted SQLite)
├── Node.js sidecar (OPTIONAL — only if JWT attestation needed inside TEE)
│   └── @layr-labs/ecloud-sdk (TEE attestation → JWT for EigenAI)
└── Caddy (TLS termination inside TEE)

Frontend (single React app, responsive for desktop + mobile PWA):
├── React 18+ / TypeScript / Vite
├── Tailwind CSS
├── ethers.js (wallet connection, message signing for heartbeat)
├── shadcn/ui (component library)
├── vite-plugin-pwa (PWA manifest, service worker, push notifications)
├── face-api.js (OPTIONAL — client-side face matching, build last)
└── Built static files served by FastAPI (single container deployment)

Director Dashboard:
└── Same React app, separate /director route protected by secret key
    No separate deployment — just a page within the frontend
```

### Why single container (frontend bundled with backend):
- One deploy, one domain, no CORS issues, no DNS complexity.
- FastAPI serves the React build at `/` and API routes at `/api/`.
- Simpler for Demo Day. Production would separate them.

### Why PWA (not React Native):
- Same React codebase for desktop and mobile.
- Camera access works via getUserMedia() on all modern browsers.
- Push notifications work on iOS 16.4+ and all Android.
- No app store review, no Xcode certificates, no TestFlight.
- Installable to home screen — looks/feels like a native app.
- Buildable in days, not weeks.

---

## 6. PROJECT STRUCTURE

```
heirloom/
├── CLAUDE.md                       # This file
├── eigencloud-platform.md          # EigenCloud reference (copy from B³)
├── agent/
│   ├── app/
│   │   ├── main.py                 # FastAPI app, static file serving, CORS
│   │   ├── config.py               # Environment variables, constants
│   │   ├── models.py               # Pydantic models (Plan, Heartbeat, Attestation, etc.)
│   │   ├── db.py                   # SQLite setup, queries
│   │   ├── routes/
│   │   │   ├── plans.py            # CRUD for inheritance plans
│   │   │   ├── heartbeat.py        # Check-in endpoint (receives selfie hash + wallet sig)
│   │   │   ├── status.py           # Public status, audit trail, verification
│   │   │   ├── director.py         # Director dashboard API (demo control panel)
│   │   │   └── admin.py            # Plan management (cancel, modify beneficiaries)
│   │   ├── services/
│   │   │   ├── key_vault.py        # Encrypt/decrypt/store seed phrases
│   │   │   ├── heartbeat_monitor.py # Background scheduler checking phase transitions
│   │   │   ├── escalation.py       # Phase transition logic (ACTIVE→REMINDER→...→EXECUTION)
│   │   │   ├── executor.py         # Wallet derivation, balance scanning, asset transfers
│   │   │   ├── activity_analyzer.py # EigenAI wallet activity analysis
│   │   │   ├── notifier.py         # Email/push notification dispatch
│   │   │   ├── signer.py           # TEE wallet signing for audit receipts
│   │   │   └── audit.py            # EigenDA audit trail writing
│   │   └── utils/
│   │       ├── crypto.py           # AES encryption helpers
│   │       └── chain.py            # Multi-chain RPC config, balance fetching
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── .env.example
│   └── foundry.toml                # Not needed for Heirloom (no exploit verification)
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Landing.tsx         # Marketing / explanation page
│   │   │   ├── Setup.tsx           # Seed phrase input, beneficiary config, heartbeat interval
│   │   │   ├── Dashboard.tsx       # Status overview, phase indicator, countdown timer
│   │   │   ├── Heartbeat.tsx       # Selfie camera + wallet signature (mobile-optimized)
│   │   │   ├── Director.tsx        # Director dashboard (demo control panel, secret URL)
│   │   │   ├── AuditTrail.tsx      # Full heartbeat history, EigenAI receipts
│   │   │   └── Verify.tsx          # Verification ceremony (on-chain proof)
│   │   ├── components/
│   │   │   ├── CameraCapture.tsx   # getUserMedia selfie component
│   │   │   ├── FaceMatch.tsx       # OPTIONAL: face-api.js matching (build last)
│   │   │   ├── PhaseIndicator.tsx  # Visual escalation phase display
│   │   │   ├── CountdownTimer.tsx  # Live countdown to next phase
│   │   │   ├── BeneficiaryList.tsx # Beneficiary config UI
│   │   │   └── VerifyButton.tsx    # On-chain verification ceremony
│   │   ├── lib/
│   │   │   ├── api.ts              # API client
│   │   │   ├── crypto.ts           # Client-side encryption (seed phrase → agent pubkey)
│   │   │   ├── verify.ts           # ethers.verifyMessage for audit verification
│   │   │   └── faceMatch.ts        # OPTIONAL: face-api.js descriptor extraction + comparison
│   │   └── sw.ts                   # Service worker for push notifications
│   ├── public/
│   │   ├── manifest.json           # PWA manifest (name, icons, theme, display: standalone)
│   │   └── models/                 # OPTIONAL: face-api.js model weight files
│   ├── package.json
│   ├── vite.config.ts              # vite-plugin-pwa config
│   └── tailwind.config.ts
├── docs/
│   ├── architecture.md             # Deliverable: architecture diagram + explanation
│   └── product-feedback.md         # Deliverable: Eigen Labs feedback doc
└── README.md                       # Deliverable: project overview
```

---

## 7. KEY IMPLEMENTATION DETAILS

### Seed phrase encryption (client-side)

```typescript
// frontend/src/lib/crypto.ts
// Encrypt seed phrase in browser before sending to agent
async function encryptSeedPhrase(seedPhrase: string, agentPublicKey: string): Promise<string> {
  // Use ECIES (Elliptic Curve Integrated Encryption Scheme)
  // or simpler: generate ephemeral AES key, encrypt seed with AES,
  // encrypt AES key with agent's public key, send both
  const aesKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(seedPhrase);

  const cryptoKey = await crypto.subtle.importKey('raw', aesKey, 'AES-GCM', false, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoded);

  // In production: encrypt aesKey with agent's RSA/EC public key
  // For demo: send aesKey encrypted via TLS (HTTPS) — the TLS terminates inside the TEE
  return JSON.stringify({
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    iv: btoa(String.fromCharCode(...iv)),
    key: btoa(String.fromCharCode(...aesKey)),  // safe because TLS terminates inside TEE
  });
}
```

For Demo Day: the HTTPS channel is encrypted end-to-end into the TEE (TLS terminates inside the enclave). Sending the key over this channel is safe. Production would use proper ECIES with the agent's attested public key.

### Seed phrase storage (agent-side)

```python
# agent/app/services/key_vault.py
from cryptography.fernet import Fernet
from eth_account import Account
import os, json

class KeyVault:
    def __init__(self):
        # Derive storage encryption key from TEE mnemonic
        # This key is only available inside the TEE
        mnemonic = os.environ["MNEMONIC"]
        account = Account.from_mnemonic(mnemonic)
        # Use wallet private key as seed for Fernet key derivation
        import hashlib, base64
        raw = hashlib.sha256(account.key.hex().encode()).digest()
        self.fernet = Fernet(base64.urlsafe_b64encode(raw))

    def store(self, plan_id: str, seed_phrase: str) -> None:
        encrypted = self.fernet.encrypt(seed_phrase.encode())
        # Save to SQLite: plan_id → encrypted blob
        db.store_key(plan_id, encrypted)

    def retrieve(self, plan_id: str) -> str:
        encrypted = db.get_key(plan_id)
        return self.fernet.decrypt(encrypted).decode()

    def derive_wallet(self, plan_id: str):
        seed = self.retrieve(plan_id)
        return Account.from_mnemonic(seed)
```

### Heartbeat check-in endpoint

```python
# agent/app/routes/heartbeat.py
from fastapi import APIRouter, HTTPException
from eth_account.messages import encode_defunct
from eth_account import Account

router = APIRouter()

@router.post("/api/heartbeat/{plan_id}")
async def check_in(plan_id: str, body: HeartbeatRequest):
    plan = db.get_plan(plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")

    # Verify wallet signature (proves the actual wallet owner is checking in)
    challenge = f"Heirloom heartbeat {plan_id} {body.timestamp}"
    message = encode_defunct(text=challenge)
    recovered = Account.recover_message(message, signature=body.wallet_signature)
    if recovered.lower() != plan.wallet_address.lower():
        raise HTTPException(403, "Invalid wallet signature")

    # Record heartbeat
    db.record_heartbeat(plan_id, {
        "timestamp": body.timestamp,
        "selfie_hash": body.selfie_hash,  # SHA-256 of selfie image, computed client-side
        "wallet_signature": body.wallet_signature,
        "phase_before": plan.current_phase,
    })

    # Reset to ACTIVE phase
    db.update_plan_phase(plan_id, "ACTIVE")
    db.reset_heartbeat_timer(plan_id)

    return {"status": "ok", "next_heartbeat_due": plan.next_due_timestamp()}
```

### Background heartbeat monitor

```python
# agent/app/services/heartbeat_monitor.py
from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler()

@scheduler.scheduled_job('interval', minutes=1)  # check every minute
async def check_all_plans():
    plans = db.get_all_active_plans()
    for plan in plans:
        if plan.is_phase_expired():
            await escalation.advance_phase(plan)

# In escalation.py:
async def advance_phase(plan):
    transitions = {
        "ACTIVE": "REMINDER",
        "REMINDER": "EMERGENCY_CONTACT",
        "EMERGENCY_CONTACT": "VERIFICATION",
        "VERIFICATION": "EXECUTION",
    }
    new_phase = transitions[plan.current_phase]

    if new_phase == "REMINDER":
        await notifier.send_user_reminder(plan)
    elif new_phase == "EMERGENCY_CONTACT":
        await notifier.notify_emergency_contacts(plan)
    elif new_phase == "VERIFICATION":
        analysis = await activity_analyzer.analyze(plan)
        if analysis["confidence_owner_active"] in ("HIGH", "MEDIUM"):
            # Wallet is active — extend grace period
            db.extend_phase(plan.id, days=7)
            db.log_event(plan.id, "EXTENSION", analysis)
            return  # don't advance
    elif new_phase == "EXECUTION":
        await executor.execute_distribution(plan)

    db.update_plan_phase(plan.id, new_phase)
```

### Asset distribution executor

```python
# agent/app/services/executor.py
from web3 import Web3
from eth_account import Account

CHAIN_RPCS = {
    1: "https://eth.llamarpc.com",           # Ethereum mainnet
    8453: "https://mainnet.base.org",         # Base
    137: "https://polygon-rpc.com",           # Polygon
    11155111: "https://rpc.sepolia.org",       # Sepolia (testnet)
    84532: "https://sepolia.base.org",         # Base Sepolia (testnet)
}

async def execute_distribution(plan):
    account = key_vault.derive_wallet(plan.id)
    execution_log = []

    for chain_id in plan.configured_chains:
        w3 = Web3(Web3.HTTPProvider(CHAIN_RPCS[chain_id]))
        balance = w3.eth.get_balance(account.address)

        if balance > 0:
            for beneficiary in plan.beneficiaries:
                amount = int(balance * beneficiary.percentage / 100)
                # Reserve gas
                gas_cost = w3.eth.gas_price * 21000
                if amount <= gas_cost:
                    continue

                tx = {
                    'to': beneficiary.address,
                    'value': amount - gas_cost,
                    'gas': 21000,
                    'gasPrice': w3.eth.gas_price,
                    'nonce': w3.eth.get_transaction_count(account.address),
                    'chainId': chain_id,
                }
                signed = account.sign_transaction(tx)
                tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
                execution_log.append({
                    "chain": chain_id,
                    "beneficiary": beneficiary.address,
                    "amount_wei": amount - gas_cost,
                    "tx_hash": tx_hash.hex(),
                })

        # Also scan and transfer ERC-20 tokens
        # Use a token list or scan known tokens for balances
        # Transfer via token.transfer() calls

    # Sign execution log with TEE wallet
    agent_receipt = signer.sign_execution_log(execution_log)

    # Write to EigenDA for permanent audit trail
    await audit.write_to_eigenda(agent_receipt)

    # Notify emergency contacts
    await notifier.notify_execution_complete(plan, execution_log)

    db.update_plan_phase(plan.id, "COMPLETED")
```

### Camera capture component (PWA)

```tsx
// frontend/src/components/CameraCapture.tsx
import { useRef, useState } from 'react';

export function CameraCapture({ onCapture }: { onCapture: (hash: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  async function startCamera() {
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 640, height: 480 }
    });
    if (videoRef.current) videoRef.current.srcObject = mediaStream;
    setStream(mediaStream);
  }

  async function captureAndHash() {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    canvas.getContext('2d')?.drawImage(videoRef.current!, 0, 0);
    const blob = await new Promise<Blob>(r => canvas.toBlob(b => r(b!), 'image/jpeg', 0.7));
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    stream?.getTracks().forEach(t => t.stop());
    onCapture(hash);
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <video ref={videoRef} autoPlay playsInline className="rounded-xl w-full max-w-sm" />
      {!stream ? (
        <button onClick={startCamera} className="btn-primary">Open Camera</button>
      ) : (
        <button onClick={captureAndHash} className="btn-primary">Take Selfie</button>
      )}
    </div>
  );
}
```

### PWA manifest

```json
{
  "name": "Heirloom",
  "short_name": "Heirloom",
  "description": "Crypto inheritance protection",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

---

## 8. DIRECTOR DASHBOARD (DEMO DAY CONTROL PANEL)

Instead of relying on timers during the live pitch, the presenter (Sanjith) gets a separate **Director Dashboard** — an admin panel that lets him orchestrate every step of the demo on button clicks. This eliminates the risk of awkward waiting, timer bugs, or phases advancing at the wrong moment during the presentation.

### Director dashboard page (`/director`)

Protected by a secret key in the URL (`/director?key=DEMO_SECRET_KEY`). Not linked from the main app. Only the presenter knows the URL.

**Controls available:**
| Button | What it does | API call |
|--------|-------------|----------|
| "Request Heartbeat" | Sends a push notification to the user's PWA asking them to check in | `POST /api/director/request-heartbeat` |
| "Advance Phase" | Force-transitions the plan to the next escalation phase | `POST /api/director/advance-phase` |
| "Send Reminder Email" | Triggers a reminder email to the user right now | `POST /api/director/send-reminder` |
| "Notify Emergency Contacts" | Sends the emergency contact emails right now | `POST /api/director/notify-contacts` |
| "Run EigenAI Analysis" | Triggers wallet activity analysis and displays the signed result | `POST /api/director/run-analysis` |
| "Execute Distribution" | Triggers the final asset distribution immediately | `POST /api/director/execute` |
| "Reset to Active" | Resets everything back to Phase 1 (for re-running the demo) | `POST /api/director/reset` |

**Director dashboard UI:**
- Shows current phase with a big visual indicator (green/yellow/orange/red/black)
- Live event log at the bottom showing everything that's happened
- Plan summary: wallet address, beneficiaries, balances
- Each button has a confirmation dialog to prevent accidental clicks

### Director API routes

```python
# agent/app/routes/director.py
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api/director")

DIRECTOR_KEY = os.environ.get("DIRECTOR_KEY", "demo-secret-2026")

def verify_director(key: str = Query(...)):
    if key != DIRECTOR_KEY:
        raise HTTPException(403, "Invalid director key")

@router.post("/advance-phase")
async def advance_phase(key: str = Query(...)):
    verify_director(key)
    plan = db.get_active_plan()  # single plan for demo
    await escalation.advance_phase(plan)
    return {"new_phase": plan.current_phase}

@router.post("/request-heartbeat")
async def request_heartbeat(key: str = Query(...)):
    verify_director(key)
    plan = db.get_active_plan()
    await notifier.send_push_notification(plan, "Time to check in! Open Heirloom and take your selfie.")
    return {"status": "push sent"}

@router.post("/send-reminder")
async def send_reminder(key: str = Query(...)):
    verify_director(key)
    plan = db.get_active_plan()
    await notifier.send_user_reminder(plan)
    return {"status": "reminder email sent"}

@router.post("/notify-contacts")
async def notify_contacts(key: str = Query(...)):
    verify_director(key)
    plan = db.get_active_plan()
    await notifier.notify_emergency_contacts(plan)
    return {"status": "emergency contacts notified"}

@router.post("/run-analysis")
async def run_analysis(key: str = Query(...)):
    verify_director(key)
    plan = db.get_active_plan()
    result = await activity_analyzer.analyze(plan)
    return {"analysis": result}

@router.post("/execute")
async def execute(key: str = Query(...)):
    verify_director(key)
    plan = db.get_active_plan()
    result = await executor.execute_distribution(plan)
    return {"execution": result}

@router.post("/reset")
async def reset(key: str = Query(...)):
    verify_director(key)
    plan = db.get_active_plan()
    db.update_plan_phase(plan.id, "ACTIVE")
    db.reset_heartbeat_timer(plan.id)
    return {"status": "reset to ACTIVE"}
```

### How the demo flows with the Director Dashboard

The presenter has **two devices**: laptop showing the Director Dashboard + the main dashboard on a projector, and phone showing the PWA heartbeat page.

1. **Show setup**: walk through the plan config on screen (already pre-configured)
2. **Show a heartbeat**: pick up phone, open Heirloom PWA, take selfie, sign with wallet → dashboard updates to "ACTIVE"
3. **Narrate**: "Now imagine I don't check in. In production, the system waits 30-90 days. Let me show you what happens."
4. **Click "Advance Phase"** on Director Dashboard → phase moves to REMINDER → show the reminder email arrive
5. **Click "Advance Phase"** → EMERGENCY_CONTACT → show the emergency contact email arrive on screen
6. **Click "Run EigenAI Analysis"** → show the signed, deterministic wallet activity report
7. **Click "Execute Distribution"** → show the funds transfer live → pull up block explorer → money moved
8. **Click "Verify"** on the main dashboard → verification ceremony with on-chain proof

Total time: ~3 minutes, completely controlled, zero risk of timer issues.

### Background monitor still exists (for production mode)
The APScheduler heartbeat monitor still runs in the background for real usage. The Director Dashboard just provides manual overrides for the demo. Set `DEMO_MODE=true` in .env to disable automatic phase transitions so only the Director controls the flow during the presentation.

---

## 9. BUILD ORDER

### Phase 1: Core agent (days 1-3)
1. FastAPI scaffold with health endpoint, config, models
2. SQLite database setup (plans, heartbeats, events tables)
3. Key vault service (encrypt/decrypt seed phrases using TEE MNEMONIC)
4. TEE wallet signer (sign audit receipts with agent wallet)
5. Basic plan CRUD endpoints (`POST /api/plans`, `GET /api/plans/{id}`)
6. Heartbeat endpoint with wallet signature verification

### Phase 2: Escalation engine (days 4-6)
1. APScheduler background monitor (check all plans every minute)
2. Phase transition logic (ACTIVE → REMINDER → EMERGENCY → VERIFICATION → EXECUTION)
3. Notification service (email via SendGrid/Resend for reminders + emergency contacts)
4. Demo mode with compressed timers

### Phase 3: Execution + EigenAI (days 7-9)
1. Wallet derivation from stored seed phrase
2. Multi-chain balance scanning (ETH + ERC-20s on configured chains)
3. Asset transfer execution with transaction receipts
4. EigenAI wallet activity analysis during verification phase
5. Audit trail logging (local DB + EigenDA if time permits)

### Phase 4: Frontend + Director Dashboard (days 10-13)
1. Landing page (what Heirloom is, why it matters)
2. Setup flow (seed phrase input with client-side encryption, beneficiary config)
3. Dashboard with phase indicator + countdown timer
4. **Heartbeat page** (camera capture + wallet signature — mobile-optimized)
5. **Director Dashboard** (`/director?key=SECRET`) — all control buttons, event log, phase display
6. Audit trail viewer
7. Verification ceremony page
8. PWA manifest + service worker for push notifications

### Phase 5: Polish + deliverables (days 14-16)
1. OPTIONAL: face-api.js face matching (add to heartbeat page, ~30 min if models downloaded)
2. Deploy to EigenCompute with custom domain + TLS
3. End-to-end test of full lifecycle on Base Sepolia using Director Dashboard
4. Architecture diagram for writeup deliverable
5. README
6. Video demo recording
7. Product feedback doc

---

## 10. WHAT NOT TO BUILD

- Don't build native mobile apps (iOS/Android). PWA covers both.
- Don't integrate a real liveness detection SDK. Simple selfie + wallet sig is sufficient for demo. face-api.js face matching is optional polish — build last if time permits.
- Don't implement SSA Death Master File integration. Mock it, explain in presentation.
- Don't build smart contract wallet integration. Mention as roadmap.
- Don't support non-EVM chains (Bitcoin, Solana). EVM only for v1.
- Don't build a token or any tokenomics. This is a service, not a protocol.
- Don't attempt to implement EigenDA writes unless the core flow works first. It's a nice-to-have.
- Don't build complex token scanning. Support ETH + a hardcoded list of major ERC-20s (USDC, USDT, WETH, DAI).
- Don't over-engineer the encryption. TLS into the TEE is sufficient for demo. Note ECIES as production upgrade.
- Don't build automatic phase transitions for Demo Day. Use the Director Dashboard for manual control. Keep APScheduler in code for production mode but disable with `DEMO_MODE=true`.

---

## 11. SUCCESS CRITERIA

The demo wins if:
1. A seed phrase enters the TEE and demonstrably cannot be extracted
2. The selfie heartbeat check-in works on a phone in the judges' hands
3. The Director Dashboard lets the presenter control every phase transition on button clicks
4. Each escalation phase produces a visible effect (email arrives, EigenAI analysis appears)
5. Assets actually transfer on-chain to beneficiary addresses when the presenter clicks Execute
6. The verification page shows cryptographic proof: agent identity, heartbeat history, signed analysis
7. The entire demo is presenter-controlled — no waiting, no timer anxiety, no dead air
8. At least one judge thinks "I need this"
