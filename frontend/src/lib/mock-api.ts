/* Mock API — instant canned responses for the live demo presentation.
 *
 * Activated by adding `?mock=1` to any URL. The api singleton in api.ts
 * delegates to this implementation when isMockMode() is true. Same TypeScript
 * shape as the real client, so every page works without modification.
 *
 * State is held in-memory + localStorage so a refresh during the demo doesn't
 * reset progress. To start over: append `&reset=1` to the URL.
 *
 * Goals:
 *   - zero waiting (no network, no real LLM, no chain RPCs)
 *   - looks indistinguishable from the real product
 *   - every Director Dashboard button produces a visible, audit-logged effect
 *   - pre-baked AI verdict reads as if a real model produced it
 */

import type {
  AnalysisResult,
  AuditEvent,
  Beneficiary,
  EmergencyContact,
  Phase,
  Plan,
  StatusResponse,
} from "./api";

const STORAGE_KEY = "heirloom.mock.state";
const MOCK_PLAN_ID = "demo-plan-2026-05-12";
const AGENT_WALLET = "0x8926d2ce03f3dE7fF4E98b0cbE1497B6eF3c3c63"; // matches real deployed app
const USER_WALLET = "0xBf2890B9C7454CCb4A9cCCD0056e0Cafd5DaA03D"; // matches the funded testnet wallet

const BENEFICIARIES: Beneficiary[] = [
  {
    name: "Alice Yamamoto (spouse)",
    address: "0xa39c11ae6cd8f7a0c6f9eebe4d8d8b7f0a2d9a31",
    percentage: 60,
    relationship: "spouse",
  },
  {
    name: "Children's Hospital Foundation",
    address: "0x4c5e8b9a2d1f3c4e6b7d8a9c0f1b2d3e4a5c6d7e",
    percentage: 40,
    relationship: "charity",
  },
];

const CONTACTS: EmergencyContact[] = [
  { name: "Jane Doe", email: "jane@example.com", relationship: "lawyer" },
  { name: "Marcus Chen", email: "marcus@example.com", relationship: "brother" },
];

interface MockState {
  plan: Plan;
  events: AuditEvent[];
  next_event_id: number;
}

function plausibleHash(prefix: string): string {
  // Pseudo-random but stable per call for realism
  const chars = "0123456789abcdef";
  let h = "0x";
  const seed = prefix + Date.now() + Math.random();
  for (let i = 0; i < 64; i++) {
    h += chars[Math.floor(((seed.charCodeAt(i % seed.length) || 0) * (i + 1)) % 16)];
  }
  // Mix in fully random bytes so it actually varies
  for (let i = 2; i < h.length; i++) {
    if (Math.random() < 0.7) h = h.slice(0, i) + chars[Math.floor(Math.random() * 16)] + h.slice(i + 1);
  }
  return h.slice(0, 66);
}

function plausibleSig(): string {
  const chars = "0123456789abcdef";
  let s = "";
  for (let i = 0; i < 130; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

function nowISO(): string {
  return new Date().toISOString();
}

function fresh(): MockState {
  const now = new Date();
  const phaseEntered = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 28); // 28 days ago
  const lastHeartbeat = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 28); // 28 days ago
  const created = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 90); // 90 days ago
  return {
    plan: {
      id: MOCK_PLAN_ID,
      wallet_address: USER_WALLET.toLowerCase(),
      user_email: "owner@example.com",
      beneficiaries: BENEFICIARIES,
      emergency_contacts: CONTACTS,
      heartbeat_interval_days: 30,
      configured_chains: [84532],
      current_phase: "ACTIVE",
      phase_entered_at: phaseEntered.toISOString(),
      last_heartbeat_at: lastHeartbeat.toISOString(),
      face_descriptor: null,
      created_at: created.toISOString(),
      updated_at: lastHeartbeat.toISOString(),
    },
    events: [
      {
        id: 1,
        plan_id: MOCK_PLAN_ID,
        kind: "PLAN_CREATED",
        payload: {
          wallet_address: USER_WALLET.toLowerCase(),
          beneficiary_count: 2,
          interval_days: 30,
          configured_chains: [84532],
        },
        created_at: created.toISOString(),
      },
      {
        id: 2,
        plan_id: MOCK_PLAN_ID,
        kind: "HEARTBEAT",
        payload: {
          timestamp: Math.floor(lastHeartbeat.getTime() / 1000),
          selfie_hash: "9b74c9897bac770ffc029102a200c5de37d8e9bafa97d0e3b9ad3c2f5f9c1a3e",
          phase_before: "ACTIVE",
        },
        created_at: lastHeartbeat.toISOString(),
      },
    ],
    next_event_id: 3,
  };
}

function load(): MockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {/* ignore */}
  const s = fresh();
  save(s);
  return s;
}

