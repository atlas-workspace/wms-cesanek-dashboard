"use client";

// =============================================================================
// NOTIFICATION TEMPLATES — Test Mode Only
// All emails route to erin.cambra@unisco.com regardless of intended recipient.
// =============================================================================

const TEMPLATES = [
  {
    id: "missed_appointment",
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
    id: "carrier_late",
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
    id: "rescheduled",
    name: "Appointment Rescheduled",
    trigger: "Rescheduled",
    subject: "Your Appointment Has Been Rescheduled",
    body: `Hello,

Your shipment appointment has been rescheduled.

Our Operations Team will provide the updated appointment details shortly. No action is required at this time.

Thank you,

Warehouse Operations`,
  },
];

export default function NotificationTemplatesPage() {
  return (
    <>
      <h1>Notification Templates</h1>
      <p className="muted">Test Mode — all notifications route to erin.cambra@unisco.com only. Templates auto-select based on appointment status.</p>

      <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
        {TEMPLATES.map(t => (
          <div key={t.id} className="dash-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h2 style={{ fontSize: 14, margin: 0, color: "#eaf0ff" }}>{t.name}</h2>
              <span style={{ fontSize: 10, color: "#facc15", background: "#713f12", padding: "2px 8px", borderRadius: 4, fontWeight: 700 }}>TEST MODE</span>
            </div>
            <p style={{ fontSize: 11, color: "#8899b4", margin: "0 0 6px" }}>Trigger: {t.trigger} · Recipient: erin.cambra@unisco.com</p>
            <div style={{ background: "#101b31", border: "1px solid #26344f", borderRadius: 6, padding: 10 }}>
              <p style={{ fontSize: 11, color: "#64748b", margin: "0 0 4px" }}>Subject: <span style={{ color: "#eaf0ff" }}>{t.subject}</span></p>
              <pre style={{ fontSize: 11, color: "#cdd6f4", whiteSpace: "pre-wrap", margin: 0, lineHeight: 1.5, fontFamily: "inherit" }}>{t.body}</pre>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
