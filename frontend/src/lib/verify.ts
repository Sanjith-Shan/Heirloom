/* Verification ceremony — recover signers from agent receipts.
 *
 * The agent signs every audit-relevant payload (heartbeats, EigenAI receipts,
 * execution logs) using its TEE-derived wallet. Anyone can recover the signer
 * with `ethers.verifyMessage(...)` and cross-check the address against
 * `verify.eigencloud.xyz` (which derives the wallet from the AppController app
 * ID). For EigenAI receipts, the signer should match a key registered in
 * `KeyRegistrar.getKey(operator)`.
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

export interface EigenAIReceipt {
  receipt_req_hash: string;
  receipt_out_hash: string;
  receipt_sig: string;
  model_id: string;
  chain_id?: number | null;
}

/* The EigenAI gateway signs `req_hash || out_hash || model_id || chain_id` —
 * exact byte order needs to be confirmed in-browser against the live verify-
 * signature doc on demo day. We expose multiple candidate concatenation
 * orders here so verifiers can pick the right one. */
export function eigenAIVerificationCandidates(r: EigenAIReceipt): string[] {
  const chainStr = (r.chain_id ?? 0).toString();
  return [
    r.receipt_req_hash + r.receipt_out_hash + r.model_id + chainStr,
    "0x" + r.receipt_req_hash + r.receipt_out_hash + r.model_id + chainStr,
  ];
}

export async function tryRecoverEigenAISigner(r: EigenAIReceipt): Promise<string | null> {
  const sig = "0x" + (r.receipt_sig || "").replace(/^0x/, "");
  for (const m of eigenAIVerificationCandidates(r)) {
    try {
      return ethers.verifyMessage(m, sig);
    } catch {
      // try next
    }
  }
  return null;
}
