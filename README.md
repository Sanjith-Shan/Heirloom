# Heirloom

> Crypto inheritance protection. A sovereign agent in a TEE that holds your seed phrase and autonomously distributes your assets to your beneficiaries if you stop checking in.

Built for **Eigen Labs Private Preview Demo Day** — May 12, 2026.

---

## What it does

You give Heirloom an encrypted copy of your wallet's seed phrase. The agent runs inside an Intel TDX TEE on EigenCompute — even Eigen Labs cannot read what's inside. Periodically you check in by taking a selfie + signing a message with your wallet. If you stop checking in, the agent runs a multi-phase verification protocol — reminders, emergency-contact emails, on-chain wallet activity analysis via EigenAI — and then autonomously distributes your assets to the beneficiaries you configured. The whole flow is recorded with cryptographic receipts so anyone can audit what happened.

This is the gap. Existing options are all broken:

| Solution | Why it fails |
|----------|--------------|
| Sarcophagus | Token crashed 96%, operators have no incentive to stay online |
| Casa | Closed-source, $250/yr, semi-custodial, opposite of self-custody |
| Multisig | Requires the whole family to be crypto-literate forever |
| Deadhand | CLI proof-of-concept, no TEE, no autonomous execution |

Heirloom seals the seed in hardware-encrypted memory, monitors liveness with multi-phase escalation, and autonomously executes distribution with verifiable on-chain proof.

---

## Quick start

```bash
# Install ecloud CLI
npm install -g @layr-labs/ecloud-cli
ecloud auth generate --store
ecloud billing subscribe   # use credit code: EigenPreview000

# Local dev
cd agent && pip install -r requirements.txt
cd ../frontend && npm install

# Run backend
cd ../agent && uvicorn app.main:app --reload --port 8080

# Run frontend (separate terminal)
cd ../frontend && npm run dev

# Deploy to EigenCompute
ecloud compute app create --name heirloom --language python
ecloud compute app deploy --instance-type enterprise-1 --verifiable --repo <github-repo> --commit <sha>
ecloud compute app configure tls
```

## Demo day controls

The presenter visits `/director?key=<DIRECTOR_KEY>` for a manual control panel that orchestrates every phase transition on button clicks. No timers, no waiting, no surprises during the live pitch.

## Architecture

See [`docs/architecture.md`](docs/architecture.md). Trust model: minimized, verifiable trust — not "trustless." Intel TDX silicon → Google Confidential Space → Eigen Labs KMS → Lambda Inc. (AI inference) → developer key. EigenVerify slashing is roadmap, not live.

## Status

Alpha. Built in 6 days for Demo Day. Production roadmap: liveness-detection SDK, SSA Death Master File integration, smart-contract wallet support, EigenDA writes, EigenVerify slashing once it ships.
