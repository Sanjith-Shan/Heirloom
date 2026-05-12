import { useEffect, useState } from "react";
import { timeUntil } from "@/lib/utils";

export default function CountdownTimer({ targetUnix }: { targetUnix: number }) {
  const [now, setNow] = useState(Date.now() / 1000);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);

  const remaining = targetUnix - now;
  const isPast = remaining <= 0;
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-neutral-500">
        {isPast ? "Phase ready to advance" : "Time until next phase"}
      </div>
      <div className="text-3xl font-mono mt-1">
        {isPast ? "—" : timeUntil(targetUnix)}
      </div>
    </div>
  );
}
