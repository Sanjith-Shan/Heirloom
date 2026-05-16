# EigenCloud platform reference

**Status:** authoritative as of 2026-05-04. Supersedes anything in CLAUDE.md that conflicts.
**Use this doc** as the source of truth on Eigen Labs / EigenCloud / EigenAI / EigenCompute / EigenLayer when making implementation decisions.

---

## TL;DR — what we got wrong before

| Old assumption                          | Reality                                                                 |
|-----------------------------------------|-------------------------------------------------------------------------|
| Inference URL `eigenai.eigencloud.xyz/v1` | **Dead path.** Use AI Gateway: `ai-gateway-dev.eigencloud.xyz/v1/chat/completions` |
| Auth via `x-api-key`                    | **Bearer JWT**, JWT issued by attestation against KMS                   |
| Model `qwen3-32b-128k-bf16`             | Launch model is **`gpt-oss-120b-f16`**; closed models routed as `provider/slug` (e.g. `anthropic/claude-sonnet-4.6`) |
| Inference is "Vercel AI Gateway"        | Only the **SDK shape** is Vercel; underlying infra is **Lambda, Inc.** hosted by Eigen Labs |
| `_PUBLIC` envs are "visible to clients" | They're **on-chain** in `AppUpgraded` events (publicEnvVars cleartext)  |
| Trust model: TDX + GCP + KMS + dev key  | Add **Lambda Inc.** (EigenAI host) and **Google Confidential Space** to that list |
| EigenAI / EigenCompute slashable today  | **Not in alpha.** Slashing-backed AVS (`EigenVerify`) is roadmap, not live |

---

## 1. Product map

```
EigenLayer (parent protocol)
├── Restaking, AVSs, slashing primitives
├── Core contracts: DelegationManager, AllocationManager, KeyRegistrar, ReleaseManager…
└── Compute AVS scaffold registered today, slashing not enforced in alpha

EigenCloud (umbrella product, ecloud CLI)
├── EigenCompute  → TEE app hosting (Intel TDX inside GCP Confidential Space)
├── EigenAI       → verifiable inference via AI Gateway
├── EigenDA       → data availability (out of scope for B³)
└── ecloud CLI    → unified developer surface
```

---

## 2. EigenAI / AI Gateway

### Endpoint
- `POST https://ai-gateway-dev.eigencloud.xyz/v1/chat/completions` — OpenAI-compatible.
- Auth header: `Authorization: Bearer <JWT>`.
- Request body honours OpenAI shape; pass `seed` for determinism.

### Authentication
- JWT is **per-app**, issued by KMS after **TEE attestation**. There is no static API key in this preview.
- Inside the TEE: official TS SDK (`@layr-labs/ecloud-sdk/attest`) handles the flow automatically. It:
  1. Generates an in-process RSA-4096 keypair.
  2. POSTs `{challenge: SHA256("COMPUTE_APP_JWT_REQUEST_RSA_KEY_V1" || 0x00 || pubkey_pem)}` to local TEE socket `/run/container_launcher/teeserver.sock`, path `/v1/bound_evidence`.
  3. POSTs the resulting attestation bytes + RSA pubkey + audience `llm-proxy` to `${KMS_SERVER_URL}/auth/attest`.
  4. Verifies the response with ECDSA-SHA256 over `("COMPUTE_APP_KMS_SIGNATURE_V1" || 0x00 || JSON(data))` against `kmsPublicKey`.
  5. JWE-decrypts `data.encryptedToken` (RSA-OAEP-SHA256) → bearer JWT.
- A pre-deposited token also exists at `/run/container_launcher/attestation_verifier_claims_token` (`JWT_FILE_PATH` constant).
- **Outside the TEE** (local dev): supply `KMS_AUTH_JWT=<jwt>` directly. Eigen Labs issues these on request via `#ext-private-preview`.
- **No Python SDK.** A Python port of the ~50-line attest flow is feasible (cryptography + jwcrypto), but for time we either (a) Node sidecar, (b) hardcode `KMS_AUTH_JWT`, or (c) call the AI Gateway from a thin TS service.

