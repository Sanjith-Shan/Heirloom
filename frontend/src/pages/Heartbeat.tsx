import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import { api, isMockMode } from "@/lib/api";
import { localPlanId } from "@/lib/utils";
import { FACE_MATCH_THRESHOLD, descriptorDistance, isMatch } from "@/lib/faceMatch";
import CameraCapture from "@/components/CameraCapture";

type Step = "ready" | "selfie-taken" | "signing" | "submitted" | "success";

interface FaceMatchState {
  distance: number;
  matched: boolean;
}

export default function Heartbeat() {
  const nav = useNavigate();
  const [planId, setPlanId] = useState<string | null>(null);
  const [referenceDescriptor, setReferenceDescriptor] = useState<number[] | null>(null);
  const [faceEnabled, setFaceEnabled] = useState(false);

  const [step, setStep] = useState<Step>("ready");
  const [selfieHash, setSelfieHash] = useState<string | null>(null);
  const [faceMatch, setFaceMatch] = useState<FaceMatchState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let pid = localPlanId();
    async function load() {
      try {
        if (!pid) {
          const p = await api.getActivePlan();
          pid = p.id;
        }
        setPlanId(pid!);
        const plan = await api.getPlan(pid!);
        if (plan.face_descriptor && plan.face_descriptor.length > 0) {
          setReferenceDescriptor(plan.face_descriptor);
          setFaceEnabled(true);
        }
      } catch (e: any) {
        setError(e?.message || "No active plan");
      }
    }
    load();
  }, []);

  async function handleCapture({
    hash,
    descriptor,
    faceDetected,
  }: {
    hash: string;
    descriptor: Float32Array | null;
    faceDetected: boolean;
  }) {
    setSelfieHash(hash);

    if (faceEnabled && referenceDescriptor) {
      if (!faceDetected || !descriptor) {
        setError("No face detected — please re-take with better lighting.");
        setStep("ready");
        return;
      }
      const distance = descriptorDistance(referenceDescriptor, descriptor);
      const matched = isMatch(distance);
      setFaceMatch({ distance, matched });
    } else {
      setFaceMatch(null);
    }

    setError(null);
    setStep("selfie-taken");
  }

  async function signAndSubmit() {
    if (!planId || !selfieHash) return;
    setError(null);
    setStep("signing");
    try {
      const challenge = await api.challenge(planId);

      if (!(window as any).ethereum) {
        throw new Error("No injected wallet found. Install MetaMask or use a wallet-enabled browser.");
      }
      const provider = new ethers.BrowserProvider((window as any).ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const signature = await signer.signMessage(challenge.message);

      setStep("submitted");
      const res = await api.postHeartbeat(planId, {
        timestamp: challenge.timestamp,
        selfie_hash: selfieHash,
        wallet_signature: signature,
        face_match_distance: faceMatch?.distance,
      });
      if (res.status === "ok") {
        setStep("success");
        setTimeout(() => nav("/dashboard"), 1500);
      } else {
        throw new Error(JSON.stringify(res));
      }
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || String(e));
      setStep("selfie-taken");
    }
  }

  // Mock mode: skip camera + wallet entirely. One button → success → dashboard.
  async function mockOneClickHeartbeat() {
    if (!planId) return;
    setStep("submitted");
    const fakeHash = "9b74c9897bac770ffc029102a200c5de37d8e9bafa97d0e3b9ad3c2f5f9c1a3e";
    setSelfieHash(fakeHash);
    await api.postHeartbeat(planId, {
      timestamp: Math.floor(Date.now() / 1000),
      selfie_hash: fakeHash,
      wallet_signature: "0x" + "f".repeat(130),
    });
    setStep("success");
    setTimeout(() => nav("/dashboard?mock=1"), 1200);
  }

  return (
    <div className="container-narrow py-12">
      <h1 className="text-3xl font-semibold tracking-tight mb-2">Check in</h1>
      <p className="text-neutral-400 mb-8">
        Take a selfie and sign with your wallet. Your photo never leaves your device — only
        its SHA-256 hash{faceEnabled ? ", a face-match score," : ""} and your wallet signature are sent to the agent.
      </p>

      <div className="card">
        {isMockMode() && step === "ready" && (
          <div className="space-y-4">
            <div className="rounded-md bg-amber-950/20 border border-amber-800/40 p-3 text-sm">
              <span className="text-amber-300 font-medium">Demo mode:</span> one click captures a fake selfie and skips wallet signing.
            </div>
            <button className="btn-primary w-full" onClick={mockOneClickHeartbeat}>
              Take demo selfie & check in
            </button>
          </div>
        )}

        {!isMockMode() && step === "ready" && <CameraCapture extractDescriptor={faceEnabled} onCapture={handleCapture} />}

        {step === "selfie-taken" && (
          <div className="space-y-4">
            <div className="rounded-md bg-neutral-900 border border-neutral-800 p-3 text-sm">
              Selfie captured. Hash: <span className="font-mono text-xs">{selfieHash?.slice(0, 32)}…</span>
            </div>

            {faceMatch && <FaceMatchBanner match={faceMatch} />}

            <p className="text-sm text-neutral-400">
              Now sign the heartbeat challenge with your wallet to prove identity.
            </p>
            {error && <div className="text-sm text-red-400">{error}</div>}
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => setStep("ready")}>Re-take</button>
              <button className="btn-primary" onClick={signAndSubmit}>
                Sign with wallet
              </button>
            </div>
          </div>
        )}

        {step === "signing" && <Spinner label="Open your wallet to sign…" />}
        {step === "submitted" && <Spinner label="Submitting heartbeat…" />}
        {step === "success" && (
          <div className="text-center py-8">
            <div className="mx-auto h-16 w-16 rounded-full bg-emerald-500/20 grid place-items-center mb-3">
              <span className="text-3xl">✓</span>
            </div>
            <div className="text-xl font-semibold">Heartbeat received</div>
            <div className="text-sm text-neutral-400 mt-1">Your plan is back to <strong>Active</strong>.</div>
            {faceMatch?.matched && (
              <div className="text-xs text-emerald-400 mt-2">Identity confirmed</div>
            )}
          </div>
        )}
      </div>

      <div className="mt-6 text-xs text-neutral-500">
        <Link to="/dashboard" className="hover:text-white">← back to dashboard</Link>
      </div>
    </div>
  );
}

