"use client";

import { useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { addActivity, TEST_RECIPIENT } from "@/lib/workflow-service";

interface TicketDraft {
  id: string;
  customerName: string;
  customerEmail: string;
  title: string;
  message: string;
  shipmentRef: string;
  priority: string;
  status: "draft" | "sent" | "failed" | "pending";
  createdAt: string;
  apiResponse?: string;
}

const STORAGE_KEY = "cesanekTickets";

function loadTickets(): TicketDraft[] {
  if (typeof window === "undefined") return [];
  try { const s = sessionStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : []; } catch { return []; }
}

function saveTickets(tickets: TicketDraft[]) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tickets));
}

export default function TicketsPage() {
  const { token, username } = useAuth();
  const [tickets, setTickets] = useState<TicketDraft[]>(loadTickets());
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [shipmentRef, setShipmentRef] = useState("");
  const [priority, setPriority] = useState("Normal");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);

  const createTicket = useCallback(async () => {
    if (!token) { setResult({ type: "error", msg: "Please sign in first." }); return; }
    if (!title.trim()) { setResult({ type: "error", msg: "Subject is required." }); return; }
    if (!message.trim()) { setResult({ type: "error", msg: "Message is required." }); return; }

    setSending(true); setResult(null);
    const draft: TicketDraft = {
      id: `tkt_${Date.now()}`,
      customerName: customerName || "Cesanek Customer",
      customerEmail: customerEmail || TEST_RECIPIENT,
      title,
      message,
      shipmentRef,
      priority,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-session-token": token },
        body: JSON.stringify({
          action: "create",
          customerName: draft.customerName,
          customerEmail: draft.customerEmail,
          title: draft.title,
          message: { content: draft.message },
          departmentId: 1,
          topicId: 1,
        }),
      });

      const json = await res.json();

      if (res.ok && json.success) {
        draft.status = "sent";
        draft.apiResponse = `Ticket created (ID: ${json.data?.id || json.data?.number || "—"})`;
        setResult({ type: "success", msg: `Ticket created successfully and routed to ${TEST_RECIPIENT} (Test Mode). Ticket ID: ${json.data?.id || json.data?.number || "—"}` });
      } else {
        draft.status = "failed";
        draft.apiResponse = json.error || json.msg || "API error";
        setResult({ type: "error", msg: json.error || "Ticket creation failed. Saved as local draft." });
      }
    } catch (e) {
      draft.status = "draft";
      draft.apiResponse = "Network/connection error — saved as draft";
      setResult({ type: "info", msg: "Could not reach Ticket API. Saved as local draft for retry." });
    }

    const updated = [draft, ...tickets].slice(0, 100);
    setTickets(updated);
    saveTickets(updated);

    addActivity({
      user: username || "ecambra",
      shipmentId: shipmentRef || draft.id,
      shipmentRef: shipmentRef || title,
      action: "Create Customer Ticket",
      emailStatus: draft.status === "sent" ? "sent" : "draft",
      recipient: TEST_RECIPIENT,
      intendedRecipient: customerEmail || TEST_RECIPIENT,
      previousStatus: "",
      newStatus: draft.status,
      comments: `Subject: ${title}`,
      module: "notifications",
    });

    setTitle(""); setMessage(""); setShipmentRef("");
    setSending(false);
  }, [token, username, customerName, customerEmail, title, message, shipmentRef, priority, tickets]);

  return (
    <>
      <h1>Customer Tickets</h1>
      <p className="muted">Create outbound customer tickets. Test Mode — all tickets route to {TEST_RECIPIENT} regardless of intended recipient.</p>
      <p style={{ fontSize: 10, color: "#ff7a45", margin: "2px 0 12px" }}>⚠ Test Mode Active — Tickets sent to {TEST_RECIPIENT} only. Intended recipient shown for verification.</p>

      {/* Create Ticket Form */}
      <div style={{ background: "#16233b", border: "1px solid #26344f", borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 12px", fontSize: 14 }}>Create Outbound Ticket</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <label style={{ display: "grid", gap: 3, fontSize: 11, color: "#8899b4" }}>
            Customer Name
            <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="e.g. Boundless EC US LLC" className="filter-input" style={{ width: "100%" }} />
          </label>
          <label style={{ display: "grid", gap: 3, fontSize: 11, color: "#8899b4" }}>
            Intended Recipient Email
            <input value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="customer@example.com" className="filter-input" style={{ width: "100%" }} />
          </label>
          <label style={{ display: "grid", gap: 3, fontSize: 11, color: "#8899b4" }}>
            Related Shipment / Order Reference
            <input value={shipmentRef} onChange={e => setShipmentRef(e.target.value)} placeholder="DN, RN, Load #, etc." className="filter-input" style={{ width: "100%" }} />
          </label>
          <label style={{ display: "grid", gap: 3, fontSize: 11, color: "#8899b4" }}>
            Priority
            <select value={priority} onChange={e => setPriority(e.target.value)} className="filter-select" style={{ width: "100%" }}>
              <option>Low</option>
              <option>Normal</option>
              <option>High</option>
              <option>Urgent</option>
            </select>
          </label>
        </div>
        <label style={{ display: "grid", gap: 3, fontSize: 11, color: "#8899b4", marginBottom: 10 }}>
          Subject *
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Missed Appointment — Order DN-2032142" className="filter-input" style={{ width: "100%" }} />
        </label>
        <label style={{ display: "grid", gap: 3, fontSize: 11, color: "#8899b4", marginBottom: 12 }}>
          Message *
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={5} placeholder="Describe the issue or outbound communication..." style={{ border: "1px solid #26344f", background: "#101b31", color: "#eaf0ff", borderRadius: 6, padding: "8px 10px", fontSize: 12, resize: "vertical", fontFamily: "inherit" }} />
        </label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={createTicket} disabled={sending} style={{ border: 0, borderRadius: 6, background: "#5539f6", color: "#fff", padding: "8px 16px", fontSize: 12, fontWeight: 700, cursor: "pointer", opacity: sending ? 0.5 : 1 }}>
            {sending ? "Creating..." : "Create Test Ticket"}
          </button>
          <span style={{ fontSize: 10, color: "#64748b" }}>Routes to: {TEST_RECIPIENT}</span>
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="notice" style={{ borderColor: result.type === "success" ? "#4ade80" : result.type === "error" ? "#fb7185" : "#facc15", background: result.type === "success" ? "#052e16" : result.type === "error" ? "#2a0a0f" : "#1e1b4b" }}>
          <span style={{ color: result.type === "success" ? "#4ade80" : result.type === "error" ? "#fca5a5" : "#facc15" }}>{result.msg}</span>
        </div>
      )}

      {/* Ticket History */}
      <h2 style={{ marginTop: 16 }}>Ticket History</h2>
      <div className="table"><div className="table-scroll">
        <table>
          <thead><tr><th>Created</th><th>Subject</th><th>Customer</th><th>Recipient</th><th>Reference</th><th>Priority</th><th>Status</th></tr></thead>
          <tbody>
            {tickets.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", padding: 30, color: "#64748b" }}>No tickets created yet. Use the form above to create a test ticket.</td></tr>}
            {tickets.map(t => (
              <tr key={t.id}>
                <td style={{ fontSize: 10, whiteSpace: "nowrap" }}>{new Date(t.createdAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                <td style={{ fontWeight: 600 }}>{t.title}</td>
                <td>{t.customerName || "—"}</td>
                <td style={{ fontSize: 10 }}>{TEST_RECIPIENT}{t.customerEmail && t.customerEmail !== TEST_RECIPIENT ? <span style={{ color: "#64748b" }}> (intended: {t.customerEmail})</span> : ""}</td>
                <td style={{ fontSize: 10 }}>{t.shipmentRef || "—"}</td>
                <td>{t.priority}</td>
                <td>
                  <span style={{ fontWeight: 700, color: t.status === "sent" ? "#4ade80" : t.status === "failed" ? "#fb7185" : t.status === "draft" ? "#facc15" : "#3b82f6" }}>
                    {t.status === "sent" ? "✓ Sent" : t.status === "failed" ? "✗ Failed" : t.status === "draft" ? "Draft" : "Pending"}
                  </span>
                  {t.apiResponse && <span style={{ fontSize: 9, color: "#64748b", display: "block" }}>{t.apiResponse}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div></div>

      <div style={{ marginTop: 12, display: "flex", gap: 12, fontSize: 11 }}>
        <a href="/dashboard/notifications/templates" style={{ color: "#5539f6", textDecoration: "none" }}>Template Config →</a>
        <a href="/dashboard/activity-log" style={{ color: "#5539f6", textDecoration: "none" }}>Activity Log →</a>
      </div>
    </>
  );
}
