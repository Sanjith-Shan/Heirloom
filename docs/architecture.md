# Heirloom — architecture

## System overview

```
┌────────────────────────────────────────────────────────────────────┐
│  User device (desktop browser or installed PWA)                    │
│                                                                    │
│   ┌────────────┐   ┌────────────┐   ┌────────────┐                 │
│   │   Setup    │   │ Heartbeat  │   │ Dashboard  │                 │
│   │  (seed +   │   │  (selfie + │   │ (status,   │                 │
│   │   config)  │   │   wallet   │   │  audit,    │                 │
│   │            │   │   sig)     │   │  verify)   │                 │
│   └─────┬──────┘   └─────┬──────┘   └─────┬──────┘                 │
└─────────┼─────────────────┼─────────────────┼──────────────────────┘
          │ AES-GCM         │ SHA-256(selfie) │ HTTPS
          │ envelope        │ + wallet sig    │ (read)
          ▼                 ▼                 ▼
    ╔══════════════════════════════════════════════════════════════╗
    ║   Heirloom agent  (EigenCompute Enterprise — Intel TDX TEE)  ║
    ║                                                              ║
    ║   ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐    ║
    ║   │  Key vault  │  │  Heartbeat   │  │  Escalation      │    ║
    ║   │  Fernet     │  │  /api/heart… │  │  state machine   │    ║
    ║   │  on TEE-    │  │  validates   │  │  ACTIVE→…→EXEC   │    ║
    ║   │  derived    │  │  selfie+sig  │  │                  │    ║
    ║   │  key        │  │              │  │                  │    ║
    ║   └─────────────┘  └──────────────┘  └────────┬─────────┘    ║
    ║                                               │              ║
    ║   ┌─────────────┐  ┌──────────────┐  ┌────────▼─────────┐    ║
    ║   │  Notifier   │  │  Activity    │  │    Executor      │    ║
    ║   │  email +    │  │  analyzer    │  │  unseal seed →   │    ║
    ║   │  push       │  │  EigenAI     │  │  scan balances → │    ║
    ║   │             │  │  signed      │  │  sign & broadcast│    ║
    ║   │             │  │  receipt     │  │                  │    ║
    ║   └─────────────┘  └──────┬───────┘  └────────┬─────────┘    ║
    ║                           │                   │              ║
    ║   ┌──────────────────────────────────────────────────────┐   ║
    ║   │  Audit logger — every action signed by TEE wallet    │   ║
    ║   └──────────────────────────────────────────────────────┘   ║
    ║                                                              ║
    ║   SQLite (encrypted seeds) on persistent disk                ║
    ║   TEE wallet — derived from auto-injected MNEMONIC           ║
    ╚══════════════════════════════════════════════════════════════╝
              │                            │
              ▼                            ▼
       AI Gateway (EigenAI)       Ethereum / Base / etc.
       (deterministic prompts,    (real on-chain transfers
        signed receipts)           when EXECUTION fires)
```

## Approach: stored key

The user keeps their wallet and uses it normally. They give a copy of their seed
phrase to the agent for safekeeping inside the TEE. When the dead man's switch
triggers, the agent uses the stored seed phrase to move the user's assets.

We considered four alternatives and rejected each:

| Approach | Why we rejected it |
|----------|-------------------|
| **Full deposit** (give all assets to agent) | User loses access to their own wallet while alive. Defeats the point. |
| **ERC-20 `approve()` allowances** | Only works for tokens, not native ETH. User must re-approve on every balance change. Brittle. |
| **Smart contract wallet integration** | Best long-term answer, but requires user to migrate wallets. Out of scope for a 6-day build. |
| **Pre-signed transactions** | Break on any user activity (nonce invalidation). Impractical. |

**Stored key** preserves user agency: the user keeps full control of their wallet,
the agent only acts after exhaustive escalation, and any EVM asset on any
configured chain can be moved without per-asset setup.

## State machine

```
                     ┌─────────────────────────────────────────┐
                     │                                         │
                     │  any heartbeat → reset to ACTIVE        │
                     │                                         │
                     ▼                                         │
   ╔══════════╗ timer ╔══════════╗ timer ╔══════════════════╗  │
   ║ ACTIVE   ║──────▶║ REMINDER ║──────▶║ EMERGENCY_       ║  │
   ║          ║       ║          ║       ║  CONTACT         ║  │
   ╚══════════╝       ╚══════════╝       ╚════════┬═════════╝  │
                                                  │            │
                                                  │ timer      │
                                                  ▼            │
                                         ╔══════════════════╗  │
                                         ║  VERIFICATION    ║──┘
                                         ║  EigenAI runs    ║
                                         ║  on-chain check  ║
                                         ╚════════┬═════════╝
                                                  │
                                                  │ wallet inactive
                                                  ▼
                                         ╔══════════════════╗
                                         ║   EXECUTION      ║
                                         ║   (terminal)     ║
                                         ╚══════════════════╝
```

