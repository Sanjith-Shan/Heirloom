import { isMockMode } from "@/lib/api";

const REAL_URL = "http://34.44.247.6:8080";

export function MockBanner() {
  if (!isMockMode()) return null;
  return (
    <div className="bg-amber-500 text-black text-xs px-4 py-1.5 text-center font-medium">
      <span className="uppercase tracking-wider mr-2">Demo Mock Mode</span>
      <span className="opacity-80">
        Instant responses, no live calls.{" "}
        <a
          href={REAL_URL}
          target="_blank"
          rel="noreferrer"
          className="underline font-semibold"
        >
          Real version (live in TEE) →
        </a>
      </span>
    </div>
  );
}
