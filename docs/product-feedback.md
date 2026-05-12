# Product feedback for Eigen Labs

Built on EigenCloud private preview (2026-05-04 reference snapshot). Feedback
ordered by what cost us the most build time vs. what would unblock the most
external developers.

## 1. The Python attestation gap is the biggest single blocker

**Problem.** `@layr-labs/ecloud-sdk/attest` is the only first-party way to obtain
a `KMS_AUTH_JWT` from inside a TEE. It's TypeScript-only. Any Python service
either has to spawn a Node sidecar, hardcode a manually-issued JWT for local
dev, or reimplement the ~50-line attestation flow against `cryptography` and
`jwcrypto`.

For Heirloom we picked "hardcode a JWT for local dev, document the sidecar
pattern for production" — but the inflection point came late and forced a
mid-build pivot. Python is a popular language for crypto/finance backends; the
ecosystem gap is significant.

**Suggestion.** Either ship an official `ecloud-sdk-python` covering the same
attest flow, OR document the wire protocol explicitly enough (sample request/
response, byte-order spec) that a faithful port is a 30-minute task rather than
a research project. The `verify-signature` doc lists the receipt fields but the
exact byte-concatenation order isn't unambiguous from the doc.

## 2. Local dev needs first-class JWT issuance

**Problem.** Today the only path to a working local dev environment is asking
for a token in `#ext-private-preview`. That blocks every external developer
during their first 30 minutes with the platform.

**Suggestion.** A `ecloud auth dev-token` command that issues a short-lived
JWT (a few hours) bound to the user's authenticated identity, gated by
billing-tier check. Don't allow it in production deploys; just unblock the
"my Python script wants to call AI Gateway from my laptop" workflow.

## 3. Receipt byte-concatenation order is the single most ambiguous spec point

**Problem.** Section 6.7 of the EigenAI whitepaper says the operator signs
`H(req) || H(out) || model_id || chainid` but the in-browser verify-signature
doc paraphrases this and 403s scrapers, so it's hard to verify deterministically.
Are the hashes hex-encoded? Raw bytes? Big-endian chain ID? Newline-separated?

**Suggestion.** Publish a one-paragraph normative spec with an unambiguous
byte-level reconstruction example (e.g., "concatenate the lowercase hex
strings, no separator, then call `personalSign(message)`"). Include a
canonical reference test vector: `req=…, out=…, model_id=…, chain=…, sig=…,
expected_signer=0x…`. We embedded multi-candidate verification in our
ceremony page as a workaround.

## 4. `_PUBLIC` envvar semantics

**Problem.** "Visible to clients" and "in cleartext on-chain in `AppUpgraded`
events" are very different things. We read CLAUDE.md from a previous project,
saw `_PUBLIC = "client-readable"`, then discovered they're actually published
on-chain, indexed forever, and impossible to redact. This is materially
important for what you're allowed to put there.

**Suggestion.** `_PUBLIC` is a fine name, but the deploy CLI should log a
visible warning the first time you set one: *"This value will be permanently
recorded on-chain in AppUpgraded events on AppController. Continue?"* Y/n
prompt. Saves at least one Eigen Labs preview team from leaking an API key
to mainnet history.

## 5. Image-upgrade attack — make it the front-page concern

**Problem.** This is the single biggest attack surface for TEE-custody apps in
the alpha: a developer (or compromised dev key) can ship a v2 image that
extracts the same wallet's sealed data, since the wallet, app ID, and storage
keys all persist across upgrades.

**Suggestion.** This deserves its own *concepts* doc page, with a worked example
of detection (subscribe to `AppUpgraded`, diff image digests, fail-closed in
clients). Right now it's mentioned in the upgrade-process doc but framed as
operational rather than security-critical. For products doing custody, this is
the *headline* threat — frame it that way.

## 6. Verifiable build flow needs a Python-native happy path

**Problem.** `ecloud compute app deploy --verifiable --repo --commit` is a
beautiful primitive — but for Python apps with native deps (cryptography,
web3, pillow), wheel availability across architectures is fragile. Got a
single failing wheel during one of our test deploys; the error surface in
the build logs was hard to act on.

**Suggestion.** Document the recommended Python base image / pip-cache
strategy for verifiable builds, and ship a known-good template. Heirloom uses
`python:3.11-slim` + apt build-essential — would be nice to have this
prescribed as the verified recipe.

## 7. Closed-weight model verifiability

**Problem.** `anthropic/claude-sonnet-4.6` is the most powerful routable model,
but the docs are unclear whether the receipt's signature has the same
verifiability guarantees as `gpt-oss-120b-f16`. Our reading: signed receipt is
produced, but determinism isn't guaranteed across hosts, and replaying for
verification doesn't yield bit-identical output.

**Suggestion.** Either spell this out in the model catalog ("verifiable: yes /
partial / no") OR don't surface closed-weight models under EigenAI branding —
route them through a separate AI Gateway namespace so users don't conflate the
two trust models. We chose `gpt-oss-120b-f16` for Heirloom precisely because
the verifiability story is cleaner.

## 8. Slashing framing

**Problem.** Marketing leans hard on "slashable verifiability" but
`EigenVerify` is roadmap, not live. Preview teams aren't sure what to put on
slides.

**Suggestion.** Two-paragraph "alpha trust framing" doc: what's enforced today,
what slashing will unlock, and the recommended honest framing for preview-day
audiences. We landed on "minimized, verifiable trust" — would happily adopt
official language if Eigen Labs prefers something else.

## 9. The `ecloud compute app logs` UX is great

Genuine compliment — `--watch` and the structured-log filtering made debugging
the auto-injection of `MNEMONIC` very fast. Keep it.

## 10. Outside-the-TEE local dev story is solid

`DEMO_MODE` + manually-set `MNEMONIC` for local development worked well. We
were able to do nearly all the build outside the TEE and only validate
attestation/sealing close to deploy day. That's the right primitive. Documenting
this dev pattern as the recommended workflow would help newcomers.

---

**Wallet for credit code attribution**: `0x41a0d3f57FC0658E5250Ad5638908EA0914263F9`.
