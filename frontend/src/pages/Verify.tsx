import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, AuditEvent, StatusResponse } from "@/lib/api";
import {
  APP_CONTROLLER_MAINNET,
  APP_CONTROLLER_SEPOLIA,
  KEY_REGISTRAR_MAINNET,
  KEY_REGISTRAR_SEPOLIA,
  canonicalDigest,
  recoverAgent,
} from "@/lib/verify";
import {
  calculateAppId,
  getSepoliaBlockNumber,
  probeAppController,
  probeKeyRegistrar,
  readAppController,
  readKeyRegistrar,
} from "@/lib/onchain";
import { localPlanId, shortAddr } from "@/lib/utils";

interface CheckResult {
  label: string;
  ok: boolean | "warn";
  detail?: string;
}

export default function Verify() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let pid = localPlanId();
    let cancelled = false;
    async function load() {
      try {
        if (!pid) {
          const p = await api.getActivePlan();
          pid = p.id;
        }
        const s = await api.status(pid!);
        if (!cancelled) setStatus(s);
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e));
      }
    }
    load();
  }, []);

  async function runVerification() {
    if (!status) return;
    setChecks(null);
    const out: CheckResult[] = [];

    // 0. Sepolia liveness — confirms the public RPC is reachable
    try {
      const blk = await getSepoliaBlockNumber();
      out.push({
        label: "Sepolia RPC reachable",
        ok: true,
        detail: `block #${blk.toLocaleString()}`,
      });
    } catch (e: any) {
      out.push({ label: "Sepolia RPC reachable", ok: false, detail: e?.message ?? "rpc failed" });
    }

    // 0a. AppController contract present at expected address
    const appCtrl = await probeAppController();
    out.push({
      label: "AppController deployed on Sepolia",
      ok: appCtrl.exists,
      detail: `${shortAddr(appCtrl.address)} · ${appCtrl.codeSize.toLocaleString()} bytes of bytecode`,
    });

    // 0b. KeyRegistrar contract present
    const keyReg = await probeKeyRegistrar();
    out.push({
      label: "KeyRegistrar deployed on Sepolia",
      ok: keyReg.exists,
      detail: `${shortAddr(keyReg.address)} · ${keyReg.codeSize.toLocaleString()} bytes of bytecode`,
    });

    // 1. Agent identity announced
    out.push({
      label: "Agent identity announced",
      ok: true,
      detail: status.agent_wallet_address,
    });

    // 1a. Try to look up the app on AppController. We don't know the exact appId
    // (would need owner+salt from Eigen Labs), but we can probe with a calculated
    // candidate based on the agent address as owner. This is best-effort —
    // surfaces "found" or "ABI candidate signatures all reverted" honestly.
    try {
      const probeAppId = calculateAppId(status.agent_wallet_address);
      const appInfo = await readAppController(probeAppId);
      if (appInfo.exists === true) {
        out.push({
          label: "App registered on AppController",
          ok: true,
          detail: appInfo.imageDigest
            ? `image=${appInfo.imageDigest.slice(0, 12)}… upgraded ${appInfo.lastUpgradeTime ? new Date(appInfo.lastUpgradeTime * 1000).toLocaleString() : "?"}`
            : `owner=${shortAddr(appInfo.owner ?? "")}`,
        });
      } else if (appInfo.exists === false) {
        out.push({
          label: "App registered on AppController",
          ok: "warn",
          detail: `appId ${probeAppId.slice(0, 16)}… probe returned no record (real appId requires owner+salt from deploy)`,
        });
      } else {
        out.push({
          label: "AppController call",
          ok: "warn",
          detail: `ABI candidates reverted — verify on verify.eigencloud.xyz directly`,
        });
      }
    } catch (e: any) {
      out.push({
        label: "AppController call",
        ok: "warn",
        detail: e?.message?.slice(0, 100) ?? "rpc error",
      });
    }

    // 2. Heartbeat present
    const hb = status.recent_events.find((e) => e.kind === "HEARTBEAT");
    out.push({
      label: "At least one heartbeat recorded",
      ok: !!hb,
      detail: hb ? new Date(hb.created_at).toLocaleString() : "no heartbeats",
    });

    // 3. EigenAI analysis: verify the TEE-wallet signature on the verdict.
    // The gateway response itself has no per-call signature — verifiability
    // comes from (a) image-digest attestation upstream, and (b) the agent
    // wallet signing the verdict here so anyone can prove which deployed app
    // produced it.
    const eai = findLatest(status.recent_events, "EIGENAI_ANALYSIS");
    if (eai) {
      const r = eai.payload as any;
      out.push({
        label: `EigenAI inference mode: ${r.inference_mode ?? "unknown"}`,
        ok: r.inference_mode === "tee-attested" ? true
          : r.inference_mode === "manual-jwt" ? "warn"
          : r.inference_mode === "mocked" ? "warn"
          : false,
        detail: r.inference_mode === "tee-attested"
          ? "JWT minted from TDX attestation token; gateway pinned to deployed image digest"
          : r.inference_mode === "manual-jwt"
          ? "Direct gateway call with operator JWT (local dev / sidecar down)"
          : r.inference_mode === "mocked"
          ? "Verdict derived from on-chain reads only — no model in the loop"
          : "missing inference_mode field",
      });

      if (r.agent_signature) {
        try {
          const digest = await canonicalDigest({
            active_since_heartbeat: r.active_since_heartbeat,
            confidence_owner_active: r.confidence_owner_active,
            transaction_count_since_heartbeat: r.transaction_count_since_heartbeat,
            model_id: r.model_id,
            prompt_hash: r.prompt_hash,
            response_id: r.response_id,
            inference_mode: r.inference_mode,
          });
          const recovered = recoverAgent({
            digest,
            signature: r.agent_signature,
          });
          const ok = recovered.toLowerCase() === (r.agent_address ?? "").toLowerCase()
            && recovered.toLowerCase() === status.agent_wallet_address.toLowerCase();
          out.push({
            label: "Analysis verdict signed by THIS deployed agent",
            ok,
            detail: ok
              ? `signer ${shortAddr(recovered)} matches deployed agent address`
              : `mismatch: signer=${recovered} expected=${r.agent_address}`,
          });
        } catch (e: any) {
          out.push({
            label: "Analysis verdict signature",
            ok: false,
            detail: e?.message ?? String(e),
          });
        }
      } else {
        out.push({
          label: "Analysis verdict signature",
          ok: "warn",
          detail: "no signature on this verdict",
        });
      }
    } else {
      out.push({
        label: "EigenAI analysis",
        ok: "warn",
        detail: "no analysis run yet — Director can trigger one",
      });
    }

    // 4. Execution log signed by agent
    const exec = findLatest(status.recent_events, "EXECUTION");
    if (exec) {
      const p = exec.payload as any;
      try {
        const digest = await canonicalDigest({ transfers: p.transfers });
        const recovered = recoverAgent({
          digest,
          signature: p.agent_signature,
        });
        const ok = recovered.toLowerCase() === (p.agent_address ?? "").toLowerCase()
          && recovered.toLowerCase() === status.agent_wallet_address.toLowerCase();
        out.push({
          label: "Execution log signed by THIS deployed agent",
          ok,
          detail: ok ? `signer matches agent ${shortAddr(recovered)}` : `mismatch: signer=${recovered} expected=${p.agent_address}`,
        });
      } catch (e: any) {
        out.push({
          label: "Execution log signed by agent",
          ok: false,
          detail: e?.message ?? String(e),
        });
      }
    } else {
      out.push({
        label: "Execution log signed",
        ok: "warn",
        detail: "no execution recorded yet",
      });
    }

    setChecks(out);
  }

  if (error && !status) {
    return (
      <div className="container-narrow py-16 text-center">
        <h1 className="text-2xl font-semibold mb-2">No plan to verify</h1>
        <Link to="/setup" className="btn-primary">Set up your plan</Link>
      </div>
    );
  }
  if (!status) return <div className="container-wide py-16 text-neutral-400">Loading…</div>;

  return (
    <div className="container-narrow py-12">
      <h1 className="text-3xl font-semibold tracking-tight mb-2">Verification ceremony</h1>
      <p className="text-neutral-400 mb-8">
        Independent verification of every cryptographic claim Heirloom makes.
        No trust in us required — only in the underlying primitives.
      </p>

      <div className="card mb-6 space-y-3 text-sm">
        <Row k="Agent wallet" v={status.agent_wallet_address} mono />
        <Row k="User wallet" v={status.wallet_address} mono />
        <Row k="Plan ID" v={status.plan_id} mono />
        <Row k="Current phase" v={status.current_phase} />
        <div className="border-t border-neutral-800 pt-3 mt-3">
          <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">On-chain registries</div>
          <Row k="AppController (Sepolia)" v={APP_CONTROLLER_SEPOLIA} mono />
          <Row k="AppController (Mainnet)" v={APP_CONTROLLER_MAINNET} mono />
          <Row k="KeyRegistrar (Sepolia)" v={KEY_REGISTRAR_SEPOLIA} mono />
          <Row k="KeyRegistrar (Mainnet)" v={KEY_REGISTRAR_MAINNET} mono />
        </div>
      </div>

      <button className="btn-primary w-full" onClick={runVerification}>
        Run verification
      </button>

      {checks && (
        <div className="mt-6 space-y-2">
          {checks.map((c, i) => (
            <div
              key={i}
              className={
                "card border-l-4 " +
                (c.ok === true ? "border-l-emerald-500" :
                 c.ok === "warn" ? "border-l-amber-500" :
                 "border-l-red-500")
              }
            >
              <div className="flex items-start gap-3">
                <div
                  className={
                    "h-5 w-5 rounded-full flex-shrink-0 mt-0.5 grid place-items-center text-xs " +
                    (c.ok === true ? "bg-emerald-500 text-black" :
                     c.ok === "warn" ? "bg-amber-500 text-black" :
                     "bg-red-500 text-black")
                  }
                >
                  {c.ok === true ? "✓" : c.ok === "warn" ? "!" : "✗"}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{c.label}</div>
                  {c.detail && <div className="text-xs text-neutral-500 mt-0.5 break-all">{c.detail}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-10 text-xs text-neutral-500 leading-relaxed">
        <p>
          <strong className="text-neutral-300">How verification works.</strong> Heirloom
          publishes its agent wallet address on creation. Every receipt — heartbeats,
          EigenAI analyses, execution logs — is signed with that wallet's TEE-bound
          private key, which is auto-injected by the EigenCompute KMS and never
          accessible outside the enclave. To verify any claim:
        </p>
        <ol className="list-decimal pl-5 space-y-1 mt-2">
          <li>Recover the signer with <code className="font-mono text-neutral-300">ethers.verifyMessage</code></li>
          <li>Confirm it matches the agent address shown above</li>
          <li>Cross-check that address against <code className="font-mono text-neutral-300">verify-sepolia.eigencloud.xyz/app/&lt;app-id&gt;</code> for the deployed app</li>
          <li>For EigenAI verdicts, additionally check <code className="font-mono text-neutral-300">inference_mode === "tee-attested"</code> — proves the JWT was minted from a TDX attestation token, not a manual override</li>
        </ol>
      </div>
    </div>
  );
}

function findLatest(events: AuditEvent[], kind: string): AuditEvent | undefined {
  return events.find((e) => e.kind === kind);
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <div className="text-neutral-500">{k}</div>
      <div className={mono ? "font-mono text-xs break-all max-w-[60%] text-right" : ""}>{v}</div>
    </div>
  );
}
