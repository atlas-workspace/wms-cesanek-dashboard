/**
 * WMS Action Guard Service
 *
 * Central enforcement point for the live-WMS-first requirement.
 * Actions are classified by verified mutation status based on WMS API investigation.
 *
 * ENABLED (verified endpoints):
 *   - Roll/Update Appointment: PUT /wms/appointment/{numericId}
 *   - Mark Missed: PUT /wms/appointment/cancel/{numericId}
 *   - Create Appointment: POST /wms/appointment (only when no appointment exists)
 *
 * GUARDED (no verified endpoint or unsafe semantics):
 *   - Mark Carrier Late: no WMS mutation endpoint found
 *   - Mark In Progress: requires preEntryId, not appointmentId
 *   - Mark Completed: requires preEntryId-based mutation
 *   - Mark Rescheduled: use appointmentTime update instead
 *   - Add Appointment Notes standalone: overwrite semantics unverified
 *   - Undo Roll: no reverse endpoint; create new appointment instead
 *   - Escalate: no WMS status for this; use ticket system
 */

import { OutboundOrder } from "./wms-api";
import { getStoredTokens, getUserInfo, DEFAULT_FACILITY, DEFAULT_TIMEZONE, DEFAULT_TENANT } from "./auth";
import { generateTxnId, transactionLog, Transaction } from "./transaction-service";
import { auditLog } from "./audit-service";
import { syncTracker } from "./sync-metrics";

export type WmsActionType =
  | "roll_appointment"
  | "mark_missed"
  | "create_appointment"
  | "mark_carrier_late"
  | "mark_in_progress"
  | "mark_completed"
  | "notify_customer"
  | "notify_carrier"
  | "notify_supervisor"
  | "view_audit"
  | "add_note"
  | "escalate";

export interface ActionDefinition {
  type: WmsActionType;
  label: string;
  requiresWmsMutation: boolean;
  mutationVerified: boolean;
  localOnly: boolean;
  disabledReason: string | null;
  category: "wms_mutation" | "notification" | "local";
  requiresConfirmation: boolean;
  destructive: boolean;
}

interface ActionRegistryEntry {
  label: string;
  requiresWmsMutation: boolean;
  mutationVerified: boolean;
  localOnly: boolean;
  category: "wms_mutation" | "notification" | "local";
  requiresConfirmation: boolean;
  destructive: boolean;
  guardedReason: string;
}

const ACTION_REGISTRY: Record<WmsActionType, ActionRegistryEntry> = {
  roll_appointment: {
    label: "Roll / Update Appointment",
    requiresWmsMutation: true,
    mutationVerified: true,
    localOnly: false,
    category: "wms_mutation",
    requiresConfirmation: true,
    destructive: false,
    guardedReason: "",
  },
  mark_missed: {
    label: "Mark Missed Appointment",
    requiresWmsMutation: true,
    mutationVerified: true,
    localOnly: false,
    category: "wms_mutation",
    requiresConfirmation: true,
    destructive: true,
    guardedReason: "",
  },
  create_appointment: {
    label: "Create Appointment",
    requiresWmsMutation: true,
    mutationVerified: true,
    localOnly: false,
    category: "wms_mutation",
    requiresConfirmation: true,
    destructive: false,
    guardedReason: "",
  },
  mark_carrier_late: {
    label: "Mark Carrier Late",
    requiresWmsMutation: true,
    mutationVerified: false,
    localOnly: false,
    category: "wms_mutation",
    requiresConfirmation: false,
    destructive: false,
    guardedReason: "No verified WMS mutation endpoint for carrier late status",
  },
  mark_in_progress: {
    label: "Mark In Progress",
    requiresWmsMutation: true,
    mutationVerified: false,
    localOnly: false,
    category: "wms_mutation",
    requiresConfirmation: false,
    destructive: false,
    guardedReason: "Requires pre-entry/check-in flow not available through appointment API",
  },
  mark_completed: {
    label: "Mark Completed",
    requiresWmsMutation: true,
    mutationVerified: false,
    localOnly: false,
    category: "wms_mutation",
    requiresConfirmation: false,
    destructive: false,
    guardedReason: "Completion requires preEntryId-based mutation, not available via appointment",
  },
  notify_customer: {
    label: "Notify Customer",
    requiresWmsMutation: false,
    mutationVerified: false,
    localOnly: false,
    category: "notification",
    requiresConfirmation: false,
    destructive: false,
    guardedReason: "",
  },
  notify_carrier: {
    label: "Notify Carrier",
    requiresWmsMutation: false,
    mutationVerified: false,
    localOnly: false,
    category: "notification",
    requiresConfirmation: false,
    destructive: false,
    guardedReason: "",
  },
  notify_supervisor: {
    label: "Notify Supervisor",
    requiresWmsMutation: false,
    mutationVerified: false,
    localOnly: false,
    category: "notification",
    requiresConfirmation: false,
    destructive: false,
    guardedReason: "",
  },
  view_audit: {
    label: "View Audit History",
    requiresWmsMutation: false,
    mutationVerified: false,
    localOnly: true,
    category: "local",
    requiresConfirmation: false,
    destructive: false,
    guardedReason: "",
  },
  add_note: {
    label: "Add Note",
    requiresWmsMutation: false,
    mutationVerified: false,
    localOnly: true,
    category: "local",
    requiresConfirmation: false,
    destructive: false,
    guardedReason: "",
  },
  escalate: {
    label: "Escalate",
    requiresWmsMutation: false,
    mutationVerified: false,
    localOnly: true,
    category: "local",
    requiresConfirmation: false,
    destructive: false,
    guardedReason: "No WMS escalation status; escalation creates a ticket event",
  },
};

