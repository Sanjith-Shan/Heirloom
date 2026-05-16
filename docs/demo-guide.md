# Heirloom — Demo Day Guide

A minimal step-by-step walk-through for the live presentation. All clicks happen in **mock mode** (instant, zero-latency, no risk). The real deployed version is mentioned and linked at the end.

---

## Before you go on stage (5 min)

1. **Open these three browser tabs** (in this order — you'll switch between them):
   - **Tab 1 (the demo):** `http://34.44.247.6:8080/?mock=1&reset=1`
   - **Tab 2 (Director Dashboard):** `http://34.44.247.6:8080/director?key=demo-secret-2026&mock=1`
   - **Tab 3 (Verifiability dashboard, social proof):** `https://verify-sepolia.eigencloud.xyz/app/0xBFc1A20DBbb86255702c1a4108Cff8d3f1C73992`

2. Confirm Tab 1 shows the **amber "Demo Mock Mode" banner** at the very top with a link to the real version. If you don't see it, append `?mock=1` to the URL again.

3. Confirm Tab 2 (Director) shows the same amber banner.

4. **Test fire** one button in Tab 2 (e.g. "Send reminder email") to confirm everything is responsive. Then click "Reset" to clear the state before going on stage.

---

## The pitch (60 seconds, before any clicks)

> "If you die holding crypto, your family loses everything. About 3.8 million Bitcoin — over $400 billion — is permanently stuck in dead wallets. Existing solutions are all broken: Sarcophagus' token crashed 96%, Casa is a $250/year custodian (the opposite of self-custody), multisig requires your whole family to be crypto-literate forever.
>
> **Heirloom is a sovereign agent that lives inside an Intel TDX hardware enclave on EigenCompute. You give it your seed phrase — sealed in hardware that even Eigen Labs cannot read. You check in periodically with a selfie + wallet signature. If you stop checking in, the agent escalates through reminders, contacts your lawyer, runs a final wallet-activity analysis, and autonomously distributes your assets to your beneficiaries. Every step is cryptographically signed and verifiable on-chain.**
>
> What you're about to see is a mock of the live product, so we can walk through it instantly. Right after, I'll show you the **real version actually running inside a TEE** at this same URL minus the `?mock=1`."

---

## The walkthrough (3 min on stage)

### Step 1 — Landing page

**You're on Tab 1.** The landing page is open. **Don't read it out loud.** Instead say:

> "Setup is one-time. You enter a seed phrase, it gets encrypted in your browser before it leaves your device. Let me skip past that — for the demo, I've already created a plan."

**Click:** the **"Dashboard"** link in the top nav.

### Step 2 — Dashboard

You'll land on the Dashboard showing:
- Phase: **ACTIVE** (green dot)
- Wallet, beneficiaries (Alice 60%, Children's Hospital 40%), emergency contacts
- Recent events log (Plan created + last heartbeat)

Say:

> "This is the active state. The agent is monitoring my wallet. I check in every 30 days with a selfie. The TEE wallet — `0x8926…` — signs every audit event so anyone can verify these came from this exact deployed agent."

### Step 3 — Heartbeat

**Click:** "Check in" in the top nav.

Camera opens. **Click "Open camera" → "Take selfie"** (or skip if there's no camera available — just narrate instead).

The selfie is hashed client-side, hash submitted with a wallet signature. Dashboard returns to ACTIVE.

Say:

> "The photo never leaves my device. Only the SHA-256 hash plus my wallet signature. The agent now knows I'm alive."

### Step 4 — Switch to Director Dashboard (Tab 2)

> "Now imagine I disappear. In production, the system waits weeks. For the demo, I have a presenter dashboard that triggers each phase manually so we can walk through the full lifecycle in 90 seconds."

**Switch to Tab 2.** You see all the Director buttons.

### Step 5 — Trigger Reminder phase

**Click "Advance Phase"** on the Director dashboard. Phase changes to **REMINDER**.

**Click "Send reminder email"**. An event appears in the log: `NOTIFICATION_SENT - USER_REMINDER`.

Say:

> "Phase 2: reminder email goes out. In the real version, you actually get this email at the address you configured during setup. Resend handles delivery."

### Step 6 — Emergency contacts

**Click "Advance Phase"** → phase changes to **EMERGENCY_CONTACT**.

**Click "Notify emergency contacts"**. Event log shows: `NOTIFICATION_SENT - EMERGENCY_CONTACT`.

Say:

> "Phase 3: emergency contacts get notified. Their email tells them you haven't responded for X days, and that they should ask you to log in if you're okay — otherwise the plan will execute automatically."

### Step 7 — AI verification

**Click "Advance Phase"** → phase changes to **VERIFICATION**.

**Click "Run analysis"**. After ~350ms a JSON verdict appears showing:
- Confidence: **LOW** (owner appears inactive)
- Reasoning: long, detailed paragraph about the wallet's transaction pattern
- Inference mode: `openai-fallback` (or `tee-attested` if Eigen Labs fixed the gateway by demo time)
- Agent signature: long hex string

Say:

> "Phase 4: verification. The agent calls a language model to analyze the wallet's recent activity. Here it's saying: two inbound transactions in 86 days, both passive airdrops, no outbound activity, owner pattern doesn't look active. Confidence: LOW. The whole verdict is signed by the TEE wallet so the entire reasoning trace is auditable."

> *Optional aside if asked:* "We're routing through OpenAI directly today. The intended path is Eigen Labs' AI Gateway with attestation-verified inference; that's currently being rolled out for sepolia and we hit a known JWT trust-sync issue. The TEE-wallet signature on the verdict still works either way."

### Step 8 — Dry run + execute

**Click "Dry run"**. Shows the planned distribution: how much each beneficiary would receive.

Say:

> "Before broadcasting, the agent shows you exactly what would happen. If anyone wanted to halt this, they'd have a window."

**Click "Execute"**. After ~600ms shows the execution log: 2 transfers with `tx_hash` strings.

Say:

> "Execution complete. Real Base Sepolia transactions. Beneficiaries receive their split, signed by the TEE wallet, audit log written to the persistent disk inside the enclave."

### Step 9 — Verify ceremony (close strong)

**Switch to Tab 1.** **Click "Verify"** in the top nav.

**Click "Run verification"**.

A list of green checkmarks appears: Sepolia RPC reachable, AppController deployed, KeyRegistrar deployed, agent identity announced, heartbeat recorded, EigenAI inference mode, **analysis verdict signed by THIS deployed agent**, **execution log signed by THIS deployed agent**.

Say:

> "Anyone — including a hostile auditor — can verify every claim Heirloom makes. The agent address is published. Every receipt is signed by a key that only exists inside the TEE. And the deployment itself is verifiable on Eigen Labs' dashboard."

**Switch to Tab 3** (verifiability dashboard) briefly to show the deployed app's image digest, build provenance, public env vars.

Say:

> "That's the real running instance. Image digest pinned to a commit on my public GitHub. Anyone can rebuild and confirm the binary matches. **What you just watched was a mock for time — the real one is running right now at the URL on the banner. Try it yourself after the panel.**"

### Closing line

> "Heirloom: minimized, verifiable trust for crypto inheritance. Built in 6 days for Demo Day. Open source on GitHub. Thank you."

---

## If something breaks during the demo

| Symptom | What to do |
|---|---|
| Banner doesn't appear → not in mock mode | Append `?mock=1&reset=1` to URL and refresh |
| State got messed up mid-demo | Click **Reset** on Director dashboard, OR add `&reset=1` to URL and refresh |
| Mock mode but page is empty | Click "Dashboard" in nav (state might be on a different page) |
| You want to go to the real version mid-demo | Append `?mock=0` to URL — it'll connect to live backend |
| Tab 1 or Tab 2 frozen | Open a fresh incognito window with the same URL |

---

## What's actually being shown vs faked (be honest if asked)

| Component | Mock | Real (live at the URL on the banner) |
|---|---|---|
| TEE deployment | static page | Real Intel TDX, app `0xBFc1A20D…`, image digest verifiable |
| MNEMONIC injection by KMS | n/a | Real, agent wallet `0x8926d2…` |
| Seed phrase encryption | skipped | Real AES-GCM in-browser, sealed with Fernet inside TEE |
| AI verdict | pre-baked text | Real OpenAI `gpt-4o-mini` call from inside TEE (or Eigen AI Gateway if their JWT issue is resolved) |
| TEE wallet signing verdicts | fake hex sig | Real ECDSA signature over canonical JSON |
| On-chain execution | fake tx hashes | Real Base Sepolia transactions from a funded test wallet |
| Email delivery | logged event only | Real Resend HTTP, lands in inbox |
| Verifiability dashboard | n/a | https://verify-sepolia.eigencloud.xyz/app/0xBFc1A20DBbb86255702c1a4108Cff8d3f1C73992 |

---

## URLs to bookmark

- **Mock demo:** http://34.44.247.6:8080/?mock=1
- **Mock director:** http://34.44.247.6:8080/director?key=demo-secret-2026&mock=1
- **Reset mock state:** http://34.44.247.6:8080/?mock=1&reset=1
- **Real (live in TEE):** http://34.44.247.6:8080/
- **Real director:** http://34.44.247.6:8080/director?key=demo-secret-2026
- **Verifiability dashboard:** https://verify-sepolia.eigencloud.xyz/app/0xBFc1A20DBbb86255702c1a4108Cff8d3f1C73992
- **GitHub:** https://github.com/Sanjith-Shan/Heirloom
