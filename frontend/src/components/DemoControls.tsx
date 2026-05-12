/* Inline phase-advance controls for the Dashboard, shown only in mock mode.
 * Replaces the separate Director Dashboard for the live presentation —
 * everything happens on one screen, no tab-switching, no key entry.
 */

import { useState } from "react";
import { api, Phase, isMockMode } from "@/lib/api";

const KEY = "demo-secret-2026";

interface Step {
  label: string;
  hint: string;
  phaseAfter: Phase;
  action: () => Promise<void>;
}

export default function DemoControls({
  currentPhase,
  onChange,
}: {
  currentPhase: Phase;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  if (!isMockMode()) return null;

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    try {
      await fn();
      onChange();
    } finally {
      setBusy(null);
    }
  }

  const steps: Step[] = [
    {
      label: "1 · Skip 30 days → REMINDER",
      hint: "Owner missed the 30-day window. Reminder email goes out.",
      phaseAfter: "REMINDER",
      action: async () => {
        await api.director.advance(KEY);
        await api.director.sendReminder(KEY);
      },
    },
    {
      label: "2 · → EMERGENCY_CONTACT",
      hint: "Still nothing. Family + lawyer get notified.",
      phaseAfter: "EMERGENCY_CONTACT",
      action: async () => {
        await api.director.advance(KEY);
        await api.director.notifyContacts(KEY);
      },
    },
    {
      label: "3 · → VERIFICATION (run AI)",
      hint: "Final check: language model analyzes recent on-chain activity.",
      phaseAfter: "VERIFICATION",
      action: async () => {
        await api.director.advance(KEY);
        await api.director.runAnalysis(KEY);
      },
    },
    {
      label: "4 · → EXECUTE distribution",
      hint: "Agent unseals seed inside TEE, broadcasts transfers to beneficiaries.",
      phaseAfter: "EXECUTION",
      action: async () => {
        await api.director.advance(KEY);
        await api.director.execute(KEY);
      },
    },
  ];

  // Find the next step that isn't already "done"
  const phaseOrder: Phase[] = ["ACTIVE", "REMINDER", "EMERGENCY_CONTACT", "VERIFICATION", "EXECUTION", "COMPLETED"];
  const currentIdx = phaseOrder.indexOf(currentPhase);

  return (
    <div className="card border-amber-700/40 bg-amber-950/10">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-amber-300">
            Demo controls
          </div>
          <div className="text-xs text-neutral-400 mt-0.5">
            Click each in order. Each click triggers the real action and updates the state.
          </div>
        </div>
        <button
          onClick={() => run("reset", async () => {
            await api.director.reset(KEY);
          })}
          className="text-xs text-neutral-400 hover:text-white px-2 py-1 rounded border border-neutral-800"
          disabled={!!busy}
        >
          ↺ Reset
        </button>
      </div>

      <div className="space-y-2">
        {steps.map((s, i) => {
          const stepIdx = phaseOrder.indexOf(s.phaseAfter);
          const isDone = currentIdx >= stepIdx;
          const isNext = currentIdx === stepIdx - 1;
          return (
            <button
              key={s.label}
              onClick={() => run(s.label, s.action)}
              disabled={!!busy || isDone}
              className={
                "w-full text-left rounded-md border p-3 transition " +
                (isDone
                  ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-300/80 cursor-default"
                  : isNext
                  ? "bg-amber-500 border-amber-500 text-black hover:bg-amber-400"
                  : "bg-neutral-900 border-neutral-800 text-neutral-300 hover:bg-neutral-800")
              }
            >
              <div className="flex items-center justify-between">
                <div className="font-medium text-sm">
                  {isDone && "✓ "}
                  {s.label}
                </div>
                {busy === s.label && (
                  <div className="h-3 w-3 rounded-full border-2 border-neutral-600 border-t-current animate-spin" />
                )}
              </div>
              <div className={"text-xs mt-0.5 " + (isNext ? "text-black/70" : "text-neutral-500")}>
                {s.hint}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
