"use client";

import { useState, useEffect } from "react";
import { loadActivityLog as loadWorkflowLog, addActivity, type ActivityEntry as WorkflowActivityEntry } from "@/lib/workflow-service";

export interface ActivityEntry {
  id: string;
  timestamp: string;
  shipmentId: string;
  orderNumber: string;
  user: string;
  previousStatus: string;
  newStatus: string;
  action: string;
  emailSent: "yes" | "draft" | "test" | "no";
  recipient: string;
  comments: string;
}

export function loadActivityLog(): ActivityEntry[] {
  return loadWorkflowLog().map(e => ({
    id: e.id,
    timestamp: e.timestamp,
    shipmentId: e.shipmentId,
    orderNumber: e.shipmentRef,
    user: e.user,
    previousStatus: e.previousStatus,
    newStatus: e.newStatus,
    action: e.action,
    emailSent: e.emailStatus === "sent" ? "yes" : e.emailStatus === "draft" ? "test" : e.emailStatus === "failed" ? "draft" : "no",
    recipient: e.recipient,
    comments: e.comments,
  }));
}

export function saveActivityEntry(entry: Omit<ActivityEntry, "id" | "timestamp">): ActivityEntry {
  const full = addActivity({
    user: entry.user,
    shipmentId: entry.shipmentId,
    shipmentRef: entry.orderNumber || entry.shipmentId,
    action: entry.action,
    emailStatus: entry.emailSent === "yes" ? "sent" : entry.emailSent === "test" || entry.emailSent === "draft" ? "draft" : "none",
    recipient: entry.recipient,
    intendedRecipient: entry.recipient,
    previousStatus: entry.previousStatus,
    newStatus: entry.newStatus,
    comments: entry.comments,
    module: "appointments",
  });
  return {
    id: full.id,
    timestamp: full.timestamp,
    shipmentId: full.shipmentId,
    orderNumber: full.shipmentRef,
    user: full.user,
    previousStatus: full.previousStatus,
    newStatus: full.newStatus,
    action: full.action,
    emailSent: full.emailStatus === "sent" ? "yes" : full.emailStatus === "draft" ? "test" : "no",
    recipient: full.recipient,
    comments: full.comments,
  };
}

export function getShipmentActivity(shipmentId: string): ActivityEntry[] {
  return loadActivityLog().filter(e => e.shipmentId === shipmentId);
}

export default function ActivityLogPage() {
  const [entries, setEntries] = useState<WorkflowActivityEntry[]>([]);
  const [moduleFilter, setModuleFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  useEffect(() => { setEntries(loadWorkflowLog()); }, []);
  useEffect(() => { const i = setInterval(() => setEntries(loadWorkflowLog()), 5000); return () => clearInterval(i); }, []);

  const filtered = entries.filter(e => {
    if (moduleFilter && e.module !== moduleFilter) return false;
    if (actionFilter && !(`${e.action} ${e.shipmentRef} ${e.comments}`.toLowerCase()).includes(actionFilter.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <h1>Activity Log</h1>
      <p className="muted">All workflow actions across SLA, Appointments, LTL, Tickets, and Notifications modules. Persisted in browser session until backend storage is connected.</p>

      <div className="filter-toolbar">
        <select value={moduleFilter} onChange={e => setModuleFilter(e.target.value)} className="filter-select">
          <option value="">All Modules</option>
          <option value="sla">SLA</option>
          <option value="appointments">Appointments</option>
          <option value="ltl">LTL</option>
          <option value="notifications">Notifications</option>
        </select>
        <input type="text" placeholder="Search action/shipment..." value={actionFilter} onChange={e => setActionFilter(e.target.value)} className="filter-input" />
        <span style={{ color: "#64748b", fontSize: 11, marginLeft: "auto" }}>{filtered.length} entries</span>
      </div>

      <div className="table"><div className="table-scroll">
        <table>
          <thead><tr><th>Time</th><th>User</th><th>Shipment</th><th>Action</th><th>Email</th><th>Recipient</th><th>Prev Status</th><th>New Status</th><th>Comments</th></tr></thead>
          <tbody>
            {filtered.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", padding: 30, color: "#64748b" }}>No activity logged yet.</td></tr>}
            {filtered.slice(0, 200).map(e => (
              <tr key={e.id}>
                <td style={{ fontSize: 10, whiteSpace: "nowrap" }}>{new Date(e.timestamp).toLocaleString("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                <td>{e.user}</td>
                <td style={{ fontWeight: 600 }}>{e.shipmentRef}</td>
                <td>{e.action}</td>
                <td><span style={{ color: e.emailStatus === "draft" ? "#facc15" : e.emailStatus === "sent" ? "#4ade80" : e.emailStatus === "failed" ? "#fb7185" : "#64748b", fontSize: 10, fontWeight: 700 }}>{e.emailStatus}</span></td>
                <td style={{ fontSize: 10 }}>{e.recipient}{e.intendedRecipient && e.intendedRecipient !== e.recipient ? <span style={{ color: "#64748b" }}> (intended: {e.intendedRecipient})</span> : null}</td>
                <td style={{ fontSize: 10 }}>{e.previousStatus || "—"}</td>
                <td style={{ fontSize: 10 }}>{e.newStatus || "—"}</td>
                <td style={{ fontSize: 10, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{e.comments || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
    </>
  );
}
