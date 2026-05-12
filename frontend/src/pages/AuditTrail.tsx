import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, AuditEvent, StatusResponse } from "@/lib/api";
import { localPlanId, formatTimestamp, shortAddr } from "@/lib/utils";
import { TxLink, AddressLink } from "@/components/TxLink";

const KIND_COLOR: Record<string, string> = {
  PLAN_CREATED: "bg-emerald-500/15 text-emerald-300",
  HEARTBEAT: "bg-emerald-500/15 text-emerald-300",
  PHASE_TRANSITION: "bg-amber-500/15 text-amber-300",
  NOTIFICATION_SENT: "bg-blue-500/15 text-blue-300",
  EIGENAI_ANALYSIS: "bg-purple-500/15 text-purple-300",
  EXTENSION: "bg-emerald-500/15 text-emerald-300",
  EXECUTION: "bg-red-500/15 text-red-300",
  EXECUTION_ERROR: "bg-red-500/15 text-red-300",
  DIRECTOR_ACTION: "bg-neutral-800 text-neutral-300",
};

export default function AuditTrail() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
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
        if (!cancelled) setError(e.message);
      }
    }
    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (error && !status) {
    return (
      <div className="container-narrow py-16 text-center">
        <h1 className="text-2xl font-semibold mb-2">No plan to audit</h1>
        <Link to="/setup" className="btn-primary">Set up your plan</Link>
      </div>
    );
  }
  if (!status) return <div className="container-wide py-16 text-neutral-400">Loading…</div>;

  return (
    <div className="container-narrow py-12">
      <h1 className="text-3xl font-semibold tracking-tight mb-2">Audit trail</h1>
      <p className="text-neutral-400 mb-8">
        Every heartbeat, every phase transition, every EigenAI analysis, every transfer.
        Each entry is signed by the agent's TEE wallet — anyone can verify on the
        verification page.
      </p>

      <div className="space-y-3">
        {status.recent_events.map((e) => <EventRow key={e.id} e={e} />)}
      </div>
    </div>
  );
}

function EventRow({ e }: { e: AuditEvent }) {
  const [open, setOpen] = useState(false);
  const transfers = (e.kind === "EXECUTION" && Array.isArray((e.payload as any).transfers))
    ? (e.payload as any).transfers as any[]
    : null;

  return (
    <div className="card">
      <button
        className="w-full text-left"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-baseline justify-between mb-2">
          <span className={"badge " + (KIND_COLOR[e.kind] ?? "bg-neutral-800 text-neutral-300")}>
            {e.kind}
          </span>
          <span className="text-xs text-neutral-500">{formatTimestamp(e.created_at)}</span>
        </div>
        <div className="text-sm">{summarize(e)}</div>
      </button>

      {transfers && transfers.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {transfers.map((t: any, i: number) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-neutral-400">
                <span className={
                  t.status === "sent" ? "text-emerald-400" :
                  t.status === "skipped" ? "text-neutral-500" : "text-red-400"
                }>
                  {t.status}
                </span>
                <span>{t.asset}</span>
                <span>→</span>
                <AddressLink chainId={t.chain_id} address={t.beneficiary_address} />
              </div>
              {t.tx_hash ? (
                <TxLink chainId={t.chain_id} txHash={t.tx_hash} />
              ) : (
                <span className="text-neutral-600 text-[11px]">{t.reason ?? ""}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {open && (
        <pre className="mt-3 text-[11px] font-mono whitespace-pre-wrap text-neutral-400 bg-neutral-950 p-3 rounded border border-neutral-800 overflow-x-auto">
          {JSON.stringify(e.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

function summarize(e: AuditEvent): string {
  const p = e.payload as any;
  if (e.kind === "PHASE_TRANSITION") return `${p.from} → ${p.to}`;
  if (e.kind === "HEARTBEAT") return `phase before: ${p.phase_before}`;
  if (e.kind === "NOTIFICATION_SENT") return p.kind ?? "notification";
  if (e.kind === "EIGENAI_ANALYSIS") return `confidence ${p.confidence_owner_active} (${p.is_mocked ? "mocked" : "live"})`;
  if (e.kind === "EXECUTION") return `${p.transfer_count} transfer(s) signed by ${shortAddr(p.agent_address)}`;
  if (e.kind === "PLAN_CREATED") return `wallet ${shortAddr(p.wallet_address)} • ${p.beneficiary_count} beneficiary(ies)`;
  if (e.kind === "DIRECTOR_ACTION") return p.action;
  return JSON.stringify(p).slice(0, 120);
}