Default durations: 30 days ACTIVE → 7 REMINDER → 7 EMERGENCY_CONTACT → 7 VERIFICATION → EXECUTION.
Total ~51 days from missed heartbeat to terminal action. `DEMO_FAST_TIMERS=true`
shrinks them to seconds for development; `DEMO_MODE=true` disables auto-advance
so the Director Dashboard drives every transition during the live pitch.

If EigenAI's verdict during VERIFICATION is `HIGH` or `MEDIUM` confidence the
wallet is still active, the phase extends rather than progressing — a recent
on-chain transaction is treated as evidence of life.

## Trust model

We frame this as **minimized, verifiable trust** — not "trustless." There is no
slashing-backed AVS for EigenCompute or EigenAI today (`EigenVerify` is roadmap).

The trust chain:

1. **Intel TDX silicon** — hardware-encrypted memory; even host root can't read enclave RAM.
2. **Google Confidential Space** — attested boot, sealed env vars, image-pinned execution.
3. **Eigen Labs KMS** — auto-injects `MNEMONIC` deterministically from app ID; signs attestations.
4. **Lambda Inc.** — hosts the GPU inference fleet behind the AI Gateway. Trusted for EigenAI requests.
5. **Developer key** — signs the deployed image. A malicious upgrade could exfiltrate sealed data.

Mitigations we ship:

- **Verifiable build** via `ecloud compute app deploy --verifiable --repo --commit`. Anyone can confirm the running image was built from a specific public commit hash.
- **On-chain `AppUpgraded` event monitoring**. Any image upgrade emits an event with the new image digest; verifiers can audit each upgrade against the public repo. The wallet address and app ID are stable across upgrades, so the threat is "v2 image silently exfiltrates v1 sealed data" — the audit trail makes this detectable.
- **Open-source code** at the public commit referenced by the deploy.

## Image-upgrade attack disclosure

EigenCompute image upgrades preserve: app ID, TEE wallet, instance IP. They
change: image digest, sealed env vars. A developer with valid credentials can
ship a v2 image that exfiltrates the sealed seed phrase from the same TEE
wallet's storage key, since the storage key is itself derived from the wallet.

This is the *single biggest* attack surface for any TEE-based custody product
in the EigenCompute alpha. Mitigation paths in priority order:

1. **Verifiable builds + public repo monitoring**. The current strongest defense.
2. **Developer key revocation** (roadmap from Eigen Labs).
3. **`EigenVerify` slashing** when it ships — the AVS will re-execute deterministic flows and slash deviating operators.
4. **Multi-sig deployment authority** — would require a custom contract layer above AppController.

We disclose this honestly in the demo; it's why "minimized, verifiable trust" is
the framing rather than "trustless."

## EigenAI integration

The wallet activity analyzer sends a deterministic prompt:

```
seed=42, temperature=0, model=gpt-oss-120b-f16
```

…containing recent on-chain transactions and balances for the user's wallet,
and asks for a structured JSON verdict. The response carries a signed receipt:

```
receipt = ⟨ H(req), H(out), model_id, chainid, da_pointer ⟩
σ_op    = sign_secp256k1(receipt)
```

Anyone can replay the same prompt with the same seed to get bit-identical
output (within a single GPU SKU), then recover the operator signer with
`ethers.verifyMessage(...)` and cross-check against the operator's registered
key in `KeyRegistrar.getKey(operator)` on Sepolia or mainnet.

In local dev (no `KMS_AUTH_JWT`), the analyzer falls back to a *real-data /
mocked-verdict* mode: it still fetches actual on-chain data, but returns a
heuristic verdict labeled `is_mocked: true`. The Director Dashboard surfaces
this state honestly — judges see when the verdict is signed vs. mocked.

## Storage

- **Encrypted seed phrases**: AES-GCM via Fernet, keyed by SHA-256 of the TEE
  wallet's private key. Stored in `sealed_keys` table on the persistent disk
  volume mounted at `$USER_PERSISTENT_DATA_PATH`.
- **Audit log**: SQLite `events` table for live UI. Final execution receipts
  also written to a file under `$AUDIT_PATH` for inclusion in the demo
  EigenDA writes (real EigenDA integration is roadmap).
- **Heartbeat history**: `heartbeats` table with timestamp, selfie hash, wallet
  signature, and pre-transition phase.

## What's not built (roadmap)

- **Real liveness detection** (single-image SDKs like IDLive Face, Facia at 99.8% anti-spoof).
- **SSA Death Master File** integration (requires NTIS certification).
- **Smart-contract wallet** native support (best long-term custody story).
- **Real EigenDA writes** for the audit trail.
- **EigenVerify slashing** integration when it ships.
- **Non-EVM chains** (Bitcoin, Solana).
- **face-api.js identity matching** (built but optional; depends on time).
