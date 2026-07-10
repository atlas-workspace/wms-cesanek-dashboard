"use client";

import { useState, useEffect } from "react";
import { loadActivityLog, type ActivityEntry } from "@/lib/workflow-service";

export default function ActivityLogPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [moduleFilter, setModuleFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  useEffect(() => { setEntries(loadActivityLog()); }, []);
  useEffect(() => { const i = setInterval(() => setEntries(loadActivityLog()), 5000); return () => clearInterval(i); }, []);

  const filtered = entries.filter(e => {
    if (moduleFilter && e.module !== moduleFilter) return false;
    if (actionFilter && !e.action.toLowerCase().includes(actionFilter.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <h1>Activity Log</h1>
      <p className="muted">All workflow actions across SLA, Appointments, LTL, and Notifications modules. Persisted in browser session (production requires backend storage).</p>

      <div className="filter-toolbar">
        <select value={moduleFilter} onChange={e => setModuleFilter(e.target.value)} className="filter-select">
          <option value="">All Modules</option>
          <option value="sla">SLA</option>
          <option value="appointments">Appointments</option>
          <option value="ltl">LTL</option>
          <option value="notifications">Notifications</option>
        </select>
        <input type="text" placeholder="Search action..." value={actionFilter} onChange={e => setActionFilter(e.target.value)} className="filter-input" />
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
                <td><span style={{ color: e.emailStatus === "draft" ? "#facc15" : e.emailStatus === "sent" ? "#4ade80" : "#64748b", fontSize: 10, fontWeight: 700 }}>{e.emailStatus}</span></td>
                <td style={{ fontSize: 10 }}>{e.recipient}{e.intendedRecipient && e.intendedRecipient !== e.recipient ? <span style={{ color: "#64748b" }}> (intended: {e.intendedRecipient})</span> : null}</td>
                <td style={{ fontSize: 10 }}>{e.previousStatus || "—"}</td>
                <td style={{ fontSize: 10 }}>{e.newStatus || "—"}</td>
                <td style={{ fontSize: 10, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>{e.comments || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>
    </>
  );
}
