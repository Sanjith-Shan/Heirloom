import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, AnalysisResult, StatusResponse } from "@/lib/api";
import PhaseIndicator from "@/components/PhaseIndicator";
import EventLog from "@/components/EventLog";
import { TxLink, AddressLink } from "@/components/TxLink";
import { chainName, shortAddr } from "@/lib/utils";

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "warn" | "err";
}

export default function Director() {
  const [params] = useSearchParams();
  const key = params.get("key") || "";

  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [lastAnalysis, setLastAnalysis] = useState<AnalysisResult | null>(null);
  const [lastDryRun, setLastDryRun] = useState<any>(null);
  const [lastExecution, setLastExecution] = useState<any>(null);
  const [confirmExec, setConfirmExec] = useState(false);

  function toast(text: string, tone: "ok" | "warn" | "err" = "ok") {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const info = await api.director.info(key);
        if (cancelled) return;
        setAuthorized(true);
        if (info.plan_id) {
          const s = await api.status(info.plan_id);
          if (!cancelled) setStatus(s);
        } else {
          setStatus(null);
        }
      } catch {
        if (!cancelled) setAuthorized(false);
      }
    }
    if (!key) {
      setAuthorized(false);
      return;
    }
    load();
    const t = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [key]);

  if (!key || authorized === false) {
    return (
      <div className="container-narrow py-16 text-center">
        <h1 className="text-2xl font-semibold mb-2">Director Dashboard</h1>
        <p className="text-neutral-400">
          Append <code className="font-mono text-neutral-300">?key=…</code> to the URL with the demo secret.
        </p>
      </div>
    );
  }

  if (authorized === null) {
    return <div className="container-wide py-16 text-neutral-400">Authorizing…</div>;
  }

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(label);
    try {
      const r = await fn();
      toast(`${label}: ok`, "ok");
      return r;
    } catch (e: any) {
      toast(`${label}: ${e?.message ?? e}`, "err");
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="container-wide py-10 grid lg:grid-cols-12 gap-6">
      <div className="lg:col-span-8 space-y-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-3xl font-semibold tracking-tight">Director</h1>
          <span className="badge bg-neutral-900 border border-neutral-800 text-neutral-400">
            demo control panel
          </span>
        </div>

        <div className="card">
          {status ? (
            <PhaseIndicator phase={status.current_phase} />
          ) : (
            <div className="text-sm text-neutral-500">No active plan. Create one in Setup first.</div>
          )}
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <ActionCard
            title="Request heartbeat"
            desc="Push the user's PWA — show me on phone."
            disabled={!status || !!busy}
            onClick={() => run("Request heartbeat", () => api.director.requestHeartbeat(key))}
          />
          <ActionCard
            title="Send reminder email"
            desc="First reminder to the user themselves."
            disabled={!status || !!busy}
            onClick={() => run("Reminder", () => api.director.sendReminder(key))}
          />
          <ActionCard
            title="Notify emergency contacts"
            desc="Spouse/lawyer/etc. get the escalation email."
            disabled={!status || !!busy}
            onClick={() => run("Emergency contacts", () => api.director.notifyContacts(key))}
          />
          <ActionCard
            title="Run EigenAI analysis"
            desc="Verifiable on-chain activity check."
            disabled={!status || !!busy}
            onClick={async () => {
              const r = await run("EigenAI", () => api.director.runAnalysis(key));
              if (r) setLastAnalysis(r.analysis);
            }}
          />
          <ActionCard
            title="Advance phase"
            desc="Force the state machine to the next stage."
            disabled={!status || !!busy}
            onClick={async () => {
              const r = await run("Advance phase", () => api.director.advance(key));
              if (r && (r as any).analysis) setLastAnalysis((r as any).analysis);
            }}
          />
          <ActionCard
            title="Dry-run execution"
            desc="Show what each beneficiary WOULD receive."
            disabled={!status || !!busy}
            onClick={async () => {
              const r = await run("Dry run", () => api.director.dryRun(key));
              if (r) setLastDryRun(r);
            }}
          />
          <ActionCard
            title="Execute distribution"
            desc="Live on-chain. Irreversible after this."
            disabled={!status || !!busy}
            tone="danger"
            onClick={() => setConfirmExec(true)}
          />
          <ActionCard
            title="Reset to Active"
            desc="Bring everything back to phase 1 for re-runs."
            disabled={!status || !!busy}
            onClick={() => run("Reset", () => api.director.reset(key))}
          />
        </div>

        {lastAnalysis && <AnalysisCard analysis={lastAnalysis} />}
        {lastDryRun && <DryRunCard dryRun={lastDryRun} />}
        {lastExecution && <ExecutionCard execution={lastExecution} />}
      </div>

      <aside className="lg:col-span-4 space-y-6">
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">Plan</div>
          {status ? (
            <div className="space-y-2 text-sm">
              <Row k="ID" v={shortAddr(status.plan_id)} />
              <Row k="Wallet" v={shortAddr(status.wallet_address)} />
              <Row k="Agent" v={shortAddr(status.agent_wallet_address)} />
              <Row k="Phase" v={status.current_phase} />
              <Row k="Beneficiaries" v={status.beneficiaries.length.toString()} />
              <Row k="Chains" v={status.configured_chains.map(chainName).join(", ")} />
              <Row k="Demo mode" v={status.demo_mode ? "ON" : "OFF"} />
            </div>
          ) : (
            <div className="text-sm text-neutral-500">—</div>
          )}
        </div>

        <div className="card">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-xs uppercase tracking-wider text-neutral-500">Live event log</div>
            <span className="text-[10px] text-neutral-500">refresh: 2.5s</span>
          </div>
          {status ? <EventLog events={status.recent_events} max={15} /> : null}
        </div>
      </aside>

      {/* Toasts */}
      <div className="fixed bottom-6 right-6 space-y-2 z-50">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={
              "rounded-md px-4 py-2 text-sm shadow-lg border " +
              (t.tone === "ok"
                ? "bg-emerald-950/80 border-emerald-800 text-emerald-200"
                : t.tone === "warn"
                ? "bg-amber-950/80 border-amber-800 text-amber-200"
                : "bg-red-950/80 border-red-800 text-red-200")
            }
          >
            {t.text}
          </div>
        ))}
      </div>

      {confirmExec && (
        <div className="fixed inset-0 bg-black/70 grid place-items-center z-40">
          <div className="card max-w-md mx-4">
            <h3 className="text-lg font-semibold mb-2">Execute distribution?</h3>
            <p className="text-sm text-neutral-400 mb-4">
              The agent will unseal the seed in the TEE, derive the wallet, and send transactions
              to each beneficiary. This is live — irreversible after broadcast.
            </p>
            <div className="flex gap-2 justify-end">
              <button className="btn-secondary" onClick={() => setConfirmExec(false)}>Cancel</button>
              <button
                className="btn-danger"
                onClick={async () => {
                  setConfirmExec(false);
                  const r = await run("Execute", () => api.director.execute(key));
                  if (r) setLastExecution(r.execution);
                }}
              >
                Confirm execute
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionCard({
  title, desc, disabled, onClick, tone,
}: {
  title: string; desc: string; disabled?: boolean; onClick: () => void; tone?: "danger";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "card text-left transition-colors disabled:opacity-50 disabled:pointer-events-none " +
        (tone === "danger"
          ? "hover:border-red-500/50 border-red-900/50"
          : "hover:border-neutral-600")
      }
    >
      <div className="font-medium mb-1">{title}</div>
      <div className="text-xs text-neutral-500">{desc}</div>
    </button>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <div className="text-neutral-500">{k}</div>
      <div className="font-mono text-xs">{v}</div>
    </div>
  );
}

function AnalysisCard({ analysis }: { analysis: AnalysisResult }) {
  const conf = analysis.confidence_owner_active;
  const tone =
    conf === "HIGH" ? "border-emerald-500/40" :
    conf === "MEDIUM" ? "border-amber-500/40" :
    "border-red-500/40";
  return (
    <div className={"card border-2 " + tone}>
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-base font-medium">EigenAI analysis</h3>
        {analysis.is_mocked && (
          <span className="badge bg-amber-500/15 text-amber-300">mocked (no JWT)</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <Row k="Active since heartbeat" v={String(analysis.active_since_heartbeat)} />
        <Row k="Tx count" v={analysis.transaction_count_since_heartbeat.toString()} />
        <Row k="Confidence" v={conf} />
        <Row k="Last tx" v={analysis.last_transaction_date ?? "—"} />
        <Row k="Model" v={analysis.model_id ?? "—"} />
        <Row k="Chain" v={analysis.chain_id?.toString() ?? "—"} />
      </div>
      {analysis.reasoning && (
        <p className="text-xs text-neutral-400 mt-3 italic">{analysis.reasoning}</p>
      )}
      {analysis.receipt_sig && (
        <div className="mt-3 pt-3 border-t border-neutral-800 space-y-1 text-[11px] font-mono text-neutral-500 break-all">
          <div>req_hash: {analysis.receipt_req_hash}</div>
          <div>out_hash: {analysis.receipt_out_hash}</div>
          <div>sig:      {analysis.receipt_sig}</div>
        </div>
      )}
    </div>
  );
}

function ExecutionCard({ execution }: { execution: any }) {
  const transfers = (execution.transfers ?? []) as any[];
  return (
    <div className="card border-2 border-red-500/40">
      <h3 className="text-base font-medium mb-3">Execution complete</h3>
      <div className="text-xs text-neutral-500 mb-3">
        Signed by agent: <span className="font-mono">{shortAddr(execution.agent_address)}</span>
        {" · "}
        executed at {new Date(execution.executed_at).toLocaleTimeString()}
      </div>
      <div className="space-y-1.5">
        {transfers.map((t: any, i: number) => (
          <div key={i} className="flex items-center justify-between text-xs border-t border-neutral-800 pt-1.5">
            <div className="flex items-center gap-2 text-neutral-400">
              <span className={
                t.status === "sent" ? "text-emerald-400" :
                t.status === "skipped" ? "text-neutral-500" : "text-red-400"
              }>
                {t.status}
              </span>
              <span className="text-neutral-300">{t.asset}</span>
              <span>→</span>
              <AddressLink chainId={t.chain_id} address={t.beneficiary_address} />
            </div>
            {t.tx_hash ? (
              <TxLink chainId={t.chain_id} txHash={t.tx_hash} />
            ) : (
              <span className="text-neutral-600 text-[11px]">{t.reason ?? "no tx"}</span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 pt-3 border-t border-neutral-800 text-[11px] font-mono text-neutral-500 break-all">
        signature: {execution.agent_signature}
      </div>
    </div>
  );
}

function DryRunCard({ dryRun }: { dryRun: any }) {
  return (
    <div className="card">
      <h3 className="text-base font-medium mb-3">Dry-run preview</h3>
      <div className="text-xs text-neutral-500 mb-2">
        From: <span className="font-mono">{shortAddr(dryRun.agent_user_address)}</span>
      </div>
      {(dryRun.chains as any[]).map((c) => (
        <div key={c.chain_id} className="border-t border-neutral-800 pt-3 mt-3">
          <div className="text-sm font-medium">
            {c.chain_name} <span className="text-neutral-500 font-normal">· {c.chain_id}</span>
          </div>
          {c.error && <div className="text-xs text-red-400 mt-1">{c.error}</div>}
          {c.native_balance_wei && (
            <div className="text-xs text-neutral-500 mt-1">
              balance: {c.native_balance_wei} wei
            </div>
          )}
          {(c.distribution as any[] | undefined)?.map((b) => (
            <div key={b.address} className="text-xs flex justify-between mt-1">
              <span>{b.name} <span className="text-neutral-500">· {shortAddr(b.address)}</span></span>
              <span className="font-mono">{b.would_receive_wei} wei</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
