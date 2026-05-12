import { AuditEvent } from "@/lib/api";
import { formatTimestamp } from "@/lib/utils";

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

export default function EventLog({ events, max = 20 }: { events: AuditEvent[]; max?: number }) {
  const items = events.slice(0, max);
  if (items.length === 0) {
    return <div className="text-sm text-neutral-500">No events yet.</div>;
  }
  return (
    <ul className="space-y-2">
      {items.map((e) => (
        <li key={e.id} className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
          <div className="flex items-baseline justify-between mb-1">
            <span className={"badge " + (KIND_COLOR[e.kind] ?? "bg-neutral-800 text-neutral-300")}>
              {e.kind}
            </span>
            <span className="text-xs text-neutral-500">{formatTimestamp(e.created_at)}</span>
          </div>
          <pre className="mono text-[11px] whitespace-pre-wrap break-words">
            {summary(e)}
          </pre>
        </li>
      ))}
    </ul>
  );
}

function summary(e: AuditEvent): string {
  const p = e.payload as any;
  if (e.kind === "PHASE_TRANSITION") return `${p.from} → ${p.to}`;
  if (e.kind === "HEARTBEAT") return `phase_before=${p.phase_before} selfie=${(p.selfie_hash || "").slice(0, 12)}…`;
  if (e.kind === "NOTIFICATION_SENT") return `${p.kind} ${p.results ? `→ ${p.results.length} contact(s)` : `→ ${p.to ?? "user"}`}`;
  if (e.kind === "EIGENAI_ANALYSIS") return `${p.confidence_owner_active} (active=${p.active_since_heartbeat}, mocked=${p.is_mocked})`;
  if (e.kind === "EXECUTION") return `${p.transfer_count} transfer(s) signed by agent ${(p.agent_address ?? "").slice(0, 10)}…`;
  if (e.kind === "DIRECTOR_ACTION") return p.action;
  if (e.kind === "PLAN_CREATED") return `wallet=${(p.wallet_address || "").slice(0, 10)}… interval=${p.interval_days}d`;
  return JSON.stringify(p).slice(0, 200);
}
