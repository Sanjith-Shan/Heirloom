/* Typed API client mirroring the FastAPI surface. */

const API_BASE = ""; // same-origin via vite proxy in dev, single container in prod

export interface Beneficiary {
  name: string;
  address: string;
  percentage: number;
  relationship?: string | null;
}

export interface EmergencyContact {
  name: string;
  email: string;
  relationship?: string | null;
}

export type Phase =
  | "ACTIVE"
  | "REMINDER"
  | "EMERGENCY_CONTACT"
  | "VERIFICATION"
  | "EXECUTION"
  | "COMPLETED"
  | "CANCELLED";

export interface Plan {
  id: string;
  wallet_address: string;
  user_email: string;
  beneficiaries: Beneficiary[];
  emergency_contacts: EmergencyContact[];
  heartbeat_interval_days: number;
  configured_chains: number[];
  current_phase: Phase;
  phase_entered_at: string;
  last_heartbeat_at: string | null;
  face_descriptor: number[] | null;
  created_at: string;
  updated_at: string;
}

export interface AuditEvent {
  id: number;
  plan_id: string;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface StatusResponse {
  plan_id: string;
  wallet_address: string;
  current_phase: Phase;
  phase_entered_at: string;
  next_phase_at: number;
  last_heartbeat_at: string | null;
  beneficiaries: Beneficiary[];
  configured_chains: number[];
  recent_events: AuditEvent[];
  agent_wallet_address: string;
  demo_mode: boolean;
}

export interface AnalysisResult {
  active_since_heartbeat: boolean;
  last_transaction_date: string | null;
  transaction_count_since_heartbeat: number;
  confidence_owner_active: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  reasoning: string;
  receipt_req_hash: string | null;
  receipt_out_hash: string | null;
  receipt_sig: string | null;
  eigendalink: string | null;
  model_id: string | null;
  chain_id: number | null;
  system_fingerprint: string | null;
  is_mocked: boolean;
}

async function jfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API_BASE + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`HTTP ${r.status}: ${text}`);
  }
  return r.json() as Promise<T>;
}

export const api = {
  health: () => jfetch<{ ok: boolean; agent_address: string; demo_mode: boolean }>("/api/health"),
  agentInfo: () => jfetch<{ agent_address: string; encryption_scheme: string }>("/api/agent-info"),

  createPlan: (req: {
    wallet_address: string;
    encrypted_seed: string;
    encryption_iv: string;
    encryption_key: string;
    beneficiaries: Beneficiary[];
    emergency_contacts: EmergencyContact[];
    user_email: string;
    heartbeat_interval_days: number;
    configured_chains: number[];
    face_descriptor?: number[];
  }) =>
    jfetch<Plan>("/api/plans", { method: "POST", body: JSON.stringify(req) }),
  getPlan: (id: string) => jfetch<Plan>(`/api/plans/${id}`),
  getActivePlan: () => jfetch<Plan>(`/api/plans`),

  status: (id: string) => jfetch<StatusResponse>(`/api/status/${id}`),
  heartbeats: (id: string) => jfetch<unknown[]>(`/api/status/${id}/heartbeats`),

  challenge: (id: string) =>
    jfetch<{ timestamp: number; message: string }>(`/api/heartbeat/${id}/challenge`),
  postHeartbeat: (
    id: string,
    body: { timestamp: number; selfie_hash: string; wallet_signature: string; face_match_distance?: number },
  ) =>
    jfetch<{ status: string; phase: string; phase_before: string }>(
      `/api/heartbeat/${id}`,
      { method: "POST", body: JSON.stringify(body) },
    ),

  director: {
    info: (key: string) =>
      jfetch<{ has_active_plan: boolean; plan_id: string | null; current_phase: string | null; demo_mode: boolean }>(
        `/api/director/info?key=${encodeURIComponent(key)}`,
      ),
    advance: (key: string) =>
      jfetch<{ transitioned: boolean; from?: string; to?: string; extended?: boolean }>(
        `/api/director/advance-phase?key=${encodeURIComponent(key)}`,
        { method: "POST" },
      ),
    requestHeartbeat: (key: string) =>
      jfetch<{ status: string }>(`/api/director/request-heartbeat?key=${encodeURIComponent(key)}`, { method: "POST" }),
    sendReminder: (key: string) =>
      jfetch<{ status: string }>(`/api/director/send-reminder?key=${encodeURIComponent(key)}`, { method: "POST" }),
    notifyContacts: (key: string) =>
      jfetch<{ status: string; results: unknown[] }>(`/api/director/notify-contacts?key=${encodeURIComponent(key)}`, { method: "POST" }),
    runAnalysis: (key: string) =>
      jfetch<{ analysis: AnalysisResult }>(`/api/director/run-analysis?key=${encodeURIComponent(key)}`, { method: "POST" }),
    dryRun: (key: string) =>
      jfetch<Record<string, unknown>>(`/api/director/dry-run?key=${encodeURIComponent(key)}`),
    execute: (key: string) =>
      jfetch<{ execution: Record<string, unknown> }>(`/api/director/execute?key=${encodeURIComponent(key)}`, { method: "POST" }),
    reset: (key: string) =>
      jfetch<{ status: string }>(`/api/director/reset?key=${encodeURIComponent(key)}`, { method: "POST" }),
    cancelPlan: (key: string) =>
      jfetch<{ status: string }>(`/api/director/cancel-plan?key=${encodeURIComponent(key)}`, { method: "POST" }),
  },
};