### Models
- `gpt-oss-120b-f16` — open-weight, **fully verifiable** under EigenAI's whitepaper guarantees (deterministic re-execution by EigenVerify operators when that ships).
- `anthropic/claude-sonnet-4.6` — closed-weight; routed through gateway, signed receipt still produced, but **trust reduces** to "trust the gateway operator + Anthropic." Determinism not guaranteed.
- The provider also exposes `image` and `video` model factories — multimodal models exist but undocumented.
- **No public catalog.** Ask in `#ext-private-preview` if you need a specific model.

### Determinism
- `seed=42` (or any fixed seed) produces **bit-identical output** under fixed GPU SKU. Whitepaper §6.7 measured 100% bitwise identical across hosts on the same GPU SKU.
- Cross-architecture (e.g. A100 ↔ H100) does **not** match. Single-arch policy is enforced server-side.
- ~1.8% latency overhead vs non-deterministic.

### Per-response signature (verifiability)
Per the EigenAI whitepaper (Algorithm 1, Tables 3 & 6):

```
receipt    = ⟨ H(req), H(out), model_id, chainid, da_pointer ⟩
σ_operator = Sign_{sk_op}(receipt)            // secp256k1, personal_sign-style
```

Response metadata fields returned by the gateway:
- `system_fingerprint` — container digest + GPU arch + driver version
- `determinism.seed`
- `receipt.req_hash` (SHA256 of request)
- `receipt.out_hash` (SHA256 of model output)
- `receipt.sig` — operator's signature over the receipt tuple
- `eigendalink` — pointer to EigenDA inclusion proof

### Verification
The signed message is the **concatenation of four fields with no separators** (per `verify-signature` doc):
```
message = req_hash || out_hash || model_id || chain_id    // (paraphrased; verify byte-order in browser before demo)
signer  = ethers.verifyMessage(message, "0x" + signature)
```
Cross-check `signer` against the operator's registered key in **`KeyRegistrar`**:
- Sepolia: `0xA4dB30D08d8bbcA00D40600bee9F029984dB162a`
- Mainnet: `0x54f4bC6bDEbe479173a2bbDc31dD7178408A57A4`

⚠ The exact byte concatenation order **must** be confirmed in a browser against the live verify-signature doc before demo day — the doc page 403s scrapers, paraphrases of the spec are not authoritative.

---

## 3. EigenCompute

### TEE substrate
- Intel TDX inside Google Confidential Space (Enterprise tier).
- vTPM and AMD SEV-SNP tiers exist (Starter / Pro) but **don't give hardware-encrypted memory** — for any TEE trust claim, use Enterprise tier.

### App identity & wallet
- **App ID**: `keccak256(owner_address || salt)` via `AppController.calculateAppId`. Stable forever.
- **MNEMONIC**: BIP-39 phrase derived deterministically by KMS from app ID. Stable across image upgrades and restarts.
- **Wallet**: standard BIP-32/BIP-44 derivation from MNEMONIC. Stable.
- **MNEMONIC env var is auto-injected** — KMS strips any user-supplied `MNEMONIC=` from `.env` and re-injects its own.

### Image upgrades
- Upgrading the image keeps: app ID, wallet, instance IP.
- Changes: image digest, sealed env vars, public env vars (per upgrade).
- ⚠ **Threat**: a malicious developer or compromised KMS can ship a v2 image that exfiltrates the same wallet. For B³, mitigation is to pin verifiable build digests and have verifiers monitor `AppUpgraded` events for the app's `appId`.

### `_PUBLIC` env vars
- Keys ending in `_PUBLIC` go in cleartext into the on-chain `AppUpgraded` event (`publicEnvVars` field).
- Everything else is KMS-sealed and recorded in `encryptedEnvVars`.
- "On-chain" here = `AppController` contract on Sepolia / Mainnet (see addresses below).

