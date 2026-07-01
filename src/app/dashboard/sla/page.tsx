"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";

// =============================================================================
// SLA MONITORING MODULE — Independent from Overview and Appointments
// Own constants, own data fetching, own state, own error handling.
// =============================================================================

type SlaOrder = {
  id: string;
  status?: string;
  customerName?: string;
  customerCode?: string;
  referenceNo?: string;
  poNo?: string;
  createdTime?: string;
  shipToAddress?: { name?: string; address1?: string; city?: string; state?: string; zipCode?: string; contact?: string; phone?: string };
  appointmentTime?: string;
  carrierId?: string;
  carrierName?: string;
  loadNo?: string;
  bolNo?: string;
  orderType?: string;
  totalPallets?: number;
  totalWeight?: number;
  itemLines?: { itemId?: string; description?: string; qty?: number; uom?: string }[];
  orderNote?: string;
  deliveryInstructions?: string;
  updatedTime?: string;
  updatedBy?: string;
  soNos?: string[];
};

// SLA module statuses — DO NOT import from Overview or share with other modules
const SLA_MODULE_STATUSES = ["IMPORTED", "COMMITTED", "PLANNED", "PICKED", "PACKED", "LOADED"] as const;
const SLA_MODULE_STATUS_LABELS: Record<string, string> = {
  IMPORTED: "Imported", COMMITTED: "Committed", PLANNED: "Planned",
  PICKED: "Picked", PACKED: "Packed", LOADED: "Loaded",
};

function threeMonthsAgo(): number {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.getTime();
}

