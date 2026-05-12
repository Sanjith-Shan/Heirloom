import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import { api, Beneficiary, EmergencyContact, isMockMode } from "@/lib/api";
import { encryptSeed } from "@/lib/crypto";
import { descriptorToArray } from "@/lib/faceMatch";
import { setLocalPlanId, shortAddr } from "@/lib/utils";
import CameraCapture from "@/components/CameraCapture";

const SUPPORTED_CHAINS: { id: number; name: string }[] = [
  { id: 84532, name: "Base Sepolia (testnet)" },
  { id: 11155111, name: "Sepolia (testnet)" },
  { id: 8453, name: "Base (mainnet)" },
  { id: 1, name: "Ethereum (mainnet)" },
];

const blankBeneficiary = (): Beneficiary => ({ name: "", address: "", percentage: 0 });
const blankContact = (): EmergencyContact => ({ name: "", email: "" });

export default function Setup() {
  const nav = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  const [seedPhrase, setSeedPhrase] = useState("");
  const [derivedAddress, setDerivedAddress] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);

  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([
    { name: "", address: "", percentage: 100 },
  ]);
  const [contacts, setContacts] = useState<EmergencyContact[]>([blankContact()]);

  const [interval, setInterval] = useState(30);
  const [chains, setChains] = useState<number[]>([84532]);
  const [userEmail, setUserEmail] = useState("");

  const [faceDescriptor, setFaceDescriptor] = useState<number[] | null>(null);
  const [faceCaptureError, setFaceCaptureError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In mock mode, pre-fill every field so the user only has to click Next.
  useEffect(() => {
    if (!isMockMode()) return;
    const demoSeed = "crew render spare response usual atom alpha provide eyebrow amazing dawn crumble";
    setSeedPhrase(demoSeed);
    try {
      setDerivedAddress(ethers.Wallet.fromPhrase(demoSeed).address);
    } catch {/* ignore */}
    setBeneficiaries([
      { name: "Alice Yamamoto (spouse)", address: "0xa39c11ae6cd8f7a0c6f9eebe4d8d8b7f0a2d9a31", percentage: 60, relationship: "spouse" },
      { name: "Children's Hospital Foundation", address: "0x4c5e8b9a2d1f3c4e6b7d8a9c0f1b2d3e4a5c6d7e", percentage: 40, relationship: "charity" },
    ]);
    setContacts([
      { name: "Jane Doe", email: "jane@example.com", relationship: "lawyer" },
      { name: "Marcus Chen", email: "marcus@example.com", relationship: "brother" },
    ]);
    setUserEmail("owner@example.com");
    setInterval(30);
    setChains([84532]);
  }, []);

  function validateSeed(s: string): boolean {
    setSeedError(null);
    setDerivedAddress(null);
    const words = s.trim().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      setSeedError("Seed phrase must be 12 or 24 words");
      return false;
    }
    try {
      const wallet = ethers.Wallet.fromPhrase(s.trim());
      setDerivedAddress(wallet.address);
      return true;
    } catch (e: any) {
      setSeedError("Invalid seed phrase: " + (e.message || e));
      return false;
    }
  }

  const totalPct = beneficiaries.reduce((acc, b) => acc + (Number(b.percentage) || 0), 0);
  const allBenAddrsOk = beneficiaries.every((b) => /^0x[a-fA-F0-9]{40}$/.test(b.address));
  const benReady = beneficiaries.length > 0 && Math.abs(totalPct - 100) < 0.01 && allBenAddrsOk &&
                   beneficiaries.every((b) => b.name.trim());
  const contactsReady = contacts.length > 0 &&
                        contacts.every((c) => c.name.trim() && /^[^@]+@[^@]+\.[^@]+$/.test(c.email));
  const userEmailOk = /^[^@]+@[^@]+\.[^@]+$/.test(userEmail);

  async function handleSubmit() {
    if (!derivedAddress) return;
    setSubmitting(true);
    setError(null);
    try {
      const envelope = await encryptSeed(seedPhrase.trim());
      const plan = await api.createPlan({
        wallet_address: derivedAddress,
        ...envelope,
        beneficiaries: beneficiaries.map((b) => ({ ...b, percentage: Number(b.percentage) })),
        emergency_contacts: contacts,
        user_email: userEmail,
        heartbeat_interval_days: interval,
        configured_chains: chains,
        face_descriptor: faceDescriptor ?? undefined,
      });
      setLocalPlanId(plan.id);
      nav("/dashboard");
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container-narrow py-12">
      <h1 className="text-3xl font-semibold tracking-tight mb-2">Create your plan</h1>
      <p className="text-neutral-400 mb-8">
        Your seed phrase is encrypted in your browser before it leaves your device. The
        agent decrypts it once, inside the TEE, and seals it with a key that only exists
        inside the enclave.
      </p>

      <Stepper step={step} />

      {step === 1 && (
        <div className="card space-y-4">
          <div>
            <label className="label">Seed phrase (12 or 24 words)</label>
            <textarea
              className="input mt-2 h-28 font-mono"
              placeholder="abandon abandon abandon abandon …"
              value={seedPhrase}
              onChange={(e) => {
                setSeedPhrase(e.target.value);
                if (e.target.value.trim()) validateSeed(e.target.value);
                else setDerivedAddress(null);
              }}
            />
          </div>
          {seedError && <div className="text-sm text-red-400">{seedError}</div>}
          {derivedAddress && (
            <div className="rounded-md bg-neutral-900 border border-neutral-800 p-3 text-sm">
              Derived wallet: <span className="font-mono">{derivedAddress}</span>
            </div>
          )}
          <div className="flex justify-end">
            <button
              className="btn-primary"
              disabled={!derivedAddress}
              onClick={() => setStep(2)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card space-y-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="label">Beneficiaries</label>
              <button
                className="text-xs text-neutral-300 hover:text-white"
                onClick={() => setBeneficiaries([...beneficiaries, blankBeneficiary()])}
              >
                + add
              </button>
            </div>
            <div className="space-y-3">
              {beneficiaries.map((b, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <input
                    className="input col-span-3"
                    placeholder="Name"
                    value={b.name}
                    onChange={(e) => updateBen(i, { name: e.target.value })}
                  />
                  <input
                    className="input col-span-6 font-mono text-xs"
                    placeholder="0x…"
                    value={b.address}
                    onChange={(e) => updateBen(i, { address: e.target.value })}
                  />
                  <div className="col-span-2 relative">
                    <input
                      className="input pr-7"
                      type="number"
                      min={0}
                      max={100}
                      value={b.percentage}
                      onChange={(e) => updateBen(i, { percentage: Number(e.target.value) })}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500">%</span>
                  </div>
                  <button
                    className="col-span-1 text-neutral-500 hover:text-red-400"
                    onClick={() => removeBen(i)}
                    disabled={beneficiaries.length === 1}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className={"text-xs mt-2 " + (Math.abs(totalPct - 100) < 0.01 ? "text-emerald-400" : "text-red-400")}>
              Total: {totalPct.toFixed(2)}% (must equal 100)
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="label">Emergency contacts</label>
              <button
                className="text-xs text-neutral-300 hover:text-white"
                onClick={() => setContacts([...contacts, blankContact()])}
              >
                + add
              </button>
            </div>
            <div className="space-y-3">
              {contacts.map((c, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <input
                    className="input col-span-3"
                    placeholder="Name"
                    value={c.name}
                    onChange={(e) => updateContact(i, { name: e.target.value })}
                  />
                  <input
                    className="input col-span-5"
                    placeholder="email@example.com"
                    value={c.email}
                    onChange={(e) => updateContact(i, { email: e.target.value })}
                  />
                  <input
                    className="input col-span-3"
                    placeholder="Relationship (optional)"
                    value={c.relationship ?? ""}
                    onChange={(e) => updateContact(i, { relationship: e.target.value })}
                  />
                  <button
                    className="col-span-1 text-neutral-500 hover:text-red-400"
                    onClick={() => removeContact(i)}
                    disabled={contacts.length === 1}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between">
            <button className="btn-secondary" onClick={() => setStep(1)}>Back</button>
            <button
              className="btn-primary"
              disabled={!benReady || !contactsReady}
              onClick={() => setStep(3)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card space-y-6">
          <div>
            <label className="label">Your email (for reminders)</label>
            <input
              className="input mt-2"
              placeholder="you@example.com"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Heartbeat interval</label>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {[30, 60, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setInterval(d)}
                  className={
                    "rounded-md py-3 border text-sm " +
                    (interval === d
                      ? "bg-white text-black border-white"
                      : "bg-neutral-950 border-neutral-800 hover:border-neutral-700")
                  }
                >
                  every {d} days
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Chains to monitor</label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {SUPPORTED_CHAINS.map((c) => {
                const on = chains.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() =>
                      setChains(on ? chains.filter((x) => x !== c.id) : [...chains, c.id])
                    }
                    className={
                      "rounded-md py-2 px-3 border text-sm text-left " +
                      (on
                        ? "bg-neutral-900 border-emerald-500/50"
                        : "bg-neutral-950 border-neutral-800 hover:border-neutral-700")
                    }
                  >
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-neutral-500">chain id {c.id}</div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex justify-between">
            <button className="btn-secondary" onClick={() => setStep(2)}>Back</button>
            <button
              className="btn-primary"
              disabled={!userEmailOk || chains.length === 0}
              onClick={() => setStep(4)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="card space-y-4">
          <h3 className="text-lg font-medium">Reference selfie</h3>
          <p className="text-sm text-neutral-400">
            Take one photo to anchor your identity. We extract a 128-d face descriptor
            in your browser; the photo never leaves your device. The descriptor is
            stored alongside your plan so future heartbeats can confirm it's really you.
          </p>
          {!faceDescriptor && (
            <CameraCapture
              extractDescriptor
              onCapture={({ descriptor, faceDetected }) => {
                if (!faceDetected || !descriptor) {
                  setFaceCaptureError("No face detected — please try again with better lighting.");
                  return;
                }
                setFaceCaptureError(null);
                setFaceDescriptor(descriptorToArray(descriptor));
              }}
            />
          )}
          {faceCaptureError && <div className="text-sm text-red-400">{faceCaptureError}</div>}
          {faceDescriptor && (
            <div className="rounded-md bg-emerald-950/30 border border-emerald-800 p-3 text-sm flex items-center gap-3">
              <div className="h-7 w-7 rounded-full bg-emerald-500/30 grid place-items-center text-emerald-300">✓</div>
              <div>
                <div className="font-medium">Reference face captured</div>
                <div className="text-xs text-neutral-400">
                  128-d descriptor recorded · photo discarded · {faceDescriptor.length} dimensions
                </div>
              </div>
              <button
                className="ml-auto text-xs text-neutral-400 hover:text-white"
                onClick={() => setFaceDescriptor(null)}
              >
                Re-take
              </button>
            </div>
          )}
          <div className="text-xs text-neutral-500">
            Skipping is allowed — heartbeats will still validate by wallet signature alone.
          </div>
          <div className="flex justify-between">
            <button className="btn-secondary" onClick={() => setStep(3)} disabled={submitting}>
              Back
            </button>
            <div className="flex gap-2">
              <button className="btn-secondary" onClick={() => { setFaceDescriptor(null); setStep(5); }}>
                Skip
              </button>
              <button className="btn-primary" disabled={!faceDescriptor} onClick={() => setStep(5)}>
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="card space-y-4">
          <h3 className="text-lg font-medium">Review & seal</h3>
          <Row k="Wallet" v={shortAddr(derivedAddress)} mono />
          <Row k="Beneficiaries" v={`${beneficiaries.length} • totals ${totalPct.toFixed(2)}%`} />
          <Row k="Emergency contacts" v={`${contacts.length}`} />
          <Row k="Heartbeat interval" v={`${interval} days`} />
          <Row k="Monitored chains" v={chains.length.toString()} />
          <Row k="Face matching" v={faceDescriptor ? "enabled (128-d descriptor stored)" : "skipped"} />
          {error && <div className="text-sm text-red-400">{error}</div>}
          <div className="flex justify-between pt-3 border-t border-neutral-800">
            <button className="btn-secondary" onClick={() => setStep(4)} disabled={submitting}>Back</button>
            <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Sealing seed…" : "Seal & activate"}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  function updateBen(i: number, patch: Partial<Beneficiary>) {
    setBeneficiaries(beneficiaries.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }
  function removeBen(i: number) {
    setBeneficiaries(beneficiaries.filter((_, j) => j !== i));
  }
  function updateContact(i: number, patch: Partial<EmergencyContact>) {
    setContacts(contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }
  function removeContact(i: number) {
    setContacts(contacts.filter((_, j) => j !== i));
  }
}

function Stepper({ step }: { step: number }) {
  const labels = ["Seed", "Beneficiaries", "Schedule", "Selfie", "Review"];
  return (
    <div className="flex items-center gap-2 mb-6 text-xs text-neutral-500">
      {labels.map((l, i) => (
        <div key={l} className="flex items-center gap-2">
          <span
            className={
              "h-6 w-6 rounded-full flex items-center justify-center text-[10px] " +
              (step > i + 1 ? "bg-emerald-500 text-black" : step === i + 1 ? "bg-white text-black" : "bg-neutral-800")
            }
          >
            {i + 1}
          </span>
          <span className={step === i + 1 ? "text-white" : ""}>{l}</span>
          {i < labels.length - 1 && <span className="mx-1">›</span>}
        </div>
      ))}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <div className="text-neutral-400">{k}</div>
      <div className={mono ? "font-mono" : ""}>{v}</div>
    </div>
  );
}