### App registry contract — `AppController`
- Sepolia: `0x0dd810a6ffba6a9820a10d97b659f07d8d23d4E2`
- Mainnet alpha: `0xc38d35Fc995e75342A21CBd6D770305b142Fbe67`
- Events to watch: `AppCreated`, `AppUpgraded` (carries `appId`, `imageDigest`, `registryURL`, `upgradeTime`, `publicEnvVars`, `encryptedEnvVars`).
- The wallet address itself is **not** an on-chain field — it must be observed via transactions the app signs, OR via the `verify.eigencloud.xyz` dashboard (which derives it).

### Networking from inside the TEE
| Direction | Reachable                                                              |
|-----------|------------------------------------------------------------------------|
| Outbound HTTPS | Open. RPCs, AI Gateway, Stripe, etc.                              |
| KMS       | Private GCP IP (`http://10.128.0.2:8080` mainnet, `10.128.15.203:8080` sepolia, `10.128.0.57:8080` sepolia-dev) |
| TEE socket| `/run/container_launcher/teeserver.sock` (attestation quotes)         |
| Persistent disk | Mounted at `/mnt/disks/userdata`; env var `USER_PERSISTENT_DATA_PATH` |
| JWT pre-drop | `/run/container_launcher/attestation_verifier_claims_token`        |
| Inbound   | Only the port set by `EXPOSE` in your Dockerfile, fronted by Caddy in TLS mode |

### Container constraints (non-negotiable)
- `FROM --platform=linux/amd64 ...`
- `USER root`
- `EXPOSE <your-port>` — bind to `0.0.0.0`
- TLS terminates inside the TEE via Caddy (`tls-keygen` + `kms-client` binaries are auto-layered by the platform).

### Pricing (live)
| Tier         | Specs           | Hardware    | $/hr   | $/mo    |
|--------------|-----------------|-------------|--------|---------|
| Starter 1    | 2 vCPU / 1 GB   | vTPM        | 0.03   | 19.99   |
| Pro 1        | 2 vCPU / 4 GB   | AMD SEV-SNP | 0.07   | 53.99   |
| Enterprise 1 | 4 vCPU / 16 GB  | Intel TDX   | 0.33   | 239.99  |
| Enterprise 2 | 8 vCPU / 32 GB  | Intel TDX   | 0.66   | 484.99  |

Mainnet alpha is at testnet pricing through 04/30/2026 (per `billing.md`).

---

## 4. EigenLayer (parent protocol)

### Slashing & verifiability — current state
- Neither EigenAI nor EigenCompute slashes operators in alpha. Trust is: **TDX hardware + Google Confidential Space + Eigen Labs KMS + developer key + Lambda, Inc.** (for AI inference).
- `EigenVerify` (whitepaper) is the planned slashable AVS for inference verification: stake-weighted committees re-execute prompts, vote on byte-equality, slash deviating operators. Roadmap, not live.
- `ComputeAVSRegistrar_Proxy` is deployed today as a scaffold but doesn't enforce slashing yet.

### Useful core contract addresses (mainnet / sepolia)
| Contract              | Mainnet                                          | Sepolia                                          |
|-----------------------|--------------------------------------------------|--------------------------------------------------|
| KeyRegistrar          | `0x54f4bC6bDEbe479173a2bbDc31dD7178408A57A4`     | `0xA4dB30D08d8bbcA00D40600bee9F029984dB162a`     |
| AppController         | `0xc38d35Fc995e75342A21CBd6D770305b142Fbe67`     | `0x0dd810a6ffba6a9820a10d97b659f07d8d23d4E2`     |
| DelegationManager     | `0x39053D51B77DC0d36036Fc1fCc8Cb819df8Ef37A`     | `0xD4A7E1Bd8015057293f0D0A557088c286942e84b`     |
| AllocationManager     | `0x948a420b8CC1d6BFd0B6087C2E7c344a2CD0bc39`     | `0x42583067658071247ec8CE0A516A58f682002d07`     |
| PermissionController  | `0x25E5F8B1E7aDf44518d35D5B2271f114e081f0E5`     | `0x44632dfBdCb6D3E21EF613B0ca8A6A0c618F5a37`     |
| ReleaseManager        | `0xeDA3CAd031c0cf367cF3f517Ee0DC98F9bA80C8F`     | `0x59c8D715DCa616e032B744a753C017c9f3E16bf4`     |
| ComputeAVSRegistrar   | `0xaFE783e9BcEC2993898E70906434d5bC8de3357b`     | `0x7059b1f3eC95375c316e05D261431B6B59CaB1Dc`     |

