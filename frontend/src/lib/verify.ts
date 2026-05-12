/* Verification ceremony — recover signers from agent receipts.
 *
 * The agent signs every audit-relevant payload (analysis verdicts, execution
 * logs) using its TEE-derived wallet. Anyone can recover the signer with
 * `ethers.verifyMessage(...)` and cross-check the address against
 * `verify-sepolia.eigencloud.xyz/app/<app-id>` (which exposes the EVM address
 * derived from the deployed app's MNEMONIC).
 *
 * Note: the EigenAI gateway response itself is plain OpenAI-compatible — it
 * does NOT contain a per-call operator signature. Verifiability of the model
 * call comes from the upstream image-digest attestation (Heirloom's image is
 * pinned, the model_id + seed=42 + prompt_hash make the call deterministic).
 * The TEE-wallet signature on the verdict is what binds "this analysis came
 * from THIS deployed agent" — recoverable here.
 */

import { ethers } from "ethers";

export const KEY_REGISTRAR_SEPOLIA = "0xA4dB30D08d8bbcA00D40600bee9F029984dB162a";
export const KEY_REGISTRAR_MAINNET = "0x54f4bC6bDEbe479173a2bbDc31dD7178408A57A4";
export const APP_CONTROLLER_SEPOLIA = "0x0dd810a6ffba6a9820a10d97b659f07d8d23d4E2";
export const APP_CONTROLLER_MAINNET = "0xc38d35Fc995e75342A21CBd6D770305b142Fbe67";

export interface AgentReceipt {
  digest: string;
  signature: string;
  agent_address?: string;
}

export function recoverAgent(receipt: AgentReceipt): string {
  // The agent signs the canonical sha256 digest as a personal_sign-style message
  return ethers.verifyMessage(receipt.digest, "0x" + receipt.signature.replace(/^0x/, ""));
}

/* Reproduce the agent's canonical-JSON digest so the signature can be verified
 * against any payload object. Mirrors Python's
 * json.dumps(..., sort_keys=True, separators=(",",":")) — keys sorted at
 * every nesting level, no whitespace. */
function deepCanonicalize(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(deepCanonicalize);
  const o = v as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) sorted[k] = deepCanonicalize(o[k]);
  return sorted;
}

export async function canonicalDigest(payload: unknown): Promise<string> {
  const canonical = JSON.stringify(deepCanonicalize(payload));
  const buf = new TextEncoder().encode(canonical);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
