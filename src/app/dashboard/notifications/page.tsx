"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth-context";

// --- Types ---
interface OrderContext {
  id: string;
  referenceNo?: string;
  poNo?: string;
  customerName?: string;
  customerCode?: string;
  carrierId?: string;
  appointmentTime?: string;
  appointmentType?: string;
  shipToAddress?: { name?: string; city?: string; state?: string };
  loadNo?: string;
  status?: string;
}

interface Contact {
  id: string;
  name: string;
  email: string;
  role: string;
  type: "customer" | "carrier";
}

// --- Constants ---
const SIGNATURE = `Erin Cambra
Account Manager
Mobile: (840) 205-9706

175 Cesanek Rd.
Northampton, PA 18067
erin.cambra@unisco.com

Notice: All appointments must be confirmed by 3:30 PM EST`;

const FACILITY_LOCATION = "175 Cesanek Rd., Northampton, PA 18067";

const RECIPIENT_TYPES = ["Customer Communications", "Carrier Communications"] as const;
const TEMPLATE_TYPES = ["Missed Appointment", "Reschedule Request", "1 Hour Reminder", "Reschedule Required"] as const;

type RecipientType = typeof RECIPIENT_TYPES[number];
type TemplateType = typeof TEMPLATE_TYPES[number];

// --- Templates ---
interface TemplateContent { subject: string; body: string }