Source: `Layr-Labs/eigenx-contracts/script/deploys/{mainnet-alpha,sepolia-prod}/deployment.json`.

---

## 5. ecloud CLI — what we missed

CLI v0.5.0. Hidden / less-documented surface that's relevant to us:

- **`ecloud compute app deploy`** flags worth knowing:
  - `--env KEY=VALUE` (repeatable), `--env-file <path>` — inline env override at deploy time
  - `--verifiable`, `--repo`, `--commit`, `--build-dependencies sha256:...` — **SLSA verifiable build** path
  - `--build-caddyfile` — opt out of the auto Caddyfile injection
  - `--log-visibility {public,private,off}`
  - `--instance-type` — pin tier (Starter/Pro/Enterprise)
  - `--billTo {developer,app}`
  - `--force`, `--skip-profile`
- **`ecloud compute build {submit,list,logs,status,info,verify}`** — full SLSA verifiable-build via Google Cloud Build. `verify` accepts build ID, `sha256:...` digest, or commit SHA.
- **`ecloud compute app profile set`** — sets metadata (website, description, x-url, icon) for the verifiability dashboard.
- **`ecloud compute app configure tls`** — separate from deploy.
- **`ecloud auth migrate`** — migrate from older `eigenx-cli` keyring.
- **`ecloud telemetry disable`** — opt out of PostHog telemetry.
- **`ecloud compute undelegate`** — undelegate stake from operators.
- **Platform pinning**: `DOCKER_PLATFORM = "linux/amd64"` is hardcoded. Don't try arm64.

---

## 6. Demo-day & private preview specifics

- **Credit code `EigenPreview000`**: $500. Applies via Stripe promotion code at `ecloud billing subscribe`. Covers compute + inference. There is allegedly another $1000 layer for the preview but it's not in any public source — confirm with Eigen Labs.
- **AI dev reimbursement**: $200 for tools like Claude Code; receipts to `ap@eigenlabs.org` (cc `matt.murray@eigenlabs.org`, `grace@eigenlabs.org`).
- **Office hours**: Mon + Wed 11:00–11:30 EST.
- **Ask channel**: `#ext-private-preview` on the Eigen Labs Slack.
- **Dashboard**: `verify.eigencloud.xyz` shows app metadata + verifiability.

---

## 7. Implications for B³ (our project)

What this changes in our codebase:

1. **`agent/app/services/severity_assessor.py`** — currently uses `openai` SDK pointed at `eigenai.eigencloud.xyz/v1` with `x-api-key`. Wrong. Needs to call the AI Gateway with Bearer JWT. Two viable paths:
   - **Node sidecar** using `@layr-labs/ai-gateway-provider` (handles attestation auto inside TEE, takes `KMS_AUTH_JWT` env var locally). Python spawns it.
   - **Python HTTP** to `/v1/chat/completions` with a Bearer JWT — works locally with a manually-issued JWT, requires Python attestation port for in-TEE production use.

2. **`agent/app/config.py`** — `EIGENAI_BASE_URL` and `EIGENAI_MODEL` defaults are wrong. New defaults:
   - `EIGEN_GATEWAY_URL=https://ai-gateway-dev.eigencloud.xyz`
   - `EIGEN_MODEL=gpt-oss-120b-f16` (or `anthropic/claude-sonnet-4.6` if we want better reasoning at the cost of weaker verifiability)
   - Add: `KMS_AUTH_JWT` (local dev), `KMS_SERVER_URL`, `KMS_PUBLIC_KEY` (TEE auto-injected)