export function getActionDefinitions(order: OutboundOrder, wmsConnected: boolean): ActionDefinition[] {
  const status = (order.status || "").toUpperCase();
  const isFinal = ["SHIPPED", "COMPLETED", "CANCELLED"].includes(status);
  const hasAppointmentId = !!order.appointmentId && !isNaN(Number(order.appointmentId));

  return Object.entries(ACTION_REGISTRY).map(([type, def]) => {
    let disabledReason: string | null = null;
    const actionType = type as WmsActionType;

    if (!wmsConnected && (def.requiresWmsMutation || def.category === "notification")) {
      disabledReason = "WMS is not connected — reconnect to perform this action";
    } else if (def.requiresWmsMutation && !def.mutationVerified) {
      disabledReason = def.guardedReason || "Mutation endpoint not verified";
    } else if (isFinal && def.requiresWmsMutation) {
      disabledReason = "Order is finalized — no further WMS changes allowed";
    } else if (actionType === "roll_appointment" && !hasAppointmentId) {
      disabledReason = "No WMS appointment record linked — cannot update appointment";
    } else if (actionType === "mark_missed" && !hasAppointmentId) {
      disabledReason = "No WMS appointment record linked — cannot mark missed";
    } else if (actionType === "create_appointment" && hasAppointmentId) {
      disabledReason = "Appointment already exists — use Roll/Update instead";
    }

    return {
      type: actionType,
      label: def.label,
      requiresWmsMutation: def.requiresWmsMutation,
      mutationVerified: def.mutationVerified,
      localOnly: def.localOnly,
      category: def.category,
      disabledReason,
      requiresConfirmation: def.requiresConfirmation,
      destructive: def.destructive,
    };
  });
}

export interface PreflightResult {
  success: boolean;
  appointmentData: Record<string, unknown> | null;
  message: string;
  responseTime: number;
}

