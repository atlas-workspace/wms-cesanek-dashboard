"use client";

import { useState, useCallback, useEffect } from "react";

// --- Types ---
interface OrderDetail {
  id: string;
  status?: string;
  customerName?: string;
  customerCode?: string;
  referenceNo?: string;
  poNo?: string;
  createdTime?: string;
  shipToAddress?: { name?: string; address1?: string; address2?: string; city?: string; state?: string; zipCode?: string; contact?: string; phone?: string; note?: string };
  appointmentTime?: string;
  carrierId?: string;
  carrierName?: string;
  bolNo?: string;
  loadNo?: string;
  trackingNo?: string;
  orderNote?: string;
  pickNote?: string;
  packNote?: string;
  deliveryInstructions?: string;
  itemLines?: { itemId?: string; description?: string; qty?: number; uom?: string; lotNo?: string }[];
  totalPallets?: number;
  totalWeight?: number;
  updatedTime?: string;
  updatedBy?: string;
  soNos?: string[];
}

interface Props {
  order: OrderDetail | null;
  localAppts: Record<string, string>;
  onClose: () => void;
  onSaveAppt: (orderId: string, value: string) => void;
  token: string | null;
}

// --- Helpers ---
function fmt(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function slaDeadline(createdTime: string) {
  return new Date(new Date(createdTime).getTime() + 48 * 60 * 60 * 1000);
}

function timeRemaining(createdTime: string) {
  const ms = slaDeadline(createdTime).getTime() - Date.now();
  const hrs = ms / (1000 * 60 * 60);
  if (ms <= 0) return { label: `${Math.abs(hrs).toFixed(1)}h overdue`, cls: "bad" };
  if (hrs < 1) return { label: `${Math.round(ms / 60000)}m remaining`, cls: "bad" };
  if (hrs < 4) return { label: `${hrs.toFixed(1)}h remaining`, cls: "warn" };
  return { label: `${hrs.toFixed(1)}h remaining`, cls: "good" };
}

function apptStatusLabel(apptTime?: string) {
  if (!apptTime) return { label: "No appointment", cls: "" };
  const diff = new Date(apptTime).getTime() - Date.now();
  if (diff < -3600000) return { label: "Missed", cls: "bad" };
  if (diff < 0) return { label: "Missed", cls: "bad" };
  if (diff <= 3600000) return { label: "Approaching (within 1h)", cls: "warn" };
  return { label: "Scheduled", cls: "good" };
}

const NOTES_KEY = "cesanekOrderNotes";
const APPT_STATUS_KEY = "cesanekApptStatuses";

function loadNotes(): Record<string, string> {
  try { const s = sessionStorage.getItem(NOTES_KEY); return s ? JSON.parse(s) : {}; } catch { return {}; }
}
function loadApptStatuses(): Record<string, string> {
  try { const s = sessionStorage.getItem(APPT_STATUS_KEY); return s ? JSON.parse(s) : {}; } catch { return {}; }
}

// --- Section component ---
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ fontSize: 11, fontWeight: 700, color: "#8899b4", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 8px", borderBottom: "1px solid #26344f", paddingBottom: 6 }}>{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
      <span style={{ color: "#8899b4" }}>{label}</span>
      <span style={{ color: "#eaf0ff", fontWeight: 500, textAlign: "right", maxWidth: "60%", wordBreak: "break-word" }}>{value || "—"}</span>
    </div>
  );
}