3. **Frontend verification ceremony (`frontend/src/lib/verify.ts`)** — needs adjustment:
   - The "EigenAI signature recovered" step changes. The gateway DOES sign receipts (receipt = `H(req)||H(out)||model_id||chainid`), but the byte-concatenation order needs to be confirmed in-browser against the live `verify-signature` doc before May 12.
   - Cross-check recovered signer against `KeyRegistrar.getKey(operator)` on whichever chain the gateway uses (chainID is in the response).

4. **`agent/app/services/signer.py`** — TEE wallet signing is unchanged. `MNEMONIC` env var auto-injection is real and works as we assumed.

5. **CLAUDE.md trust-model section** — reword to add Lambda Inc. and Google Confidential Space; explicitly note that `EigenVerify` slashing is roadmap, not live.

6. **Container build** — we should consider switching to **verifiable build** (`ecloud compute app deploy --verifiable --repo ... --commit ...`). For a bug-bounty broker, the verifiable-build provenance materially strengthens the trust story — verifiers can check the image was built from a specific public commit. Otherwise we're asking them to trust we built the same image we published.

7. **Image-upgrade attack disclosure** — add to `architecture.md`: pin verifiable build digests and explain that wallet-stable upgrades are a known threat we mitigate via on-chain `AppUpgraded` event monitoring.

---

## 8. Open questions for `#ext-private-preview`

Things we should ask before spending more days on assumptions:

1. **`KMS_AUTH_JWT` for local dev**: how do we get one? (Wallet `0x41a0d3f57FC0658E5250Ad5638908EA0914263F9`.)
2. **EigenAI signature byte order**: confirm exact concatenation `H(req) || H(out) || model_id || chainid` (no separators? endianness?).
3. **Closed-weight model verifiability**: does `anthropic/claude-sonnet-4.6` get a signed receipt? Is determinism guaranteed?
4. **`EigenVerify` slashing timeline**: any chance it lands before May 12 even partially? If not, what's the official "honest framing" they want preview teams to use?
5. **Verifiable build flow**: any gotchas for Python apps with native deps (Foundry, etc.)?

---

## 9. Source paths consulted

Documentation:
- `https://docs.eigencloud.xyz/eigencompute/get-started/eigencompute-overview`
- `https://docs.eigencloud.xyz/eigenai/howto/use-eigenai`
- `https://docs.eigencloud.xyz/eigenai/howto/verify-signature`
- `https://docs.eigencloud.xyz/eigencompute/concepts/keys-overview`
- `https://docs.eigencloud.xyz/eigencompute/concepts/processes/upgrade-process`
- `https://docs.eigencloud.xyz/eigencompute/howto/operate/verify-trust-guarantees`
- EigenAI Whitepaper PDF (15 pp)

Github (raw, default branch `master` for ecloud, `main` for docs):
- `Layr-Labs/ecloud` — `packages/cli/src/commands/**`, `packages/sdk/src/client/common/**`
- `Layr-Labs/eigencloud-docs` — `docs/eigencompute/**`, `docs/eigenlayer/**`, `docs/eigencloud/legal/eigenai-terms.md`
- `Layr-Labs/eigenx-contracts` — `script/deploys/{mainnet-alpha,sepolia-prod}/deployment.json`
- `Layr-Labs/ecloud-inference-example` — `src/index.ts`, `.env.example`

NPM packages:
- `@layr-labs/ai-gateway-provider@1.0.1` — full `dist/` source
- `@layr-labs/ecloud-sdk@~0.4.0-dev.2` — `dist/attest.js`

Blog:
- `https://blog.eigencloud.xyz/eigencloud-brings-verifiable-ai-to-mass-market-with-eigenai-and-eigencompute-launches/`