function fmt(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function slaDeadline(createdTime: string) {
  return new Date(new Date(createdTime).getTime() + 48 * 60 * 60 * 1000);
}

// SLA display in days primarily, hours when <4h
interface SlaInfo { label: string; cls: string; category: "scheduled" | "appt-soon" | "appt-missed" | "healthy" | "approaching" | "critical" | "overdue" }

function getSlaStatus(createdTime?: string, appointmentTime?: string): SlaInfo {
  if (appointmentTime) {
    const appt = new Date(appointmentTime);
    const diffMs = appt.getTime() - Date.now();
    const diffHrs = diffMs / (1000 * 60 * 60);

    if (diffMs > 60 * 60 * 1000) {
      const days = diffHrs / 24;
      const label = days >= 1 ? `${days.toFixed(1)} Days to Appt` : `${diffHrs.toFixed(1)}h to Appt`;
      return { label, cls: "sla-normal", category: "scheduled" };
    }
    if (diffMs > 0) {
      return { label: `Appt in ${Math.round(diffMs / 60000)}m`, cls: "sla-approaching", category: "appt-soon" };
    }
    if (diffMs > -60 * 60 * 1000) {
      return { label: "Appt in progress", cls: "sla-approaching", category: "appt-soon" };
    }
    const overdueHrs = Math.abs(diffHrs);
    const label = overdueHrs >= 24 ? `Missed (${(overdueHrs / 24).toFixed(1)}d ago)` : `Missed (${overdueHrs.toFixed(1)}h ago)`;
    return { label, cls: "sla-critical", category: "appt-missed" };
  }

  if (!createdTime) return { label: "—", cls: "", category: "healthy" };
  const ms = slaDeadline(createdTime).getTime() - Date.now();
  const hrs = ms / (1000 * 60 * 60);
  const days = hrs / 24;

  if (ms <= 0) {
    const overdueDays = Math.abs(days);
    return { label: overdueDays >= 1 ? `${overdueDays.toFixed(1)} Days Past Due` : `${Math.abs(hrs).toFixed(1)}h Past Due`, cls: "sla-critical", category: "overdue" };
  }
  if (hrs < 1) return { label: `${Math.round(ms / 60000)}m Remaining`, cls: "sla-critical", category: "critical" };
  if (hrs < 4) return { label: `${hrs.toFixed(1)}h Remaining`, cls: "sla-approaching", category: "approaching" };
  return { label: days >= 1 ? `${days.toFixed(1)} Days Remaining` : `${hrs.toFixed(1)}h Remaining`, cls: "sla-normal", category: "healthy" };
}

function apptDisplayStatus(apptTime?: string): { label: string; cls: string } {
  if (!apptTime) return { label: "Missing", cls: "sla-critical" };
  const diff = new Date(apptTime).getTime() - Date.now();
  if (diff < -3600000) return { label: "Missed", cls: "sla-critical" };
  if (diff < 0) return { label: "In Progress", cls: "sla-approaching" };
  if (diff < 3600000) return { label: "Soon", cls: "sla-approaching" };
  return { label: "Scheduled", cls: "sla-normal" };
}

async function slaWmsProxy(token: string, path: string, body: unknown) {
  const res = await fetch("/api/wms", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-session-token": token },
    body: JSON.stringify({ path, body }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "SLA module: data could not be loaded.");
  return json;
}

// --- Detail Panel (SLA module's own) ---
function SlaDetailPanel({ order, localAppts, onClose, onSaveAppt, onMarkStatus, onSaveNote, localNotes }: { order: SlaOrder; localAppts: Record<string, string>; onClose: () => void; onSaveAppt: (id: string, val: string) => void; onMarkStatus: (id: string, status: string) => void; onSaveNote: (id: string, note: string) => void; localNotes: Record<string, string> }) {
  const [editAppt, setEditAppt] = useState(false);
  const [apptVal, setApptVal] = useState("");
  const [editNote, setEditNote] = useState(false);
  const [noteVal, setNoteVal] = useState(localNotes[order.id] || "");
  const effectiveAppt = localAppts[order.id] || order.appointmentTime;
  const localNote = localNotes[order.id] || "";

  return (
    <div className="detail-overlay" onClick={onClose}>
      <aside className="detail-panel" onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #26344f", paddingBottom: 12, marginBottom: 16 }}>
          <div>
            <p style={{ fontSize: 10, color: "#8899b4", margin: 0, textTransform: "uppercase" }}>Order Detail</p>
            <h2 style={{ fontSize: 18, margin: "4px 0 0", color: "#eaf0ff" }}>{order.referenceNo || order.id}</h2>
          </div>
          <button onClick={onClose} style={{ background: "#26344f", border: 0, color: "#9aa8c7", borderRadius: 6, width: 32, height: 32, fontSize: 16, cursor: "pointer" }}>✕</button>
        </div>

        <Section title="Customer Info">
          <Field label="Customer" value={order.customerName || order.customerCode} />
        </Section>
        <Section title="Order Info">
          <Field label="DN / Order #" value={order.referenceNo || order.id} />
          <Field label="RN" value={order.bolNo} />
          <Field label="Load #" value={order.loadNo} />
          <Field label="PO / Reference" value={order.poNo} />
          <Field label="Type" value={order.orderType} />
          <Field label="Status" value={order.status} />
          <Field label="Created" value={fmt(order.createdTime)} />
          <Field label="SLA Deadline" value={order.createdTime ? fmt(slaDeadline(order.createdTime).toISOString()) : "—"} />
        </Section>
        <Section title="Product Info">
          {order.itemLines?.length ? order.itemLines.slice(0, 5).map((l, i) => (
            <Field key={i} label={l.itemId || `Line ${i + 1}`} value={`${l.qty ?? "—"} ${l.uom || ""} — ${l.description || ""}`} />
          )) : <p style={{ fontSize: 12, color: "#64748b" }}>Not available from list view.</p>}
          <Field label="Pallets" value={order.totalPallets?.toString()} />
          <Field label="Weight" value={order.totalWeight ? `${order.totalWeight} lbs` : undefined} />
        </Section>
        <Section title="Shipping Info">
          <Field label="Carrier" value={order.carrierName || order.carrierId} />
          <Field label="Ship To" value={[order.shipToAddress?.name, order.shipToAddress?.city, order.shipToAddress?.state].filter(Boolean).join(", ")} />
          <Field label="Appointment" value={effectiveAppt ? fmt(effectiveAppt) : "Not set"} />
        </Section>
        <Section title="Actions">
          {editAppt ? (
            <div style={{ display: "flex", gap: 6 }}>
              <input type="datetime-local" value={apptVal} onChange={e => setApptVal(e.target.value)} style={{ flex: 1, fontSize: 12, padding: "6px 8px", background: "#101b31", border: "1px solid #26344f", color: "#eaf0ff", borderRadius: 6 }} />
              <button onClick={() => { onSaveAppt(order.id, apptVal); setEditAppt(false); }} className="panel-btn primary">Save</button>
              <button onClick={() => setEditAppt(false)} className="panel-btn">Cancel</button>
            </div>
          ) : (
            <button onClick={() => { setEditAppt(true); setApptVal(effectiveAppt ? new Date(effectiveAppt).toISOString().slice(0, 16) : ""); }} className="panel-btn">Edit Appointment (draft)</button>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <button onClick={() => { onMarkStatus(order.id, "Confirmed"); onClose(); }} className="panel-btn">Mark Confirmed</button>
            <button onClick={() => { onMarkStatus(order.id, "Missed"); onClose(); }} className="panel-btn" style={{ borderColor: "#7f1d1d", color: "#fca5a5" }}>Mark Missed</button>
            <button onClick={() => { onMarkStatus(order.id, "Rescheduled"); onClose(); }} className="panel-btn">Mark Rescheduled</button>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <a href="/dashboard/notifications" className="panel-btn" style={{ textDecoration: "none" }}>Send Customer Notification</a>
            <a href="/dashboard/notifications" className="panel-btn" style={{ textDecoration: "none" }}>Send Carrier Notification</a>
          </div>
          {editNote ? (
            <div style={{ marginTop: 8 }}>
              <textarea value={noteVal} onChange={e => setNoteVal(e.target.value)} rows={3} placeholder="Add a note..." style={{ width: "100%", fontSize: 12, padding: 8, background: "#101b31", border: "1px solid #26344f", color: "#eaf0ff", borderRadius: 6, resize: "vertical" }} />
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button onClick={() => { onSaveNote(order.id, noteVal); setEditNote(false); }} className="panel-btn primary">Save Note</button>
                <button onClick={() => setEditNote(false)} className="panel-btn">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setEditNote(true)} className="panel-btn" style={{ marginTop: 8 }}>Add / Edit Notes (local)</button>
          )}
          {localNote && <p style={{ fontSize: 11, color: "#a99cff", marginTop: 6 }}>Note: {localNote}</p>}
          <p style={{ fontSize: 10, color: "#64748b", marginTop: 8 }}>Draft overrides and notes are local and do not update WMS.</p>
        </Section>
      </aside>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 16 }}><h3 style={{ fontSize: 11, fontWeight: 700, color: "#8899b4", textTransform: "uppercase", margin: "0 0 6px", borderBottom: "1px solid #26344f", paddingBottom: 4 }}>{title}</h3>{children}</div>;
}
function Field({ label, value }: { label: string; value?: string | null }) {
  return <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12 }}><span style={{ color: "#8899b4" }}>{label}</span><span style={{ color: "#eaf0ff", fontWeight: 500, maxWidth: "60%", textAlign: "right", wordBreak: "break-word" }}>{value || "—"}</span></div>;
}