function getTemplate(recipientType: RecipientType, templateType: TemplateType): TemplateContent {
  if (recipientType === "Customer Communications") {
    switch (templateType) {
      case "Missed Appointment":
        return {
          subject: "Missed Appointment Notification – Order [Order #]",
          body: `Dear [Customer Name],

We are writing to inform you that the scheduled appointment for your order has been missed.

Order Details:
• Order Number: [Order #]
• Load Number: [Load #]
• Appointment Date/Time: [Appointment Date/Time]
• Appointment Type: [Appointment Type]
• Facility: [Facility Location]

The carrier ([Carrier Name]) did not arrive within the scheduled appointment window. As a result, this delivery will need to be rescheduled.

Next Steps:
Please contact us to arrange a new appointment time. If we do not receive confirmation of a new appointment within 24 hours, additional warehouse handling fees may apply.

We apologize for any inconvenience and are working to resolve this promptly.

${SIGNATURE}`,
        };
      case "Reschedule Request":
        return {
          subject: "Reschedule Request – Order [Order #]",
          body: `Dear [Customer Name],

We need to reschedule the appointment for the following order:

Order Details:
• Order Number: [Order #]
• Load Number: [Load #]
• Original Appointment: [Appointment Date/Time]
• Appointment Type: [Appointment Type]
• Carrier: [Carrier Name]
• Facility: [Facility Location]

Please provide your preferred available time slots within the next 48 hours. If we do not receive a response, the order will be placed in a holding queue pending scheduling confirmation.

Available appointment windows are Monday–Friday, 7:00 AM – 3:30 PM EST. All appointments must be confirmed by 3:30 PM EST the business day prior.

${SIGNATURE}`,
        };
      case "1 Hour Reminder":
        return {
          subject: "Appointment Reminder – Order [Order #] in 1 Hour",
          body: `Dear [Customer Name],

This is a friendly reminder that the delivery appointment for your order is scheduled in approximately 1 hour.

Appointment Details:
• Order Number: [Order #]
• Load Number: [Load #]
• Appointment Date/Time: [Appointment Date/Time]
• Appointment Type: [Appointment Type]
• Carrier: [Carrier Name]
• Facility: [Facility Location]

Please ensure the carrier arrives on time. Late arrivals may result in the appointment being forfeited and rescheduling required.

If there are any changes to the expected arrival, please notify us immediately.

${SIGNATURE}`,
        };
      case "Reschedule Required":
        return {
          subject: "Reschedule Required – Order [Order #]",
          body: `Dear [Customer Name],

The appointment for your order originally scheduled for [Appointment Date/Time] must be rescheduled due to the carrier not arriving within the appointment window.

Order Details:
• Order Number: [Order #]
• Load Number: [Load #]
• Original Appointment: [Appointment Date/Time]
• Appointment Type: [Appointment Type]
• Carrier: [Carrier Name]
• Facility: [Facility Location]

Action Required:
Please reply with your preferred available time slots within the next 48 hours. If we do not receive a response, the order will be placed in a holding queue.

Available windows: Monday–Friday, 7:00 AM – 3:30 PM EST.

${SIGNATURE}`,
        };
    }
  } else {
    switch (templateType) {
      case "Missed Appointment":
        return {
          subject: "Missed Appointment – Load [Load #] / Order [Order #]",
          body: `To [Carrier Name] Dispatch,

This notice is to inform you that your driver missed the scheduled appointment at our facility.

Appointment Details:
• Order Number: [Order #]
• Load Number: [Load #]
• Scheduled Appointment: [Appointment Date/Time]
• Appointment Type: [Appointment Type]
• Customer: [Customer Name]
• Facility: [Facility Location]

The appointment window has passed without arrival or check-in. This missed appointment has been recorded and may impact future scheduling priority.

Please contact us immediately to reschedule. Appointments are available Monday–Friday, 7:00 AM – 3:30 PM EST and must be confirmed by 3:30 PM EST the business day prior.

${SIGNATURE}`,
        };
      case "Reschedule Request":
        return {
          subject: "Reschedule Request – Load [Load #] / Order [Order #]",
          body: `To [Carrier Name] Dispatch,

We are requesting a reschedule for the following appointment:

Appointment Details:
• Order Number: [Order #]
• Load Number: [Load #]
• Original Appointment: [Appointment Date/Time]
• Appointment Type: [Appointment Type]
• Customer: [Customer Name]
• Facility: [Facility Location]

Please provide updated ETA or preferred reschedule time. If ETA is known: [ETA]

Appointments must be confirmed by 3:30 PM EST the business day prior. Failure to reschedule within 24 hours may result in the load being placed on hold.

${SIGNATURE}`,
        };
      case "1 Hour Reminder":
        return {
          subject: "Appointment in 1 Hour – Load [Load #] / Order [Order #]",
          body: `To [Carrier Name] Dispatch,

This is a reminder that your scheduled appointment at our facility is in approximately 1 hour.

Appointment Details:
• Order Number: [Order #]
• Load Number: [Load #]
• Appointment Date/Time: [Appointment Date/Time]
• Appointment Type: [Appointment Type]
• Customer: [Customer Name]
• Facility: [Facility Location]

Please ensure the driver arrives on time and checks in at the gate. Late arrivals may forfeit the appointment window and require rescheduling.

If there are any delays, please notify us immediately with an updated ETA.

${SIGNATURE}`,
        };
      case "Reschedule Required":
        return {
          subject: "Reschedule Required – Load [Load #] / Order [Order #]",
          body: `To [Carrier Name] Dispatch,

The scheduled appointment for your load must be rescheduled. The original appointment window was not met.

Appointment Details:
• Order Number: [Order #]
• Load Number: [Load #]
• Original Appointment: [Appointment Date/Time]
• Appointment Type: [Appointment Type]
• Customer: [Customer Name]
• Facility: [Facility Location]

Action Required:
Provide a new requested appointment time within the next 24 hours. Available windows: Monday–Friday, 7:00 AM – 3:30 PM EST.

Repeated missed appointments may result in scheduling restrictions or detention charges.

${SIGNATURE}`,
        };
    }
  }
}

