import { Phase } from "@/lib/api";

const ORDER: Phase[] = ["ACTIVE", "REMINDER", "EMERGENCY_CONTACT", "VERIFICATION", "EXECUTION"];
const LABELS: Record<Phase, string> = {
  ACTIVE: "Active",
  REMINDER: "Reminder",
  EMERGENCY_CONTACT: "Emergency contact",
  VERIFICATION: "Verification",
  EXECUTION: "Execution",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
const COLORS: Record<Phase, string> = {
  ACTIVE: "bg-emerald-500",
  REMINDER: "bg-amber-400",
  EMERGENCY_CONTACT: "bg-orange-500",
  VERIFICATION: "bg-purple-500",
  EXECUTION: "bg-red-500",
  COMPLETED: "bg-neutral-700",
  CANCELLED: "bg-neutral-700",
};

export default function PhaseIndicator({ phase }: { phase: Phase }) {
  const idx = ORDER.indexOf(phase);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className={`h-3 w-3 rounded-full ${COLORS[phase]} ${phase === "EXECUTION" ? "animate-pulse" : ""}`} />
        <span className="text-2xl font-semibold tracking-tight">{LABELS[phase]}</span>
      </div>
      <div className="flex gap-2">
        {ORDER.map((p, i) => {
          const reached = idx >= i && idx >= 0;
          const current = idx === i;
          return (
            <div key={p} className="flex-1">
              <div
                className={
                  "h-1.5 rounded " +
                  (current ? COLORS[p] : reached ? "bg-neutral-300" : "bg-neutral-800")
                }
              />
              <div className={"text-[10px] mt-1.5 " + (current ? "text-white" : "text-neutral-500")}>
                {LABELS[p]}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