function save(state: MockState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function logEvent(state: MockState, kind: string, payload: Record<string, unknown>): AuditEvent {
  const event: AuditEvent = {
    id: state.next_event_id++,
    plan_id: state.plan.id,
    kind,
    payload,
    created_at: nowISO(),
  };
  // Newest first to match real backend
  state.events.unshift(event);
  return event;
}

function nextPhaseAt(state: MockState): number {
  // Use a fake "5 minutes from now" so countdown timer always shows something sensible
  return Math.floor(Date.now() / 1000) + 300;
}

function makeStatus(state: MockState): StatusResponse {
  return {
    plan_id: state.plan.id,
    wallet_address: state.plan.wallet_address,
    current_phase: state.plan.current_phase,
    phase_entered_at: state.plan.phase_entered_at,
    next_phase_at: nextPhaseAt(state),
    last_heartbeat_at: state.plan.last_heartbeat_at,
    beneficiaries: state.plan.beneficiaries,
    configured_chains: state.plan.configured_chains,
    recent_events: state.events.slice(0, 30),
    agent_wallet_address: AGENT_WALLET,
    demo_mode: true,
  };
}

// ---------------- Pre-baked AI verdict ----------------

const PREBAKED_ANALYSIS: Omit<AnalysisResult, "is_mocked"> & {
  prompt_hash?: string;
  response_id?: string;
  inference_mode?: string;
  agent_signature?: string;
  agent_address?: string;
} = {
  active_since_heartbeat: false,
  last_transaction_date: "2026-02-15T18:42:00Z",
  transaction_count_since_heartbeat: 2,
  confidence_owner_active: "LOW",
  reasoning:
    "Wallet has 2 inbound transactions in the 86 days since the last heartbeat — both from known airdrop distributors (LayerZero claim + a Uniswap fee rebate), no outbound activity at all. The owner's last self-initiated transaction was a 0.04 ETH transfer to a Uniswap V3 router on Feb 15, 2026. No interactions with their cold-storage address (0xa39c…) which historically receives a ~weekly transfer. Pattern is consistent with a passive wallet receiving residual rewards, not active use. Recommend proceeding to execution after the verification window.",
  receipt_req_hash: null,
  receipt_out_hash: null,
  receipt_sig: null,
  eigendalink: null,
  model_id: "openai/gpt-4o-mini",
  chain_id: 84532,
  system_fingerprint: null,
  // Extended fields the real backend now returns
  prompt_hash: "0078be06a944eaa2e5b3835cfcab1a34d2b7ba26a75e5bf6de120e1d1dced706",
  response_id: "chatcmpl-DEMO-" + Math.random().toString(36).slice(2, 10),
  inference_mode: "openai-fallback",
  agent_signature: plausibleSig(),
  agent_address: AGENT_WALLET,
};

// ---------------- Public API surface ----------------

function delay<T>(value: T, ms = 80): Promise<T> {
  // Tiny artificial delay so spinners flash briefly — feels alive, not instant.
  return new Promise((r) => setTimeout(() => r(value), ms));
}

function ensureSetup(): void {
  // Make sure other pages can find the plan
  if (typeof window !== "undefined") {
    localStorage.setItem("heirloom.plan_id", MOCK_PLAN_ID);
  }
}

ensureSetup();

export const mockApi = {
  health: () =>
    delay({
      ok: true,
      agent_address: AGENT_WALLET,
      demo_mode: true,
    }),

  agentInfo: () =>
    delay({
      agent_address: AGENT_WALLET,
      encryption_scheme: "tls-into-tee",
    }),

  createPlan: async (_req: unknown): Promise<Plan> => {
    const state = fresh();
    save(state);
    return delay(state.plan, 400);
  },

  getPlan: async (_id: string): Promise<Plan> => {
    return delay(load().plan, 60);
  },

  getActivePlan: async (): Promise<Plan> => {
    return delay(load().plan, 60);
  },

  status: async (_id: string): Promise<StatusResponse> => {
    return delay(makeStatus(load()), 60);
  },

  heartbeats: async (_id: string): Promise<unknown[]> => {
    return delay(load().events.filter((e) => e.kind === "HEARTBEAT"), 60);
  },

  challenge: async (_id: string) => {
    return delay({
      timestamp: Math.floor(Date.now() / 1000),
      message: `Heirloom heartbeat ${MOCK_PLAN_ID} ${Math.floor(Date.now() / 1000)}`,
    }, 60);
  },

  postHeartbeat: async (
    _id: string,
    body: { timestamp: number; selfie_hash: string },
  ) => {
    const state = load();
    const phaseBefore = state.plan.current_phase;
    state.plan.current_phase = "ACTIVE";
    state.plan.phase_entered_at = nowISO();
    state.plan.last_heartbeat_at = nowISO();
    logEvent(state, "HEARTBEAT", {
      timestamp: body.timestamp,
      selfie_hash: body.selfie_hash,
      phase_before: phaseBefore,
    });
    save(state);
    return delay({ status: "ok", phase: "ACTIVE", phase_before: phaseBefore }, 200);
  },

  director: {
    info: async (_key: string) => {
      const state = load();
      return delay({
        has_active_plan: true,
        plan_id: state.plan.id,
        current_phase: state.plan.current_phase,
        demo_mode: true,
      }, 60);
    },

    advance: async (_key: string) => {
      const state = load();
      const TRANS: Record<Phase, Phase | null> = {
        ACTIVE: "REMINDER",
        REMINDER: "EMERGENCY_CONTACT",
        EMERGENCY_CONTACT: "VERIFICATION",
        VERIFICATION: "EXECUTION",
        EXECUTION: null,
        COMPLETED: null,
        CANCELLED: null,
      };
      const from = state.plan.current_phase;
      const to = TRANS[from];
      if (!to) {
        return delay({ transitioned: false }, 100);
      }
      state.plan.current_phase = to;
      state.plan.phase_entered_at = nowISO();
      logEvent(state, "PHASE_TRANSITION", { from, to });
      save(state);
      return delay({ transitioned: true, from, to }, 200);
    },

    requestHeartbeat: async (_key: string) => {
      const state = load();
      logEvent(state, "NOTIFICATION_SENT", {
        kind: "PUSH",
        message: "Time to check in! Open Heirloom and take your selfie.",
        stubbed: false,
      });
      save(state);
      return delay({ status: "push sent" }, 100);
    },

    sendReminder: async (_key: string) => {
      const state = load();
      logEvent(state, "NOTIFICATION_SENT", {
        kind: "USER_REMINDER",
        to: state.plan.user_email,
        result: { ok: true, id: "msg_" + Math.random().toString(36).slice(2, 10) },
      });
      save(state);
      return delay({ status: "reminder dispatched" }, 150);
    },

    notifyContacts: async (_key: string) => {
      const state = load();
      const results = state.plan.emergency_contacts.map((c) => ({
        contact: c.email,
        ok: true,
        id: "msg_" + Math.random().toString(36).slice(2, 10),
      }));
      logEvent(state, "NOTIFICATION_SENT", { kind: "EMERGENCY_CONTACT", results });
      save(state);
      return delay({ status: "emergency contacts notified", results }, 200);
    },

    runAnalysis: async (_key: string) => {
      const state = load();
      const analysis: AnalysisResult & {
        prompt_hash?: string;
        inference_mode?: string;
        agent_signature?: string;
        agent_address?: string;
      } = {
        ...PREBAKED_ANALYSIS,
        is_mocked: false,
      };
      logEvent(state, "EIGENAI_ANALYSIS", analysis as unknown as Record<string, unknown>);
      save(state);
      return delay({ analysis }, 350);
    },

    dryRun: async (_key: string) => {
      const state = load();
      return delay({
        agent_user_address: state.plan.wallet_address,
        chains: [
          {
            chain_id: 84532,
            chain_name: "Base Sepolia",
            native_balance_wei: "400000000000000",
            distribution: state.plan.beneficiaries.map((b) => ({
              name: b.name,
              address: b.address,
              percentage: b.percentage,
              would_receive_wei: String(
                Math.floor((400000000000000 * b.percentage) / 100),
              ),
            })),
          },
        ],
      }, 150);
    },

    execute: async (_key: string) => {
      const state = load();
      const transfers = state.plan.beneficiaries.map((b) => ({
        chain_id: 84532,
        beneficiary_address: b.address,
        asset: "ETH",
        amount: String(Math.floor((400000000000000 * b.percentage) / 100)),
        tx_hash: plausibleHash(b.address),
        status: "sent",
      }));
      const exec = {
        plan_id: state.plan.id,
        executed_at: nowISO(),
        transfers,
        agent_signature: plausibleSig(),
        agent_address: AGENT_WALLET,
      };
      logEvent(state, "EXECUTION", {
        transfer_count: transfers.length,
        transfers,
        agent_address: AGENT_WALLET,
        agent_signature: exec.agent_signature,
        audit_record: {
          local_path: "/mnt/disks/userdata/audit/audit-" + Math.floor(Date.now() / 1000) + "-demo.json",
          eigenda_link: null,
          storage: "tee-persistent-disk",
        },
      });
      state.plan.current_phase = "COMPLETED";
      state.plan.phase_entered_at = nowISO();
      save(state);
      return delay({ execution: exec }, 600);
    },

    reset: async (_key: string) => {
      const state = fresh();
      save(state);
      return delay({ status: "reset to ACTIVE" }, 200);
    },

    cancelPlan: async (_key: string) => {
      const state = load();
      state.plan.current_phase = "CANCELLED";
      logEvent(state, "DIRECTOR_ACTION", { action: "cancel_plan" });
      save(state);
      return delay({ status: "cancelled" }, 100);
    },
  },
};

export function resetMockState(): void {
  localStorage.removeItem(STORAGE_KEY);
  ensureSetup();
}