function getAuthHeaders() {
  const tokens = getStoredTokens();
  if (!tokens) return null;
  const info = getUserInfo(tokens);
  return {
    token: tokens.access_token,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${tokens.access_token}`,
      "x-facility-id": DEFAULT_FACILITY,
      "x-tenant-id": info?.tenantId || DEFAULT_TENANT,
      "x-timezone": DEFAULT_TIMEZONE,
    },
    userId: info?.userId || "unknown",
    username: info?.username || "unknown",
  };
}

export async function preflightAppointment(appointmentId: number): Promise<PreflightResult> {
  const auth = getAuthHeaders();
  if (!auth) return { success: false, appointmentData: null, message: "Session expired", responseTime: 0 };

  const start = Date.now();
  try {
    const res = await fetch("/api/wms-proxy", {
      method: "POST",
      headers: { ...auth.headers, "x-wms-action": "get-appointment" },
      body: JSON.stringify({ appointmentId }),
    });
    const responseTime = Date.now() - start;
    const json = await res.json();

    if (!json.success) {
      return { success: false, appointmentData: null, message: json.message || "Could not fetch appointment", responseTime };
    }

    syncTracker.recordApiCall(true, responseTime);
    return { success: true, appointmentData: json.data, message: "Appointment fetched from live WMS", responseTime };
  } catch {
    const responseTime = Date.now() - start;
    syncTracker.recordApiCall(false, responseTime);
    return { success: false, appointmentData: null, message: "Unable to reach WMS", responseTime };
  }
}

export interface MutationResult {
  success: boolean;
  message: string;
  transactionId: string;
  responseTime: number;
  wmsResponseCode: number | null;
}

export async function executeRollAppointment(
  appointmentId: number,
  currentAppointment: Record<string, unknown>,
  newAppointmentTime: string,
  reason: string,
  note?: string
): Promise<MutationResult> {
  const auth = getAuthHeaders();
  if (!auth) return { success: false, message: "Session expired", transactionId: "", responseTime: 0, wmsResponseCode: null };

  const txnId = generateTxnId();
  const start = Date.now();

  const payload: Record<string, unknown> = {
    appointmentTime: newAppointmentTime,
    carrierId: currentAppointment.carrierId,
    appointmentType: currentAppointment.appointmentType || "OUTBOUND",
    customerIds: currentAppointment.customerIds || [],
    appointmentActions: currentAppointment.appointmentActions || [],
    reason,
  };
  if (note) payload.note = note;

  try {
    const res = await fetch("/api/wms-proxy", {
      method: "POST",
      headers: { ...auth.headers, "x-wms-action": "update-appointment" },
      body: JSON.stringify({ appointmentId, payload }),
    });
    const responseTime = Date.now() - start;
    const json = await res.json();

    syncTracker.recordApiCall(json.success, responseTime);

    const txn: Transaction = {
      id: txnId, type: "roll_appointment", orderId: String(appointmentId), status: json.success ? "Confirmed" : "Failed",
      createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), responseTime,
      wmsTxnId: null, userId: auth.userId, previousValue: currentAppointment.appointmentTime,
      updatedValue: newAppointmentTime, apiAction: "Roll / Update Appointment",
      wmsResponseCode: json.success ? 200 : (json.wmsCode ?? null), ticketId: null, notificationStatus: null,
    };
    transactionLog.add(txn);

    auditLog.append({
      userId: auth.userId, username: auth.username, orderId: String(appointmentId),
      actionType: "roll_appointment", previousValue: currentAppointment.appointmentTime,
      updatedValue: newAppointmentTime, apiAction: "Roll / Update Appointment",
      transactionId: txnId, wmsResponseStatus: json.success ? 200 : (json.wmsCode ?? null),
      ticketId: null, notificationStatus: null, source: "dashboard",
    });

    if (!json.success) {
      return { success: false, message: json.message || "WMS rejected the update", transactionId: txnId, responseTime, wmsResponseCode: json.wmsCode ?? null };
    }

    return { success: true, message: "Appointment updated in WMS", transactionId: txnId, responseTime, wmsResponseCode: 200 };
  } catch {
    return { success: false, message: "Unable to reach WMS", transactionId: txnId, responseTime: Date.now() - start, wmsResponseCode: null };
  }
}

export async function executeMarkMissed(
  appointmentId: number,
  reason: string,
  note?: string
): Promise<MutationResult> {
  const auth = getAuthHeaders();
  if (!auth) return { success: false, message: "Session expired", transactionId: "", responseTime: 0, wmsResponseCode: null };

  const txnId = generateTxnId();
  const start = Date.now();

  const payload: Record<string, unknown> = { reason, missAppointment: true };
  if (note) payload.note = note;

  try {
    const res = await fetch("/api/wms-proxy", {
      method: "POST",
      headers: { ...auth.headers, "x-wms-action": "cancel-appointment" },
      body: JSON.stringify({ appointmentId, payload }),
    });
    const responseTime = Date.now() - start;
    const json = await res.json();

    syncTracker.recordApiCall(json.success, responseTime);

    const txn: Transaction = {
      id: txnId, type: "mark_missed", orderId: String(appointmentId), status: json.success ? "Confirmed" : "Failed",
      createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), responseTime,
      wmsTxnId: null, userId: auth.userId, previousValue: "active",
      updatedValue: "cancelled/missed", apiAction: "Mark Missed Appointment",
      wmsResponseCode: json.success ? 200 : (json.wmsCode ?? null), ticketId: null, notificationStatus: null,
    };
    transactionLog.add(txn);

    auditLog.append({
      userId: auth.userId, username: auth.username, orderId: String(appointmentId),
      actionType: "mark_missed", previousValue: "active", updatedValue: "cancelled/missed",
      apiAction: "Mark Missed Appointment", transactionId: txnId,
      wmsResponseStatus: json.success ? 200 : (json.wmsCode ?? null),
      ticketId: null, notificationStatus: null, source: "dashboard",
    });

    if (!json.success) {
      return { success: false, message: json.message || "WMS rejected the cancellation", transactionId: txnId, responseTime, wmsResponseCode: json.wmsCode ?? null };
    }

    return { success: true, message: "Appointment marked as missed in WMS", transactionId: txnId, responseTime, wmsResponseCode: 200 };
  } catch {
    return { success: false, message: "Unable to reach WMS", transactionId: txnId, responseTime: Date.now() - start, wmsResponseCode: null };
  }
}

export async function executeCreateAppointment(
  appointmentTime: string,
  carrierId: string,
  customerIds: string[],
  loadId: string,
  reason?: string
): Promise<MutationResult> {
  const auth = getAuthHeaders();
  if (!auth) return { success: false, message: "Session expired", transactionId: "", responseTime: 0, wmsResponseCode: null };

  const txnId = generateTxnId();
  const start = Date.now();

  const payload: Record<string, unknown> = {
    appointmentType: "OUTBOUND",
    appointmentTime,
    carrierId,
    customerIds,
    appointmentActions: [{ serviceType: "LIVE_LOAD", referenceNos: [loadId], appointmentType: "OUTBOUND" }],
  };
  if (reason) payload.reason = reason;

  try {
    const res = await fetch("/api/wms-proxy", {
      method: "POST",
      headers: { ...auth.headers, "x-wms-action": "create-appointment" },
      body: JSON.stringify({ payload }),
    });
    const responseTime = Date.now() - start;
    const json = await res.json();

    syncTracker.recordApiCall(json.success, responseTime);

    const txn: Transaction = {
      id: txnId, type: "create_appointment", orderId: loadId, status: json.success ? "Confirmed" : "Failed",
      createdAt: new Date().toISOString(), completedAt: new Date().toISOString(), responseTime,
      wmsTxnId: null, userId: auth.userId, previousValue: null,
      updatedValue: appointmentTime, apiAction: "Create Appointment",
      wmsResponseCode: json.success ? 200 : (json.wmsCode ?? null), ticketId: null, notificationStatus: null,
    };
    transactionLog.add(txn);

    auditLog.append({
      userId: auth.userId, username: auth.username, orderId: loadId,
      actionType: "create_appointment", previousValue: null, updatedValue: appointmentTime,
      apiAction: "Create Appointment", transactionId: txnId,
      wmsResponseStatus: json.success ? 200 : (json.wmsCode ?? null),
      ticketId: null, notificationStatus: null, source: "dashboard",
    });

    if (!json.success) {
      return { success: false, message: json.message || "WMS rejected appointment creation", transactionId: txnId, responseTime, wmsResponseCode: json.wmsCode ?? null };
    }

    return { success: true, message: "Appointment created in WMS", transactionId: txnId, responseTime, wmsResponseCode: 200 };
  } catch {
    return { success: false, message: "Unable to reach WMS", transactionId: txnId, responseTime: Date.now() - start, wmsResponseCode: null };
  }
}

export async function executeNotification(
  order: OutboundOrder,
  recipientType: string,
  wmsConnected: boolean
): Promise<{ success: boolean; message: string }> {
  if (!wmsConnected) {
    return { success: false, message: "WMS is not connected — cannot verify order state for notification" };
  }

  if (order.appointmentId && !isNaN(Number(order.appointmentId))) {
    const preflight = await preflightAppointment(Number(order.appointmentId));
    if (!preflight.success) {
      return { success: false, message: preflight.message };
    }
  }

  return { success: true, message: `Notify ${recipientType} queued with verified WMS state (test mode — no email sent)` };
}
