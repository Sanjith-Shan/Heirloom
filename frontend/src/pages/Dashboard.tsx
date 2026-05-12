import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, StatusResponse } from "@/lib/api";
import { chainName, localPlanId, shortAddr } from "@/lib/utils";
import PhaseIndicator from "@/components/PhaseIndicator";
import CountdownTimer from "@/components/CountdownTimer";
import EventLog from "@/components/EventLog";

export default function Dashboard() {
  const nav = useNavigate();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let pid = localPlanId();
    let cancelled = false;
    async function load() {
      try {
        if (!pid) {
          // Try active plan as fallback (single-plan demo)
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
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (error && !status) {
    return (
      <div className="container-narrow py-16 text-center">
        <h1 className="text-2xl font-semibold mb-2">No plan yet</h1>
        <p className="text-neutral-400 mb-6">Create your inheritance plan to start.</p>
        <Link to="/setup" className="btn-primary">Set up your plan</Link>
      </div>
    );
  }

  if (!status) return <div className="container-wide py-16 text-neutral-400">Loading…</div>;

  return (
    <div className="container-wide py-12 grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <div className="card">
          <PhaseIndicator phase={status.current_phase} />
          <div className="mt-6 grid grid-cols-2 gap-6">
            <CountdownTimer targetUnix={status.next_phase_at} />
            <div>
              <div className="text-xs uppercase tracking-wider text-neutral-500">Last heartbeat</div>
              <div className="mt-1 text-base">
                {status.last_heartbeat_at
                  ? new Date(status.last_heartbeat_at).toLocaleString()
                  : "—"}
              </div>
              <button
                onClick={() => nav("/heartbeat")}
                className="mt-3 btn-primary"
              >
                I'm here — check in
              </button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-medium">Audit trail</h2>
            <Link to="/audit" className="text-xs text-neutral-400 hover:text-white">view all →</Link>
          </div>
          <EventLog events={status.recent_events} max={10} />
        </div>
      </div>

      <aside className="space-y-6">
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">Wallet</div>
          <div className="font-mono text-sm break-all">{status.wallet_address}</div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">Agent identity</div>
          <div className="font-mono text-sm break-all">{shortAddr(status.agent_wallet_address)}</div>
          <div className="text-xs text-neutral-500 mt-1">
            Stable, deterministic from your app ID. Anyone can verify any signed receipt by recovering this address.
          </div>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">Beneficiaries</div>
          <ul className="space-y-2">
            {status.beneficiaries.map((b) => (
              <li key={b.address} className="text-sm flex justify-between">
                <span>
                  {b.name || "—"}
                  <span className="text-neutral-500"> · {shortAddr(b.address)}</span>
                </span>
                <span className="font-mono">{b.percentage}%</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card">
          <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">Monitored chains</div>
          <ul className="space-y-1 text-sm">
            {status.configured_chains.map((c) => (
              <li key={c}>{chainName(c)} <span className="text-neutral-500">({c})</span></li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
