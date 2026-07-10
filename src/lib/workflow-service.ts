// =============================================================================
// WORKFLOW SERVICE — Shared activity logging and workflow state for all modules
// Persisted in sessionStorage (production requires backend DB).
// Test Mode: all emails route to erin.cambra@unisco.com only.
// =============================================================================

export interface ActivityEntry {
  id: string;
  timestamp: string;
  user: string;
  shipmentId: string;
  shipmentRef: string;
  action: string;
  emailStatus: "draft" | "sent" | "none" | "failed";
  recipient: string;
  intendedRecipient: string;
  previousStatus: string;
  newStatus: string;
  comments: string;
  module: "sla" | "appointments" | "ltl" | "notifications";
}

export interface DeptConfig {
  name: string;
  recipients: string[];
}

const ACTIVITY_KEY = "cesanekActivityLog";
const DEPT_KEY = "cesanekDeptConfig";
const WORKFLOW_KEY = "cesanekWorkflowState";

export const TEST_RECIPIENT = "erin.cambra@unisco.com";
export const POLLING_INTERVAL_TEST = 10000; // 10s for testing
export const POLLING_INTERVAL_PROD = 600000; // 10min production

export const DEFAULT_DEPARTMENTS: DeptConfig[] = [
  { name: "Inbound", recipients: ["erin.cambra@unisco.com"] },
  { name: "Outbound", recipients: ["erin.cambra@unisco.com"] },
  { name: "Inventory", recipients: ["erin.cambra@unisco.com"] },
  { name: "Operations", recipients: ["erin.cambra@unisco.com"] },
  { name: "Transportation", recipients: ["erin.cambra@unisco.com"] },
  { name: "Customer Service", recipients: ["erin.cambra@unisco.com"] },
  { name: "Management", recipients: ["erin.cambra@unisco.com"] },
];

export function loadActivityLog(): ActivityEntry[] {
  if (typeof window === "undefined") return [];
  try { const s = sessionStorage.getItem(ACTIVITY_KEY); return s ? JSON.parse(s) : []; } catch { return []; }
}

export function addActivity(entry: Omit<ActivityEntry, "id" | "timestamp">): ActivityEntry {
  const full: ActivityEntry = { ...entry, id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, timestamp: new Date().toISOString() };
  const log = loadActivityLog();
  log.unshift(full);
  if (log.length > 500) log.length = 500;
  sessionStorage.setItem(ACTIVITY_KEY, JSON.stringify(log));
  return full;
}

export function loadDeptConfig(): DeptConfig[] {
  if (typeof window === "undefined") return DEFAULT_DEPARTMENTS;
  try { const s = sessionStorage.getItem(DEPT_KEY); return s ? JSON.parse(s) : DEFAULT_DEPARTMENTS; } catch { return DEFAULT_DEPARTMENTS; }
}

export function saveDeptConfig(config: DeptConfig[]) {
  sessionStorage.setItem(DEPT_KEY, JSON.stringify(config));
}

export interface WorkflowState {
  status: string;
  lastAction?: string;
  lastActionTime?: string;
  lastActionUser?: string;
}

export function loadWorkflowStates(): Record<string, WorkflowState> {
  if (typeof window === "undefined") return {};
  try { const s = sessionStorage.getItem(WORKFLOW_KEY); return s ? JSON.parse(s) : {}; } catch { return {}; }
}

export function setWorkflowState(shipmentId: string, state: WorkflowState) {
  const all = loadWorkflowStates();
  all[shipmentId] = state;
  sessionStorage.setItem(WORKFLOW_KEY, JSON.stringify(all));
}

export function createEmailDraft(to: string, subject: string, body: string, intendedRecipient?: string): { mailto: string; logRecipient: string; intendedRecipient: string } {
  return {
    mailto: `mailto:${TEST_RECIPIENT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    logRecipient: TEST_RECIPIENT,
    intendedRecipient: intendedRecipient || to,
  };
}
