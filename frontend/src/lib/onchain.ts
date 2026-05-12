/* Live on-chain reads against EigenLayer contracts on Sepolia.
 *
 * Uses public RPCs. ABI signatures are best-effort — the EigenX contracts are
 * private-preview and the official ABIs aren't published anywhere we can pull
 * at build time. We try a few candidate signatures and surface whichever
 * succeeds. If everything reverts we still render the contract addresses and
 * label the read as "ABI mismatch" so the user knows to look at the
 * verifiability dashboard for the canonical view.
 */

import { ethers } from "ethers";
import {
  APP_CONTROLLER_SEPOLIA,
  KEY_REGISTRAR_SEPOLIA,
} from "./verify";

const SEPOLIA_RPC = "https://rpc.sepolia.org";

function provider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(SEPOLIA_RPC);
}

// ---------------------- AppController ----------------------

const APP_CONTROLLER_ABI_CANDIDATES: string[][] = [
  // Most likely shape based on docs (struct with image/wallet/upgrade time)
  ["function getApp(bytes32 appId) view returns (address owner, address wallet, string imageDigest, uint256 lastUpgradeTime)"],
  ["function apps(bytes32 appId) view returns (address owner, address wallet, string imageDigest, uint256 lastUpgradeTime)"],
  // Simpler "is this app registered" probe
  ["function isRegistered(bytes32 appId) view returns (bool)"],
  // Owner-only fallback
  ["function ownerOf(bytes32 appId) view returns (address)"],
];

export interface AppControllerInfo {
  address: string;
  appId?: string;
  exists: boolean | null;
  owner?: string;
  wallet?: string;
  imageDigest?: string;
  lastUpgradeTime?: number;
  rawError?: string;
}

export function calculateAppId(ownerAddress: string, salt: string = "0x" + "0".repeat(64)): string {
  // appId = keccak256(owner_address || salt) per the platform reference
  return ethers.keccak256(
    ethers.solidityPacked(["address", "bytes32"], [ownerAddress, salt]),
  );
}

export async function readAppController(appId?: string): Promise<AppControllerInfo> {
  const result: AppControllerInfo = {
    address: APP_CONTROLLER_SEPOLIA,
    appId,
    exists: null,
  };
  if (!appId) return result;

  const p = provider();
  for (const abi of APP_CONTROLLER_ABI_CANDIDATES) {
    try {
      const contract = new ethers.Contract(APP_CONTROLLER_SEPOLIA, abi, p);
      const fnName = abi[0].match(/function (\w+)/)?.[1];
      if (!fnName) continue;
      const ret = await (contract as any)[fnName](appId);
      // Heuristic — first signature with 4 returns is the rich variant
      if (Array.isArray(ret) && ret.length >= 4) {
        result.owner = String(ret[0]);
        result.wallet = String(ret[1]);
        result.imageDigest = String(ret[2]);
        result.lastUpgradeTime = Number(ret[3]);
        result.exists = ret[0] !== ethers.ZeroAddress;
        return result;
      }
      if (typeof ret === "boolean") {
        result.exists = ret;
        return result;
      }
      if (typeof ret === "string" && ret.startsWith("0x")) {
        result.owner = ret;
        result.exists = ret !== ethers.ZeroAddress;
        return result;
      }
    } catch (e: any) {
      result.rawError = e?.shortMessage ?? e?.message;
    }
  }
  return result;
}

// Probe the contract is alive by reading its bytecode — always works.
export async function probeAppController(): Promise<{ codeSize: number; exists: boolean; address: string }> {
  try {
    const p = provider();
    const code = await p.getCode(APP_CONTROLLER_SEPOLIA);
    return { codeSize: (code.length - 2) / 2, exists: code !== "0x", address: APP_CONTROLLER_SEPOLIA };
  } catch {
    return { codeSize: 0, exists: false, address: APP_CONTROLLER_SEPOLIA };
  }
}

// ---------------------- KeyRegistrar ----------------------

const KEY_REGISTRAR_ABI_CANDIDATES: string[][] = [
  ["function getKey(address operator) view returns (bytes)"],
  ["function getOperatorKey(address operator) view returns (bytes)"],
  ["function operatorKeys(address operator) view returns (bytes)"],
  ["function isRegistered(address operator) view returns (bool)"],
];

export interface KeyRegistrarLookup {
  address: string;
  operator: string;
  registered: boolean | null;
  key?: string;
  rawError?: string;
}

export async function readKeyRegistrar(operator: string): Promise<KeyRegistrarLookup> {
  const result: KeyRegistrarLookup = {
    address: KEY_REGISTRAR_SEPOLIA,
    operator,
    registered: null,
  };
  if (!operator || !ethers.isAddress(operator)) return result;

  const p = provider();
  for (const abi of KEY_REGISTRAR_ABI_CANDIDATES) {
    try {
      const contract = new ethers.Contract(KEY_REGISTRAR_SEPOLIA, abi, p);
      const fnName = abi[0].match(/function (\w+)/)?.[1];
      if (!fnName) continue;
      const ret = await (contract as any)[fnName](operator);
      if (typeof ret === "boolean") {
        result.registered = ret;
        return result;
      }
      if (typeof ret === "string" && ret.startsWith("0x")) {
        result.key = ret;
        result.registered = ret.length > 2;
        return result;
      }
    } catch (e: any) {
      result.rawError = e?.shortMessage ?? e?.message;
    }
  }
  return result;
}

export async function probeKeyRegistrar(): Promise<{ codeSize: number; exists: boolean; address: string }> {
  try {
    const p = provider();
    const code = await p.getCode(KEY_REGISTRAR_SEPOLIA);
    return { codeSize: (code.length - 2) / 2, exists: code !== "0x", address: KEY_REGISTRAR_SEPOLIA };
  } catch {
    return { codeSize: 0, exists: false, address: KEY_REGISTRAR_SEPOLIA };
  }
}

export async function getSepoliaBlockNumber(): Promise<number> {
  return provider().getBlockNumber();
}