function replaceVars(text: string, ctx: OrderContext | null): string {
  if (!ctx) return text;
  const apptFmt = ctx.appointmentTime ? new Date(ctx.appointmentTime).toLocaleString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
  return text
    .replace(/\[Order #\]/g, ctx.referenceNo || ctx.id || "—")
    .replace(/\[Load #\]/g, ctx.loadNo || "—")
    .replace(/\[Customer Name\]/g, ctx.customerName || ctx.customerCode || "—")
    .replace(/\[Carrier Name\]/g, ctx.carrierId || "—")
    .replace(/\[Appointment Date\/Time\]/g, apptFmt)
    .replace(/\[Appointment Type\]/g, ctx.appointmentType || "—")
    .replace(/\[Facility Location\]/g, FACILITY_LOCATION)
    .replace(/\[ETA\]/g, "—")
    .replace(/\[RN\]/g, "—")
    .replace(/\[DN\]/g, ctx.referenceNo || "—");
}

const CONTACTS_KEY = "cesanekCommsContacts";
const DEFAULT_CONTACTS: Contact[] = [
  { id: "1", name: "Erin Cambra", email: "erin.cambra@unisco.com", role: "Account Manager", type: "customer" },
];

function loadContacts(): Contact[] {
  if (typeof window === "undefined") return DEFAULT_CONTACTS;
  try { const s = sessionStorage.getItem(CONTACTS_KEY); if (s) return JSON.parse(s); } catch {}
  return DEFAULT_CONTACTS;
}

async function wmsProxy(token: string, path: string, body: unknown) {
  const res = await fetch("/api/wms", { method: "POST", headers: { "Content-Type": "application/json", "x-session-token": token }, body: JSON.stringify({ path, body }) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Data could not be loaded.");
  return json;
}

// --- Component ---
export default function NotificationsPage() {
  const { token } = useAuth();

  // Order context list
  const [orders, setOrders] = useState<OrderContext[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  // Template state
  const [recipientType, setRecipientType] = useState<RecipientType>("Customer Communications");
  const [templateType, setTemplateType] = useState<TemplateType>("Missed Appointment");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");
  const [copied, setCopied] = useState(false);

  // Contacts
  const [contacts, setContacts] = useState<Contact[]>(DEFAULT_CONTACTS);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>(["erin.cambra@unisco.com"]);
  const [showAddContact, setShowAddContact] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newType, setNewType] = useState<"customer" | "carrier">("customer");

  // Order search
  const [orderSearch, setOrderSearch] = useState("");

  useEffect(() => { setContacts(loadContacts()); }, []);

  // Load orders for context
  useEffect(() => {
    if (!token) return;
    setLoadingOrders(true);
    wmsProxy(token, "/wms-bam/outbound/order/search-by-paging", { currentPage: 1, pageSize: 50, sortingFields: [{ field: "createdTime", orderBy: "DESC" }] })
      .then(json => {
        if (json?.success && json.data?.list) {
          setOrders(json.data.list.map((o: Record<string, unknown>) => ({
            id: String(o.id || ""),
            referenceNo: o.referenceNo ? String(o.referenceNo) : undefined,
            poNo: o.poNo ? String(o.poNo) : undefined,
            customerName: o.customerName ? String(o.customerName) : undefined,
            customerCode: o.customerCode ? String(o.customerCode) : undefined,
            carrierId: o.carrierId ? String(o.carrierId) : undefined,
            appointmentTime: o.appointmentTime ? String(o.appointmentTime) : undefined,
            appointmentType: o.appointmentType ? String(o.appointmentType) : undefined,
            shipToAddress: o.shipToAddress as OrderContext["shipToAddress"],
            loadNo: o.loadNo ? String(o.loadNo) : undefined,
            status: o.status ? String(o.status) : undefined,
          })));
        }
      })
      .catch(() => {})
      .finally(() => setLoadingOrders(false));
  }, [token]);

  // Selected order context
  const selectedOrder = useMemo(() => orders.find(o => o.id === selectedOrderId) || null, [orders, selectedOrderId]);

  // Auto-populate template when selections change
  useEffect(() => {
    const tmpl = getTemplate(recipientType, templateType);
    setEditSubject(replaceVars(tmpl.subject, selectedOrder));
    setEditBody(replaceVars(tmpl.body, selectedOrder));
  }, [recipientType, templateType, selectedOrder]);

  // Contact management
  const saveContacts = useCallback((updated: Contact[]) => {
    setContacts(updated);
    sessionStorage.setItem(CONTACTS_KEY, JSON.stringify(updated));
  }, []);

  const addContact = useCallback(() => {
    if (!newEmail) return;
    saveContacts([...contacts, { id: Date.now().toString(), name: newName, email: newEmail, role: newRole, type: newType }]);
    setNewName(""); setNewEmail(""); setNewRole(""); setShowAddContact(false);
  }, [contacts, newName, newEmail, newRole, newType, saveContacts]);

  const removeContact = useCallback((id: string) => saveContacts(contacts.filter(c => c.id !== id)), [contacts, saveContacts]);

  const toggleRecipient = useCallback((email: string) => {
    setSelectedRecipients(prev => prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]);
  }, []);

  // Filtered contacts by type
  const relevantContacts = useMemo(() => {
    const type = recipientType === "Customer Communications" ? "customer" : "carrier";
    return contacts.filter(c => c.type === type);
  }, [contacts, recipientType]);

  // Filtered order list for search
  const filteredOrders = useMemo(() => {
    if (!orderSearch) return orders.slice(0, 20);
    const s = orderSearch.toLowerCase();
    return orders.filter(o =>
      (o.referenceNo || "").toLowerCase().includes(s) ||
      (o.customerName || "").toLowerCase().includes(s) ||
      (o.poNo || "").toLowerCase().includes(s) ||
      o.id.includes(s)
    ).slice(0, 20);
  }, [orders, orderSearch]);

  // Actions
  const mailtoLink = `mailto:${selectedRecipients.join(",")}?subject=${encodeURIComponent(editSubject)}&body=${encodeURIComponent(editBody)}`;
  const copyDraft = useCallback(() => {
    navigator.clipboard.writeText(`To: ${selectedRecipients.join(", ")}\nSubject: ${editSubject}\n\n${editBody}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [selectedRecipients, editSubject, editBody]);

  return (
    <>
      <h1>Customer Communications</h1>
      <p className="muted">Select recipient type, template, and order context. Templates auto-populate with real order data. Edit before sending.</p>

      {/* Template Selection */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "18px 0 14px", maxWidth: 500 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#8899b4", textTransform: "uppercase" }}>Recipient Type</span>
          <select value={recipientType} onChange={e => setRecipientType(e.target.value as RecipientType)} className="filter-select" style={{ width: "100%" }}>
            {RECIPIENT_TYPES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#8899b4", textTransform: "uppercase" }}>Template</span>
          <select value={templateType} onChange={e => setTemplateType(e.target.value as TemplateType)} className="filter-select" style={{ width: "100%" }}>
            {TEMPLATE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>

      {/* Order Context Selector */}
      <div style={{ margin: "0 0 16px" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#8899b4", textTransform: "uppercase", display: "block", marginBottom: 4 }}>Order / Appointment Context</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Search by order #, customer, PO..."
            value={orderSearch}
            onChange={e => setOrderSearch(e.target.value)}
            className="filter-input"
            style={{ width: 260 }}
          />
          <select
            value={selectedOrderId}
            onChange={e => setSelectedOrderId(e.target.value)}
            className="filter-select"
            style={{ maxWidth: 400, flex: 1 }}
          >
            <option value="">— Select an order to populate template —</option>
            {loadingOrders && <option disabled>Loading orders...</option>}
            {filteredOrders.map(o => (
              <option key={o.id} value={o.id}>
                {o.referenceNo || o.id} — {o.customerName || o.customerCode || "Unknown"} — {o.status || ""}
              </option>
            ))}
          </select>
        </div>
        {selectedOrder && (
          <div style={{ fontSize: 11, color: "#9aa8c7", marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span>Customer: <b style={{ color: "#cdd6f4" }}>{selectedOrder.customerName || "—"}</b></span>
            <span>Carrier: <b style={{ color: "#cdd6f4" }}>{selectedOrder.carrierId || "—"}</b></span>
            <span>Appt: <b style={{ color: "#cdd6f4" }}>{selectedOrder.appointmentTime ? new Date(selectedOrder.appointmentTime).toLocaleString("en-US", { timeZone: "America/New_York" }) : "—"}</b></span>
            <span>Load: <b style={{ color: "#cdd6f4" }}>{selectedOrder.loadNo || "—"}</b></span>
          </div>
        )}
      </div>

      {/* Editable Subject & Body */}
      <div className="panel" style={{ maxWidth: "100%" }}>
        <label style={{ display: "grid", gap: 4, marginBottom: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#8899b4", textTransform: "uppercase" }}>Subject</span>
          <input
            value={editSubject}
            onChange={e => setEditSubject(e.target.value)}
            style={{ border: "1px solid #26344f", background: "#101b31", color: "#eaf0ff", borderRadius: 8, padding: "10px 12px", fontSize: 13, width: "100%" }}
          />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#8899b4", textTransform: "uppercase" }}>Body</span>
          <textarea
            value={editBody}
            onChange={e => setEditBody(e.target.value)}
            rows={18}
            style={{ border: "1px solid #26344f", background: "#101b31", color: "#eaf0ff", borderRadius: 8, padding: "12px", fontSize: 12, width: "100%", lineHeight: 1.6, fontFamily: "inherit", resize: "vertical" }}
          />
        </label>
      </div>

      {/* Recipients */}
      <div style={{ margin: "16px 0" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#8899b4", textTransform: "uppercase", display: "block", marginBottom: 6 }}>
          Recipients — {recipientType === "Customer Communications" ? "Customer Contacts" : "Carrier Contacts"}
        </span>
        {relevantContacts.length === 0 && (
          <p style={{ fontSize: 12, color: "#64748b" }}>No {recipientType === "Customer Communications" ? "customer" : "carrier"} contacts configured. Add one below.</p>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {relevantContacts.map(c => (
            <label key={c.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#cdd6f4", background: selectedRecipients.includes(c.email) ? "#1e1b4b" : "#16233b", border: `1px solid ${selectedRecipients.includes(c.email) ? "#5539f6" : "#26344f"}`, borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}>
              <input type="checkbox" checked={selectedRecipients.includes(c.email)} onChange={() => toggleRecipient(c.email)} style={{ accentColor: "#5539f6" }} />
              {c.name || c.email} <span style={{ fontSize: 10, color: "#64748b" }}>({c.role || c.type})</span>
            </label>
          ))}
          {/* Also show contacts from other type if any are selected */}
          {contacts.filter(c => c.type !== (recipientType === "Customer Communications" ? "customer" : "carrier") && selectedRecipients.includes(c.email)).map(c => (
            <label key={c.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#cdd6f4", background: "#1e1b4b", border: "1px solid #5539f6", borderRadius: 6, padding: "6px 10px", cursor: "pointer", opacity: 0.7 }}>
              <input type="checkbox" checked onChange={() => toggleRecipient(c.email)} style={{ accentColor: "#5539f6" }} />
              {c.name || c.email} <span style={{ fontSize: 10, color: "#64748b" }}>({c.type})</span>
            </label>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a href={mailtoLink} className="linkbtn" style={{ textDecoration: "none", fontSize: 13 }}>Open Email Draft</a>
          <button onClick={copyDraft} className="linkbtn" style={{ background: "#16233b", border: "1px solid #26344f", color: "#9aa8c7", fontSize: 13 }}>{copied ? "Copied!" : "Copy Draft"}</button>
        </div>
      </div>

      {/* Contact Management */}
      <h2 style={{ marginTop: 28 }}>Contact Directory</h2>
      <p className="muted">Manage customer and carrier contacts. Persisted in browser session.</p>

      <div className="table" style={{ marginTop: 10 }}>
        <table style={{ minWidth: 600 }}>
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Type</th><th></th></tr></thead>
          <tbody>
            {contacts.map(c => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.email}</td>
                <td>{c.role || "—"}</td>
                <td><span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 4, background: c.type === "customer" ? "#052e16" : "#1e1b4b", color: c.type === "customer" ? "#4ade80" : "#a99cff" }}>{c.type}</span></td>
                <td><button onClick={() => removeContact(c.id)} style={{ fontSize: 11, color: "#f87171", background: "none", border: 0, cursor: "pointer" }}>Remove</button></td>
              </tr>
            ))}
            {contacts.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: "center", padding: 24, color: "#64748b" }}>No contacts configured.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {!showAddContact ? (
        <button onClick={() => setShowAddContact(true)} className="linkbtn" style={{ marginTop: 12, fontSize: 12 }}>+ Add Contact</button>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "end" }}>
          <input placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} className="filter-input" />
          <input placeholder="Email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="filter-input" style={{ width: 200 }} />
          <input placeholder="Role" value={newRole} onChange={e => setNewRole(e.target.value)} className="filter-input" />
          <select value={newType} onChange={e => setNewType(e.target.value as "customer" | "carrier")} className="filter-select">
            <option value="customer">Customer</option>
            <option value="carrier">Carrier</option>
          </select>
          <button onClick={addContact} className="linkbtn" style={{ fontSize: 12, padding: "8px 14px" }}>Add</button>
          <button onClick={() => setShowAddContact(false)} style={{ fontSize: 12, padding: "8px 14px", background: "#16233b", color: "#9aa8c7", border: "1px solid #26344f", borderRadius: 9, cursor: "pointer" }}>Cancel</button>
        </div>
      )}
    </>
  );
}
