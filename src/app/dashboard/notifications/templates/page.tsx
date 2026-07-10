"use client";

import { useState, useEffect, useCallback } from "react";
import { loadDeptConfig, saveDeptConfig, type DeptConfig, DEFAULT_DEPARTMENTS, TEST_RECIPIENT } from "@/lib/workflow-service";

const TEMPLATES = [
  {
    name: "Missed Appointment Notification",
    trigger: "Missed Appointment",
    subject: "Missed Appointment Notification",
    body: `Hello,

We wanted to inform you that the carrier assigned to your shipment did not arrive for its scheduled appointment.

Your shipment remains open and our Operations Team is actively working to coordinate the next available appointment.

No action is required at this time.

We will continue to provide updates as additional information becomes available.

Thank you,

Warehouse Operations`,
  },
  {
    name: "Carrier Running Late",
    trigger: "Late Appointment",
    subject: "Carrier Running Late",
    body: `Hello,

Your carrier has not yet arrived for its scheduled appointment.

Our Operations Team is actively monitoring the shipment and will continue processing once the carrier arrives.

Additional updates will be provided if necessary.

Thank you,

Warehouse Operations`,
  },
  {
    name: "Appointment Rescheduled",
    trigger: "Rescheduled Appointment",
    subject: "Appointment Rescheduled – Order [Order #]",
    body: `Hello,

Your shipment appointment has been rescheduled.

New Appointment: [New Appointment Date/Time]
Reason: [Reason]

No action is required at this time.

Thank you,

Warehouse Operations`,
  },
  { name: "LTL Pickup Missed", trigger: "LTL Rollover", subject: "LTL Pickup Missed - Shipment Rolled to Next Business Day", body: "Your LTL pickup was missed and the shipment has been rolled to the next business day. No action is required." },
  { name: "Priority SLA Warning", trigger: "SLA Near Deadline", subject: "Priority Warning – Order [Order #] Near SLA Deadline", body: "Order [Order #] is approaching its SLA deadline. Please review and take action." },
  { name: "Critical SLA Alert", trigger: "SLA Breach", subject: "CRITICAL: SLA Exceeded – Order [Order #]", body: "Order [Order #] has exceeded SLA. Immediate supervisor review is required." },
  { name: "Carrier Delay", trigger: "Carrier Delayed", subject: "Carrier Delay – Order [Order #]", body: "The carrier is delayed for the scheduled appointment. Operations is monitoring the shipment." },
  { name: "General Customer Update", trigger: "Manual Update", subject: "Shipment Update – Order [Order #]", body: "Hello,\n\nWe are providing an update for your shipment.\n\nThank you,\n\nWarehouse Operations" },
];

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
      <p className="muted">Configure department notification recipients and review Test Mode templates. Test Mode routes all actual drafts/sends to {TEST_RECIPIENT} only; intended recipients appear in logs for verification.</p>
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
        {TEMPLATES.map(t => (
          <div key={t.name} style={{ background: "#16233b", border: "1px solid #26344f", borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#eaf0ff" }}>{t.name}</span>
              <span style={{ fontSize: 10, color: "#facc15", background: "#713f12", padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}>TEST MODE</span>
            </div>
            <p style={{ fontSize: 10, color: "#8899b4", margin: "6px 0" }}>Trigger: {t.trigger} · Subject: <span style={{ color: "#cdd6f4" }}>{t.subject}</span></p>
            <pre style={{ background: "#101b31", border: "1px solid #26344f", borderRadius: 6, padding: 10, margin: 0, color: "#cdd6f4", fontSize: 10, lineHeight: 1.45, whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{t.body}</pre>
          </div>
        ))}
      </div>
    </>
  );
}
