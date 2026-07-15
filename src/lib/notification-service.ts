// =============================================================================
// NOTIFICATION SERVICE — Global email testing mode & activity logging
// Reusable across SLA, Appointments, LTL, and Notifications modules.
//
// SYSTEM MODE: Test Mode (default) — all emails route to test recipient only.
// Production Mode requires verified email send service; not enabled by default.
// =============================================================================

export type SystemMode = "test" | "production";

export interface NotificationConfig {
  mode: SystemMode;
  testRecipient: string;
  departmentRecipients: Record<string, string[]>;
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  user: string;
  shipmentId?: string;
  shipmentRef?: string;
  action: string;
  emailStatus: "draft" | "sent" | "failed" | "skipped";
  recipient: string;
  intendedRecipient: string;
  subject: string;
  status: string;
  previousStatus?: string;
  newStatus?: string;
  comments?: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  category: "customer" | "carrier" | "supervisor" | "internal";
}

const CONFIG_KEY = "cesanekNotifConfig";
const ACTIVITY_KEY = "cesanekActivityLog";
const TEMPLATES_KEY = "cesanekEmailTemplates";

const DEFAULT_CONFIG: NotificationConfig = {
  mode: "test",
  testRecipient: "erin.cambra@unisco.com",
  departmentRecipients: {
    Inbound: ["erin.cambra@unisco.com"],
    Outbound: ["erin.cambra@unisco.com"],
    Inventory: ["erin.cambra@unisco.com"],
    Operations: ["erin.cambra@unisco.com"],
    Transportation: ["erin.cambra@unisco.com"],
    "Customer Service": ["erin.cambra@unisco.com"],
    Management: ["erin.cambra@unisco.com"],
  },
};

const DEFAULT_TEMPLATES: EmailTemplate[] = [
  { id: "missed-appt", name: "Missed Appointment", category: "customer", subject: "Missed Appointment Notification – Order [Order #]", body: "Dear [Customer Name],\n\nWe are writing to inform you that the scheduled appointment for your order has been missed.\n\nOrder: [Order #]\nLoad: [Load #]\nCarrier: [Carrier Name]\nOriginal Appointment: [Appointment Date/Time]\n\nPlease contact us to arrange a new appointment time.\n\nThank you,\nErin Cambra\nAccount Manager\n175 Cesanek Rd., Northampton, PA 18067" },
  { id: "late-appt", name: "Late Appointment", category: "customer", subject: "Late Arrival Notice – Order [Order #]", body: "Dear [Customer Name],\n\nThe carrier for your order [Order #] arrived later than the scheduled appointment time.\n\nLoad: [Load #]\nCarrier: [Carrier Name]\nScheduled: [Appointment Date/Time]\n\nThe shipment is being processed. No action is required from you.\n\nThank you,\nErin Cambra\nAccount Manager" },
  { id: "ltl-rollover", name: "LTL Pickup Rolled", category: "customer", subject: "LTL Pickup Missed - Shipment Rolled to Next Business Day", body: "Dear [Customer Name],\n\nYour LTL shipment has been automatically rescheduled after today's pickup window closed.\n\nOrder: [Order #]\nLoad: [Load #]\nCarrier: [Carrier Name]\nOriginal Pickup: [Appointment Date/Time]\nNew Pickup: [New Appointment]\n\nNo action is required from you.\n\nThank you,\nErin Cambra\nAccount Manager" },
  { id: "sla-warning", name: "SLA Priority Warning", category: "supervisor", subject: "SLA Warning – Order [Order #] Approaching Deadline", body: "PRIORITY WARNING\n\nOrder [Order #] is approaching its SLA deadline.\n\nCustomer: [Customer Name]\nCreated: [Created Date]\nSLA Deadline: [SLA Deadline]\nTime Remaining: [Time Remaining]\n\nPlease review and take action.\n\nSystem Automation" },
  { id: "sla-breach", name: "SLA Critical Breach", category: "supervisor", subject: "CRITICAL: SLA Exceeded – Order [Order #]", body: "CRITICAL SLA ALERT\n\nOrder [Order #] has exceeded its 48-hour SLA.\n\nCustomer: [Customer Name]\nCarrier: [Carrier Name]\nCreated: [Created Date]\nSLA Deadline: [SLA Deadline]\nOverdue: [Time Remaining]\n\nImmediate action required.\n\nSystem Automation" },
  { id: "carrier-delay", name: "Carrier Delay", category: "carrier", subject: "Carrier Delay Notice – Load [Load #]", body: "To [Carrier Name] Dispatch,\n\nPlease provide an updated ETA for Load [Load #].\n\nOrder: [Order #]\nScheduled Appointment: [Appointment Date/Time]\nFacility: 175 Cesanek Rd., Northampton, PA 18067\n\nThank you,\nErin Cambra\nAccount Manager" },
  { id: "reschedule", name: "Appointment Rescheduled", category: "customer", subject: "Appointment Rescheduled – Order [Order #]", body: "Dear [Customer Name],\n\nThe appointment for Order [Order #] has been rescheduled.\n\nNew Appointment: [New Appointment]\nCarrier: [Carrier Name]\nFacility: 175 Cesanek Rd., Northampton, PA 18067\n\nThank you,\nErin Cambra\nAccount Manager" },
  { id: "general-update", name: "General Customer Update", category: "customer", subject: "Shipment Update – Order [Order #]", body: "Dear [Customer Name],\n\nThis is an update regarding your order [Order #].\n\n[Custom Message]\n\nThank you,\nErin Cambra\nAccount Manager" },
];

export function loadConfig(): NotificationConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try { const s = sessionStorage.getItem(CONFIG_KEY); return s ? JSON.parse(s) : DEFAULT_CONFIG; } catch { return DEFAULT_CONFIG; }
}

export function saveConfig(config: NotificationConfig) {
  sessionStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function loadActivityLog(): ActivityEntry[] {
  if (typeof window === "undefined") return [];
  try { const s = sessionStorage.getItem(ACTIVITY_KEY); return s ? JSON.parse(s) : []; } catch { return []; }
}

export function addActivityEntry(entry: Omit<ActivityEntry, "id" | "timestamp">) {
  const log = loadActivityLog();
  log.unshift({ ...entry, id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, timestamp: new Date().toISOString() });
  if (log.length > 500) log.length = 500;
  sessionStorage.setItem(ACTIVITY_KEY, JSON.stringify(log));
  return log;
}

export function loadTemplates(): EmailTemplate[] {
  if (typeof window === "undefined") return DEFAULT_TEMPLATES;
  try { const s = sessionStorage.getItem(TEMPLATES_KEY); return s ? JSON.parse(s) : DEFAULT_TEMPLATES; } catch { return DEFAULT_TEMPLATES; }
}

export function saveTemplates(templates: EmailTemplate[]) {
  sessionStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
}

export function getEffectiveRecipient(intendedRecipient: string, config?: NotificationConfig): string {
  const c = config || loadConfig();
  return c.mode === "test" ? c.testRecipient : intendedRecipient;
}

export function generateMailto(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