function FaceMatchBanner({ match }: { match: FaceMatchState }) {
  if (match.matched) {
    return (
      <div className="rounded-md bg-emerald-950/30 border border-emerald-800 p-3 flex items-center gap-3 animate-[pulse_2s_ease-in-out]">
        <div className="h-8 w-8 rounded-full bg-emerald-500/30 grid place-items-center text-emerald-300 text-lg">✓</div>
        <div>
          <div className="font-medium text-emerald-200">Identity confirmed</div>
          <div className="text-xs text-neutral-400 font-mono">
            distance {match.distance.toFixed(3)} &lt; threshold {FACE_MATCH_THRESHOLD}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-md bg-amber-950/30 border border-amber-800 p-3 flex items-center gap-3">
      <div className="h-8 w-8 rounded-full bg-amber-500/30 grid place-items-center text-amber-300 text-lg">!</div>
      <div>
        <div className="font-medium text-amber-200">Face does not match reference</div>
        <div className="text-xs text-neutral-400 font-mono">
          distance {match.distance.toFixed(3)} ≥ threshold {FACE_MATCH_THRESHOLD}
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          You can still submit; the mismatch is recorded in the audit trail. Re-take if this looks wrong.
        </div>
      </div>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-8 justify-center">
      <div className="h-5 w-5 rounded-full border-2 border-neutral-700 border-t-white animate-spin" />
      <span className="text-sm text-neutral-400">{label}</span>
    </div>
  );
}