// --- Main Panel ---
export default function OrderDetailPanel({ order, localAppts, onClose, onSaveAppt, token }: Props) {
  const [editingAppt, setEditingAppt] = useState(false);
  const [apptValue, setApptValue] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editingNote, setEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState("");
  const [apptStatuses, setApptStatuses] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => { setNotes(loadNotes()); setApptStatuses(loadApptStatuses()); }, []);

  // Attempt to fetch full order detail
  useEffect(() => {
    if (!order || !token) { setDetail(null); return; }
    setDetail(order);
    setLoadingDetail(true);
    fetch("/api/wms", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-session-token": token },
      body: JSON.stringify({ path: "/wms-bam/outbound/order/raw-search", body: { id: order.id, currentPage: 1, pageSize: 1 } }),
    })
      .then(r => r.json())
      .then(json => {
        if (json?.success !== false && Array.isArray(json?.data) && json.data.length > 0) {
          setDetail(prev => ({ ...prev, ...json.data[0] }));
        }
      })
      .catch(() => {})
      .finally(() => setLoadingDetail(false));
  }, [order, token]);

  const saveNote = useCallback(() => {
    if (!order) return;
    const updated = { ...notes, [order.id]: noteValue };
    setNotes(updated);
    sessionStorage.setItem(NOTES_KEY, JSON.stringify(updated));
    setEditingNote(false);
  }, [order, noteValue, notes]);

  const setApptStatusOverride = useCallback((status: string) => {
    if (!order) return;
    const updated = { ...apptStatuses, [order.id]: status };
    setApptStatuses(updated);
    sessionStorage.setItem(APPT_STATUS_KEY, JSON.stringify(updated));
  }, [order, apptStatuses]);

  if (!order) return null;

  const o = detail || order;
  const effectiveAppt = localAppts[o.id] || o.appointmentTime;
  const isApptOverride = !!localAppts[o.id] && localAppts[o.id] !== o.appointmentTime;
  const sla = o.createdTime ? timeRemaining(o.createdTime) : null;
  const deadline = o.createdTime ? fmt(slaDeadline(o.createdTime).toISOString()) : "—";
  const as = apptStatusLabel(effectiveAppt);
  const localApptStatus = apptStatuses[o.id];
  const localNote = notes[o.id] || "";

  return (
    <div className="detail-overlay" onClick={onClose}>
      <aside className="detail-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, borderBottom: "1px solid #26344f", paddingBottom: 12 }}>
          <div>
            <p style={{ fontSize: 10, color: "#8899b4", margin: 0, textTransform: "uppercase", letterSpacing: "0.05em" }}>Order Detail</p>
            <h2 style={{ fontSize: 18, margin: "4px 0 0", color: "#eaf0ff" }}>{o.referenceNo || o.id}</h2>
          </div>
          <button onClick={onClose} style={{ background: "#26344f", border: 0, color: "#9aa8c7", borderRadius: 6, width: 32, height: 32, fontSize: 16, cursor: "pointer", display: "grid", placeItems: "center" }}>✕</button>
        </div>

        {loadingDetail && <p style={{ fontSize: 11, color: "#64748b" }}>Loading full details...</p>}

        {/* Customer Information */}
        <Section title="Customer Information">
          <Field label="Customer Name" value={o.customerName || o.customerCode} />
          <Field label="Account / Code" value={o.customerCode} />
          <Field label="Special Instructions" value={o.deliveryInstructions} />
        </Section>

        {/* Order Information */}
        <Section title="Order Information">
          <Field label="DN / Order #" value={o.referenceNo || o.id} />
          <Field label="PO / Reference" value={o.poNo} />
          <Field label="SO Number" value={o.soNos?.join(", ")} />
          <Field label="Status" value={o.status} />
          <Field label="Created" value={fmt(o.createdTime)} />
          <Field label="SLA Deadline" value={deadline} />
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
            <span style={{ color: "#8899b4" }}>Time Remaining</span>
            <span className={sla?.cls || ""} style={{ fontWeight: 600 }}>{sla?.label || "—"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
            <span style={{ color: "#8899b4" }}>Appointment</span>
            <span className={as.cls} style={{ fontWeight: 500 }}>
              {effectiveAppt ? fmt(effectiveAppt) : "—"}
              {isApptOverride && <span style={{ fontSize: 9, color: "#a99cff", marginLeft: 4 }}>draft</span>}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
            <span style={{ color: "#8899b4" }}>Appointment Status</span>
            <span className={as.cls} style={{ fontWeight: 500 }}>
              {localApptStatus || as.label}
              {localApptStatus && <span style={{ fontSize: 9, color: "#a99cff", marginLeft: 4 }}>override</span>}
            </span>
          </div>
        </Section>

        {/* Ship-To Information */}
        <Section title="Ship-To Information">
          <Field label="Name" value={o.shipToAddress?.name} />
          <Field label="Address" value={o.shipToAddress?.address1} />
          {o.shipToAddress?.address2 && <Field label="Address 2" value={o.shipToAddress.address2} />}
          <Field label="City" value={o.shipToAddress?.city} />
          <Field label="State" value={o.shipToAddress?.state} />
          <Field label="ZIP" value={o.shipToAddress?.zipCode} />
          <Field label="Contact" value={o.shipToAddress?.contact} />
          <Field label="Phone" value={o.shipToAddress?.phone} />
          <Field label="Delivery Instructions" value={o.deliveryInstructions || o.shipToAddress?.note} />
        </Section>

        {/* Carrier Information */}
        <Section title="Carrier Information">
          <Field label="Carrier" value={o.carrierName || o.carrierId} />
          <Field label="BOL #" value={o.bolNo} />
          <Field label="Load #" value={o.loadNo} />
          <Field label="Tracking #" value={o.trackingNo} />
        </Section>

        {/* Product Information */}
        <Section title="Product Information">
          {o.itemLines && o.itemLines.length > 0 ? (
            <div style={{ maxHeight: 160, overflowY: "auto" }}>
              <table style={{ width: "100%", minWidth: "auto", fontSize: 11 }}>
                <thead><tr style={{ borderBottom: "1px solid #26344f" }}><th style={{ textAlign: "left", padding: "4px 6px", color: "#8899b4", background: "transparent" }}>Item</th><th style={{ textAlign: "left", padding: "4px 6px", color: "#8899b4", background: "transparent" }}>Qty</th><th style={{ textAlign: "left", padding: "4px 6px", color: "#8899b4", background: "transparent" }}>UOM</th></tr></thead>
                <tbody>
                  {o.itemLines.map((line, i) => (
                    <tr key={i}><td style={{ padding: "3px 6px", color: "#cdd6f4" }}>{(line as {itemId?: string}).itemId || "—"}</td><td style={{ padding: "3px 6px", color: "#cdd6f4" }}>{(line as {qty?: number}).qty ?? "—"}</td><td style={{ padding: "3px 6px", color: "#cdd6f4" }}>{(line as {uom?: string}).uom || "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "#64748b" }}>Item line details not available from list view.</p>
          )}
          <Field label="Pallets" value={o.totalPallets} />
          <Field label="Weight" value={o.totalWeight ? `${o.totalWeight} lbs` : undefined} />
        </Section>

        {/* Notes & Activity */}
        <Section title="Notes & Activity">
          <Field label="Order Note" value={o.orderNote} />
          <Field label="Pick Note" value={o.pickNote} />
          <Field label="Pack Note" value={o.packNote} />
          {localNote && <Field label="Dashboard Note" value={localNote + " (local)"} />}
          <Field label="Last Updated" value={fmt(o.updatedTime)} />
          <Field label="Updated By" value={o.updatedBy} />
        </Section>

        {/* Action Buttons */}
        <div style={{ borderTop: "1px solid #26344f", paddingTop: 14, display: "grid", gap: 8 }}>
          <p style={{ fontSize: 10, color: "#64748b", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Actions</p>

          {/* Edit Appointment */}
          {editingAppt ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="datetime-local" value={apptValue} onChange={e => setApptValue(e.target.value)} style={{ flex: 1, fontSize: 12, padding: "6px 8px", background: "#101b31", border: "1px solid #26344f", color: "#eaf0ff", borderRadius: 6 }} />
              <button onClick={() => { onSaveAppt(o.id, apptValue); setEditingAppt(false); }} className="panel-btn primary">Save</button>
              <button onClick={() => setEditingAppt(false)} className="panel-btn">Cancel</button>
            </div>
          ) : (
            <button onClick={() => { setEditingAppt(true); setApptValue(effectiveAppt ? new Date(effectiveAppt).toISOString().slice(0, 16) : ""); }} className="panel-btn">Edit Appointment (draft)</button>
          )}

          {/* Add/Edit Note */}
          {editingNote ? (
            <div style={{ display: "grid", gap: 6 }}>
              <textarea value={noteValue} onChange={e => setNoteValue(e.target.value)} rows={3} placeholder="Add a dashboard note..." style={{ fontSize: 12, padding: "8px", background: "#101b31", border: "1px solid #26344f", color: "#eaf0ff", borderRadius: 6, resize: "vertical" }} />
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={saveNote} className="panel-btn primary">Save Note</button>
                <button onClick={() => setEditingNote(false)} className="panel-btn">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => { setEditingNote(true); setNoteValue(localNote); }} className="panel-btn">Add / Edit Notes (local)</button>
          )}

          {/* Send Notification */}
          <a href={`/dashboard/notifications`} className="panel-btn" style={{ textDecoration: "none", textAlign: "center" }}>Send Customer Notification</a>

          {/* Mark Appointment Status */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button onClick={() => setApptStatusOverride("Confirmed")} className={`panel-btn ${localApptStatus === "Confirmed" ? "active" : ""}`}>Mark Confirmed</button>
            <button onClick={() => setApptStatusOverride("Rescheduled")} className={`panel-btn ${localApptStatus === "Rescheduled" ? "active" : ""}`}>Mark Rescheduled</button>
            <button onClick={() => setApptStatusOverride("Missed")} className={`panel-btn ${localApptStatus === "Missed" ? "active" : ""}`}>Mark Missed</button>
          </div>
          <p style={{ fontSize: 10, color: "#64748b", margin: "4px 0 0" }}>Status overrides are saved locally and do not update WMS.</p>
        </div>
      </aside>
    </div>
  );
}
