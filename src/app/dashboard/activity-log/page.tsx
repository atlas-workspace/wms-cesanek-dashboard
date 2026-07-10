"use client";

import { useState, useEffect } from "react";

// =============================================================================
// ACTIVITY LOG — Shared workflow audit trail across all dashboard modules
// Records status transitions, notifications, user actions for all shipments.
// =============================================================================

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

const STORAGE_KEY = "cesanekActivityLog";

export function loadActivityLog(): ActivityEntry[] {
  if (typeof window === "undefined") return [];
  try { const s = sessionStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : []; } catch { return []; }
}

export function saveActivityEntry(entry: Omit<ActivityEntry, "id" | "timestamp">): ActivityEntry {
  const full: ActivityEntry = { ...entry, id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, timestamp: new Date().toISOString() };
  const log = loadActivityLog();
  log.unshift(full);
  if (log.length > 500) log.length = 500;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  return full;
}

export function getShipmentActivity(shipmentId: string): ActivityEntry[] {
  return loadActivityLog().filter(e => e.shipmentId === shipmentId);
}

export default function ActivityLogPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => { setEntries(loadActivityLog()); }, []);

  const filtered = filter
    ? entries.filter(e => e.orderNumber.toLowerCase().includes(filter.toLowerCase()) || e.shipmentId.includes(filter) || e.action.toLowerCase().includes(filter.toLowerCase()))
    : entries;

  return (
    <>
      <h1>Activity Log</h1>
      <p className="muted">Shared workflow audit trail across all dashboard modules. Session-persisted until backend storage is connected.</p>

      <div className="filter-toolbar">
        <input type="text" placeholder="Search order/action..." value={filter} onChange={e => setFilter(e.target.value)} className="filter-input" style={{ width: 200 }} />
        <span style={{ fontSize: 10, color: "#64748b", marginLeft: "auto" }}>{filtered.length} entries</span>
      </div>

      <div className="table">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Order</th>
                <th>User</th>
                <th>Previous</th>
                <th>New Status</th>
                <th>Action</th>
                <th>Email</th>
                <th>Recipient</th>
                <th>Comments</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", padding: 30, color: "#64748b" }}>No activity recorded yet.</td></tr>
              )}
              {filtered.slice(0, 100).map(e => (
                <tr key={e.id}>
                  <td style={{ fontSize: 10 }}>{new Date(e.timestamp).toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                  <td style={{ fontWeight: 600 }}>{e.orderNumber}</td>
                  <td>{e.user}</td>
                  <td>{e.previousStatus || "—"}</td>
                  <td style={{ fontWeight: 600 }}>{e.newStatus}</td>
                  <td>{e.action}</td>
                  <td style={{ color: e.emailSent === "test" ? "#facc15" : e.emailSent === "yes" ? "#4ade80" : "#64748b" }}>{e.emailSent}</td>
                  <td style={{ fontSize: 10 }}>{e.recipient || "—"}</td>
                  <td style={{ fontSize: 10, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.comments || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
