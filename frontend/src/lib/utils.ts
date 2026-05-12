import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortAddr(addr: string | null | undefined): string {
  if (!addr) return "";
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatTimestamp(iso: string | number | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "number" ? new Date(iso * 1000) : new Date(iso);
  return d.toLocaleString();
}

export function timeUntil(targetUnix: number): string {
  const now = Date.now() / 1000;
  let secs = Math.max(0, targetUnix - now);
  if (secs < 60) return `${Math.floor(secs)}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${Math.floor(secs % 60)}s`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  return `${Math.floor(secs / 86400)}d ${Math.floor((secs % 86400) / 3600)}h`;
}

export function chainName(id: number): string {
  return ({
    1: "Ethereum",
    8453: "Base",
    137: "Polygon",
    11155111: "Sepolia",
    84532: "Base Sepolia",
  } as Record<number, string>)[id] ?? `chain-${id}`;
}

const EXPLORER_BASE: Record<number, string> = {
  1: "https://etherscan.io",
  8453: "https://basescan.org",
  137: "https://polygonscan.com",
  11155111: "https://sepolia.etherscan.io",
  84532: "https://sepolia.basescan.org",
};

export function explorerTxUrl(chainId: number, txHash: string): string | null {
  const base = EXPLORER_BASE[chainId];
  if (!base || !txHash) return null;
  const hash = txHash.startsWith("0x") ? txHash : "0x" + txHash;
  return `${base}/tx/${hash}`;
}

export function explorerAddressUrl(chainId: number, address: string): string | null {
  const base = EXPLORER_BASE[chainId];
  if (!base || !address) return null;
  return `${base}/address/${address}`;
}

export function explorerName(chainId: number): string {
  return ({
    1: "Etherscan",
    8453: "Basescan",
    137: "Polygonscan",
    11155111: "Etherscan (Sepolia)",
    84532: "Basescan (Sepolia)",
  } as Record<number, string>)[chainId] ?? "Explorer";
}

export function localPlanId(): string | null {
  return localStorage.getItem("heirloom.plan_id");
}

export function setLocalPlanId(id: string | null): void {
  if (id) localStorage.setItem("heirloom.plan_id", id);
  else localStorage.removeItem("heirloom.plan_id");
}