// --- Main SLA Component ---
export default function SlaPage() {
  const { token } = useAuth();
  const [orders, setOrders] = useState<SlaOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [customerSearch, setCustomerSearch] = useState("");
  const [rnSearch, setRnSearch] = useState("");
  const [dnSearch, setDnSearch] = useState("");
  const [carrierSearch, setCarrierSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([...SLA_MODULE_STATUSES]);
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [localAppts, setLocalAppts] = useState<Record<string, string>>({});
  const [localNotes, setLocalNotes] = useState<Record<string, string>>({});
  const [localStatuses, setLocalStatuses] = useState<Record<string, string>>({});
  const [editingAppt, setEditingAppt] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<SlaOrder | null>(null);

  useEffect(() => { const i = setInterval(() => setTick(t => t + 1), 30000); return () => clearInterval(i); }, []);
  useEffect(() => {
    try { const s = sessionStorage.getItem("cesanekApptOverrides"); if (s) setLocalAppts(JSON.parse(s)); } catch {}
    try { const s = sessionStorage.getItem("cesanekSlaLocalNotes"); if (s) setLocalNotes(JSON.parse(s)); } catch {}
    try { const s = sessionStorage.getItem("cesanekSlaLocalStatuses"); if (s) setLocalStatuses(JSON.parse(s)); } catch {}
  }, []);

  const saveApptOverride = useCallback((orderId: string, value: string) => {
    setLocalAppts(prev => { const next = { ...prev, [orderId]: value }; sessionStorage.setItem("cesanekApptOverrides", JSON.stringify(next)); return next; });
    setEditingAppt(null);
  }, []);

  const saveNote = useCallback((orderId: string, note: string) => {
    setLocalNotes(prev => { const next = { ...prev, [orderId]: note }; sessionStorage.setItem("cesanekSlaLocalNotes", JSON.stringify(next)); return next; });
  }, []);

  const markApptStatus = useCallback((orderId: string, status: string) => {
    setLocalStatuses(prev => { const next = { ...prev, [orderId]: status }; sessionStorage.setItem("cesanekSlaLocalStatuses", JSON.stringify(next)); return next; });
  }, []);

  async function load() {
    setLoading(true); setError("");
    try {
      if (!token) { setError("Please sign in to view SLA data."); setLoading(false); return; }
      const cutoffMs = threeMonthsAgo();
      let all: SlaOrder[] = [];
      let pg = 1;
      let totalPg = 1;

      while (pg <= totalPg && pg <= 15) {
        const json = await slaWmsProxy(token, "/wms-bam/outbound/order/search-by-paging", {
          currentPage: pg, pageSize: 100,
          statuses: [...SLA_MODULE_STATUSES],
          sortingFields: [{ field: "createdTime", orderBy: "ASC" }],
        });
        if (!json?.success) throw new Error("Order data could not be loaded.");
        all = all.concat(json.data?.list || []);
        totalPg = json.data?.totalPage || 1;
        pg++;
      }

      setOrders(all.filter(o => o.createdTime && new Date(o.createdTime).getTime() >= cutoffMs));
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Unable to load SLA data."); } finally { setLoading(false); }
  }

  useEffect(() => { if (token) load(); }, [token]);

  // Filtering
  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (o.status && !statusFilter.some(s => s.replace(/[\s_]/g, "").toUpperCase() === (o.status || "").replace(/[\s_]/g, "").toUpperCase())) return false;
      if (customerSearch && !(o.customerName || o.customerCode || "").toLowerCase().includes(customerSearch.toLowerCase())) return false;
      if (rnSearch && !(o.bolNo || "").toLowerCase().includes(rnSearch.toLowerCase())) return false;
      if (dnSearch && !(o.referenceNo || o.id || "").toLowerCase().includes(dnSearch.toLowerCase())) return false;
      if (carrierSearch && !(o.carrierName || o.carrierId || "").toLowerCase().includes(carrierSearch.toLowerCase())) return false;
      return true;
    });
  }, [orders, statusFilter, customerSearch, rnSearch, dnSearch, carrierSearch]);

  // Sort oldest first
  const sorted = useMemo(() => {
    void tick;
    return [...filtered].sort((a, b) => {
      const tA = a.createdTime ? new Date(a.createdTime).getTime() : Infinity;
      const tB = b.createdTime ? new Date(b.createdTime).getTime() : Infinity;
      return tA - tB;
    });
  }, [filtered, tick]);

  // Pagination
  const totalPages = Math.ceil(sorted.length / pageSize);
  const paginated = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // KPI stats
  const stats = useMemo(() => {
    void tick;
    let scheduled = 0, approaching = 0, critical = 0, outOfSla = 0, missingAppt = 0;
    filtered.forEach(o => {
      const effectiveAppt = localAppts[o.id] || o.appointmentTime;
      if (!effectiveAppt) missingAppt++;
      const sla = getSlaStatus(o.createdTime, effectiveAppt);
      if (sla.category === "scheduled") scheduled++;
      else if (sla.category === "appt-soon" || sla.category === "approaching") approaching++;
      else if (sla.category === "critical") critical++;
      else if (sla.category === "overdue" || sla.category === "appt-missed") outOfSla++;
    });
    return { total: filtered.length, scheduled, approaching, critical, outOfSla, missingAppt };
  }, [filtered, localAppts, tick]);

  const toggleStatus = (s: string) => setStatusFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  return (
    <>
      <h1>SLA Monitoring</h1>
      <p className="muted">Last 90 days · Sorted oldest to newest · SLA = Created + 48 hours (displayed in days).</p>
      <p style={{ fontSize: 11, color: "#64748b", margin: "2px 0 14px" }}>Orders with appointments show appointment status. Orders without appointments use 48-hour creation SLA.</p>

      {/* KPI Cards */}
      <section className="stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
        <div>Total Open<br /><b>{stats.total}</b></div>
        <div>Scheduled<br /><b className="good">{stats.scheduled}</b></div>
        <div>Approaching<br /><b className="warn">{stats.approaching}</b></div>
        <div>Critical<br /><b className="bad">{stats.critical}</b></div>
        <div>Out of SLA<br /><b className="bad">{stats.outOfSla}</b></div>
        <div>Missing Appt<br /><b style={{ color: "#ff7a45" }}>{stats.missingAppt}</b></div>
      </section>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, margin: "14px 0 8px", flexWrap: "wrap", alignItems: "center" }}>
        <input type="text" placeholder="Customer" value={customerSearch} onChange={e => { setCustomerSearch(e.target.value); setCurrentPage(1); }} className="filter-input" />
        <input type="text" placeholder="RN #" value={rnSearch} onChange={e => { setRnSearch(e.target.value); setCurrentPage(1); }} className="filter-input" style={{ width: 100 }} />
        <input type="text" placeholder="DN #" value={dnSearch} onChange={e => { setDnSearch(e.target.value); setCurrentPage(1); }} className="filter-input" style={{ width: 100 }} />
        <input type="text" placeholder="Carrier" value={carrierSearch} onChange={e => { setCarrierSearch(e.target.value); setCurrentPage(1); }} className="filter-input" style={{ width: 120 }} />
        <div style={{ position: "relative" }}>
          <button onClick={() => setShowStatusDropdown(!showStatusDropdown)} style={{ border: "1px solid #26344f", background: "#16233b", color: "#9aa8c7", borderRadius: 8, padding: "8px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
            Status: {statusFilter.length === SLA_MODULE_STATUSES.length ? "All" : `${statusFilter.length}`} ▾
          </button>
          {showStatusDropdown && (
            <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "#16233b", border: "1px solid #26344f", borderRadius: 10, padding: 10, zIndex: 50, minWidth: 160, boxShadow: "0 8px 24px #0008" }}>
              <button onClick={() => setStatusFilter([...SLA_MODULE_STATUSES])} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: "#5539f6", color: "#fff", border: 0, cursor: "pointer", marginBottom: 6 }}>All</button>
              {SLA_MODULE_STATUSES.map(s => (
                <label key={s} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", fontSize: 12, color: "#cdd6f4", cursor: "pointer" }}>
                  <input type="checkbox" checked={statusFilter.includes(s)} onChange={() => toggleStatus(s)} style={{ accentColor: "#5539f6" }} />
                  {SLA_MODULE_STATUS_LABELS[s]}
                </label>
              ))}
              <button onClick={() => setShowStatusDropdown(false)} style={{ marginTop: 6, fontSize: 10, padding: "4px 10px", borderRadius: 4, background: "#26344f", color: "#9aa8c7", border: 0, cursor: "pointer", width: "100%" }}>Close</button>
            </div>
          )}
        </div>
        <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }} className="filter-select">
          <option value={25}>25/page</option>
          <option value={50}>50/page</option>
          <option value={75}>75/page</option>
          <option value={100}>100/page</option>
        </select>
      </div>

      {error && <div className="notice">{error}</div>}
      <div className="actions">
        <button onClick={load} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button>
        <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1}>Previous</button>
        <button onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages}>Next</button>
        <span style={{ color: "#64748b", fontSize: 12, marginLeft: 8 }}>Page {currentPage} of {totalPages} · {filtered.length} orders (last 90 days)</span>
      </div>

      {/* Table */}
      <div className="table">
        <table>
          <thead>
            <tr>
              <th style={{ width: 24 }}></th>
              <th>Customer</th>
              <th>RN</th>
              <th>DN / Order #</th>
              <th>Load #</th>
              <th>PO / Ref</th>
              <th>Type</th>
              <th>Created</th>
              <th>SLA Deadline</th>
              <th>SLA Status</th>
              <th>Appointment</th>
              <th>Appt Status</th>
              <th>Carrier</th>
              <th>Pallets</th>
              <th>Weight</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={15} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Loading SLA data...</td></tr>}
            {!loading && paginated.length === 0 && !error && (
              <tr><td colSpan={15} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>No orders match the current filters.</td></tr>
            )}
            {paginated.map(o => {
              const effectiveAppt = localAppts[o.id] || o.appointmentTime;
              const sla = getSlaStatus(o.createdTime, effectiveAppt);
              const apptSt = apptDisplayStatus(effectiveAppt);
              const isOverride = !!localAppts[o.id] && localAppts[o.id] !== o.appointmentTime;
              return (
                <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => setSelectedOrder(o)}>
                  <td style={{ textAlign: "center", color: "#5539f6", fontSize: 12 }}>▶</td>
                  <td>{o.customerName || o.customerCode || "—"}</td>
                  <td>{o.bolNo || "—"}</td>
                  <td style={{ fontWeight: 600 }}>{o.referenceNo || o.id}</td>
                  <td>{o.loadNo || "—"}</td>
                  <td>{o.poNo || "—"}</td>
                  <td>{o.orderType || "—"}</td>
                  <td>{fmt(o.createdTime)}</td>
                  <td>{o.createdTime ? fmt(slaDeadline(o.createdTime).toISOString()) : "—"}</td>
                  <td><span className={sla.cls} style={{ fontWeight: 700 }}>{sla.label}</span></td>
                  <td onClick={e => e.stopPropagation()}>
                    {editingAppt === o.id ? (
                      <span style={{ display: "flex", gap: 3 }}>
                        <input type="datetime-local" value={editValue} onChange={e => setEditValue(e.target.value)} style={{ fontSize: 10, padding: "2px 4px", background: "#101b31", border: "1px solid #26344f", color: "#eaf0ff", borderRadius: 4, width: 145 }} />
                        <button onClick={() => saveApptOverride(o.id, editValue)} style={{ fontSize: 9, padding: "2px 5px", background: "#5539f6", color: "#fff", border: 0, borderRadius: 3, cursor: "pointer" }}>✓</button>
                        <button onClick={() => setEditingAppt(null)} style={{ fontSize: 9, padding: "2px 5px", background: "#26344f", color: "#9aa8c7", border: 0, borderRadius: 3, cursor: "pointer" }}>✕</button>
                      </span>
                    ) : (
                      <span onClick={() => { setEditingAppt(o.id); setEditValue(effectiveAppt ? new Date(effectiveAppt).toISOString().slice(0, 16) : ""); }} style={{ cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3 }} title="Click to edit">
                        {effectiveAppt ? fmt(effectiveAppt) : <span style={{ color: "#64748b" }}>+ Add</span>}
                        {isOverride && <span style={{ fontSize: 9, color: "#a99cff", marginLeft: 3 }}>draft</span>}
                      </span>
                    )}
                  </td>
                  <td><span className={apptSt.cls} style={{ fontWeight: 600 }}>{apptSt.label}</span></td>
                  <td>{o.carrierName || o.carrierId || "—"}</td>
                  <td>{o.totalPallets ?? "—"}</td>
                  <td>{o.totalWeight ? `${o.totalWeight}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Detail Panel */}
      {selectedOrder && (
        <SlaDetailPanel order={selectedOrder} localAppts={localAppts} localNotes={localNotes} onClose={() => setSelectedOrder(null)} onSaveAppt={saveApptOverride} onMarkStatus={markApptStatus} onSaveNote={saveNote} />
      )}
    </>
  );
}
