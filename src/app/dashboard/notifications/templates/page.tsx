"use client";

import { useState, useEffect, useCallback } from "react";
import { loadDeptConfig, saveDeptConfig, type DeptConfig, DEFAULT_DEPARTMENTS, TEST_RECIPIENT } from "@/lib/workflow-service";

export default function NotificationTemplatesPage() {
  const [depts, setDepts] = useState<DeptConfig[]>(DEFAULT_DEPARTMENTS);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editVal, setEditVal] = useState("");

  useEffect(() => { setDepts(loadDeptConfig()); }, []);

  const save = useCallback((updated: DeptConfig[]) => {
    setDepts(updated);
    saveDeptConfig(updated);
  }, []);

  const updateRecipients = useCallback((idx: number, val: string) => {
    const updated = [...depts];
    updated[idx] = { ...updated[idx], recipients: val.split(",").map(s => s.trim()).filter(Boolean) };
    save(updated);
    setEditingIdx(null);
  }, [depts, save]);

  return (
    <>
      <h1>Notification Templates & Department Configuration</h1>
      <p className="muted">Configure department notification recipients. Test Mode: all actual sends route to {TEST_RECIPIENT} only. Intended recipients shown in logs.</p>
      <p style={{ fontSize: 10, color: "#ff7a45", margin: "4px 0 12px" }}>⚠ Test Mode Active — No production emails sent. Configuration persisted in browser session.</p>

      <div className="table"><div className="table-scroll">
        <table style={{ minWidth: 500 }}>
          <thead><tr><th>Department</th><th>Recipients (Test Mode → {TEST_RECIPIENT})</th><th></th></tr></thead>
          <tbody>
            {depts.map((d, i) => (
              <tr key={d.name}>
                <td style={{ fontWeight: 600 }}>{d.name}</td>
                <td>
                  {editingIdx === i ? (
                    <span style={{ display: "flex", gap: 4 }}>
                      <input value={editVal} onChange={e => setEditVal(e.target.value)} className="filter-input" style={{ flex: 1, width: "auto" }} />
                      <button onClick={() => updateRecipients(i, editVal)} className="panel-btn primary" style={{ padding: "4px 8px", fontSize: 10 }}>Save</button>
                      <button onClick={() => setEditingIdx(null)} className="panel-btn" style={{ padding: "4px 8px", fontSize: 10 }}>Cancel</button>
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: "#9aa8c7" }}>{d.recipients.join(", ")}</span>
                  )}
                </td>
                <td>
                  {editingIdx !== i && (
                    <button onClick={() => { setEditingIdx(i); setEditVal(d.recipients.join(", ")); }} className="panel-btn" style={{ padding: "3px 8px", fontSize: 10 }}>Edit</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>

      <h2 style={{ marginTop: 20 }}>Email Templates</h2>
      <div style={{ display: "grid", gap: 10 }}>
        {[
          { name: "Missed Appointment", subject: "Missed Appointment Notification – Order [Order #]" },
          { name: "Late Appointment", subject: "Late Arrival Notification – Order [Order #]" },
          { name: "Rescheduled Appointment", subject: "Appointment Rescheduled – Order [Order #]" },
          { name: "LTL Pickup Missed", subject: "LTL Pickup Missed - Shipment Rolled to Next Business Day" },
          { name: "Priority SLA Warning", subject: "Priority Warning – Order [Order #] Near SLA Deadline" },
          { name: "Critical SLA Alert", subject: "CRITICAL: SLA Exceeded – Order [Order #]" },
        ].map(t => (
          <div key={t.name} style={{ background: "#16233b", border: "1px solid #26344f", borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#eaf0ff" }}>{t.name}</span>
              <span style={{ fontSize: 10, color: "#64748b" }}>Subject: {t.subject}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
