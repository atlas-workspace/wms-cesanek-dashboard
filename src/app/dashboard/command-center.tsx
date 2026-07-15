"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";

// =============================================================================
// COMMAND CENTER — Single operational view, no tab switching required.
// Uses same OVERVIEW_API_STATUSES as the locked Overview baseline.
// =============================================================================

type Order = {
  id: string; status?: string; customerName?: string; customerCode?: string;
  referenceNo?: string; poNo?: string; createdTime?: string;
  shipToAddress?: { name?: string; city?: string; state?: string };
  appointmentTime?: string; carrierId?: string; carrierName?: string;
  loadNo?: string; bolNo?: string; orderType?: string;
  totalPallets?: number; totalWeight?: number;
  itemLines?: { itemId?: string; description?: string; qty?: number; uom?: string }[];
  orderNote?: string; deliveryInstructions?: string; updatedTime?: string; updatedBy?: string;
};

type Appointment = {
  id: string; sid?: string; carrierId?: string; carrierName?: string;
  appointmentType?: string; appointmentTime?: string; apptStatus?: string;
  createdTime?: string; customerNames?: string[];
  appointmentActions?: { referenceNos?: string[]; receipts?: { customerName?: string }[]; loads?: { loadNo?: string; customerName?: string }[] }[];
};

const API_STATUSES = [
  "IMPORTED","OPEN","PARTIAL_COMMITTED","COMMIT_BLOCKED","COMMIT_FAILED",
  "COMMITTED","PLANNING","PLANNED","PICKING","PICKED","READY_TO_SHIP",
  "PACKING","PACKED","STAGED","LOADING","LOADED","REOPEN","EXCEPTION",
  "PARTIAL_SHIPPED","BLOCKED","ON_HOLD",
];

function fmt(d?: string) { if (!d) return "—"; return new Date(d).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
function slaDeadline(ct: string) { return new Date(new Date(ct).getTime() + 48*3600000); }

function slaInfo(ct?: string, appt?: string): { label: string; cls: string; priority: number } {
  if (appt) {
    const diff = new Date(appt).getTime() - Date.now();
    if (diff > 3600000) return { label: "Scheduled", cls: "good", priority: 5 };
    if (diff > 0) return { label: `Appt ${Math.round(diff/60000)}m`, cls: "warn", priority: 3 };
    if (diff > -3600000) return { label: "In Progress", cls: "warn", priority: 3 };
    const h = Math.abs(diff/3600000);
    return { label: h >= 24 ? `Missed ${(h/24).toFixed(1)}d` : `Missed ${h.toFixed(1)}h`, cls: "bad", priority: 2 };
  }
  if (!ct) return { label: "—", cls: "", priority: 5 };
  const ms = slaDeadline(ct).getTime() - Date.now();
  const hrs = ms / 3600000;
  if (ms <= 0) { const d = Math.abs(hrs)/24; return { label: d >= 1 ? `${d.toFixed(1)}d Past Due` : `${Math.abs(hrs).toFixed(1)}h Past Due`, cls: "bad", priority: 0 }; }
  if (hrs < 1) return { label: `${Math.round(ms/60000)}m`, cls: "bad", priority: 1 };
  if (hrs < 4) return { label: `${hrs.toFixed(1)}h`, cls: "warn", priority: 3 };
  const d = hrs/24; return { label: d >= 1 ? `${d.toFixed(1)}d` : `${hrs.toFixed(1)}h`, cls: "good", priority: 5 };
}

function getApptCustomer(a: Appointment): string {
  if (a.customerNames?.length) return a.customerNames[0];
  for (const act of a.appointmentActions || []) {
    const c = act.receipts?.find(r => r.customerName) || act.loads?.find(l => l.customerName);
    if (c && "customerName" in c) return c.customerName!;
  }
  return "—";
}

async function wmsPost(token: string, path: string, body: unknown) {
  const res = await fetch("/api/wms", { method: "POST", headers: { "Content-Type": "application/json", "x-session-token": token }, body: JSON.stringify({ path, body }) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Data unavailable.");
  return json;
}

// --- Collapsible Section ---
function Section({ title, defaultOpen = true, children, badge }: { title: string; defaultOpen?: boolean; children: React.ReactNode; badge?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 16 }}>
      <button onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", background: "none", border: 0, padding: "8px 0", cursor: "pointer", textAlign: "left" }}>
        <span style={{ color: "#5539f6", fontSize: 12, width: 16 }}>{open ? "▼" : "▶"}</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#eaf0ff" }}>{title}</span>
        {badge}
      </button>
      {open && <div style={{ marginTop: 4 }}>{children}</div>}
    </div>
  );
}

// --- Drawer ---
function Drawer({ order, onClose, localAppts, onSaveAppt }: { order: Order; onClose: () => void; localAppts: Record<string,string>; onSaveAppt: (id:string,v:string)=>void }) {
  const [editAppt, setEditAppt] = useState(false);
  const [apptVal, setApptVal] = useState("");
  const ea = localAppts[order.id] || order.appointmentTime;
  return (
    <div className="detail-overlay" onClick={onClose}>
      <aside className="detail-panel" onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #26344f", paddingBottom: 10, marginBottom: 12 }}>
          <div><p style={{ fontSize: 10, color: "#8899b4", margin: 0 }}>ORDER DETAIL</p><h2 style={{ fontSize: 16, margin: "2px 0 0", color: "#eaf0ff" }}>{order.referenceNo || order.id}</h2></div>
          <button onClick={onClose} style={{ background: "#26344f", border: 0, color: "#9aa8c7", borderRadius: 6, width: 28, height: 28, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ fontSize: 12, color: "#cdd6f4", display: "grid", gap: 4 }}>
          <Row l="Customer" v={order.customerName || order.customerCode} />
          <Row l="DN / Order" v={order.referenceNo || order.id} />
          <Row l="Load #" v={order.loadNo} />
          <Row l="PO / Ref" v={order.poNo} />
          <Row l="Status" v={order.status} />
          <Row l="Created" v={fmt(order.createdTime)} />
          <Row l="SLA Deadline" v={order.createdTime ? fmt(slaDeadline(order.createdTime).toISOString()) : "—"} />
          <Row l="Carrier" v={order.carrierName || order.carrierId} />
          <Row l="Ship To" v={[order.shipToAddress?.name, order.shipToAddress?.city, order.shipToAddress?.state].filter(Boolean).join(", ")} />
          <Row l="Appointment" v={ea ? fmt(ea) : "Not set"} />
          <Row l="Pallets" v={order.totalPallets?.toString()} />
          <Row l="Weight" v={order.totalWeight ? `${order.totalWeight} lbs` : undefined} />
        </div>
        <div style={{ borderTop: "1px solid #26344f", marginTop: 12, paddingTop: 10 }}>
          {editAppt ? (
            <div style={{ display: "flex", gap: 6 }}>
              <input type="datetime-local" value={apptVal} onChange={e => setApptVal(e.target.value)} style={{ flex: 1, fontSize: 11, padding: "5px 6px", background: "#101b31", border: "1px solid #26344f", color: "#eaf0ff", borderRadius: 5 }} />
              <button onClick={() => { onSaveAppt(order.id, apptVal); setEditAppt(false); }} className="panel-btn primary" style={{ padding: "5px 10px", fontSize: 11 }}>Save</button>
              <button onClick={() => setEditAppt(false)} className="panel-btn" style={{ padding: "5px 10px", fontSize: 11 }}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button onClick={() => { setEditAppt(true); setApptVal(ea ? new Date(ea).toISOString().slice(0,16) : ""); }} className="panel-btn" style={{ fontSize: 11 }}>Edit Appointment</button>
              <a href="/dashboard/notifications" className="panel-btn" style={{ textDecoration: "none", fontSize: 11 }}>Send Notification</a>
            </div>
          )}
          <p style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}>Appointment edits are dashboard drafts and do not update WMS.</p>
        </div>
      </aside>
    </div>
  );
}
function Row({ l, v }: { l: string; v?: string | null }) {
  return <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8899b4" }}>{l}</span><span style={{ fontWeight: 500, maxWidth: "55%", textAlign: "right", wordBreak: "break-word" }}>{v || "—"}</span></div>;
}

// --- Compact carrier chart ---
function CarrierMiniChart({ data }: { data: { label: string; value: number }[] }) {
  const sorted = [...data].sort((a, b) => b.value - a.value).slice(0, 10);
  if (!sorted.length) return <p style={{ color: "#64748b", fontSize: 11 }}>No missed appointment data.</p>;
  const max = Math.max(...sorted.map(d => d.value), 1);
  return (
    <div style={{ maxHeight: 200, overflowY: "auto" }}>
      {sorted.map(d => (
        <div key={d.label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: "#9aa8c7", width: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.label}>{d.label}</span>
          <div style={{ flex: 1, height: 14, background: "#1e2d47", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${(d.value/max)*100}%`, height: "100%", background: "#ff7a45", borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: 10, color: "#eaf0ff", fontWeight: 700, width: 24, textAlign: "right" }}>{d.value}</span>
        </div>
      ))}
    </div>
  );
}

// --- Cutoff Timer ---
function CutoffTimer() {
  const [, setT] = useState(0);
  useEffect(() => { const i = setInterval(() => setT(t => t + 1), 60000); return () => clearInterval(i); }, []);
  const now = new Date();
  const est = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const cutoff = new Date(est); cutoff.setHours(16, 0, 0, 0);
  if (est >= cutoff) return <span style={{ color: "#fb7185", fontWeight: 700, fontSize: 11, animation: "pulse 1s infinite" }}>⚠ PAST CUTOFF</span>;
  const diff = cutoff.getTime() - est.getTime();
  const h = Math.floor(diff / 3600000); const m = Math.floor((diff % 3600000) / 60000);
  const color = h >= 2 ? "#4ade80" : h >= 1 ? "#facc15" : m >= 30 ? "#ff7a45" : "#fb7185";
  return <span style={{ color, fontWeight: 700, fontSize: 11 }}>Cutoff: {h}h {m}m</span>;
}

// =============================================================================
// MASTER OPERATIONS CONTROL CENTER
// =============================================================================
export default function CommandCenter() {
  const { token } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [localAppts, setLocalAppts] = useState<Record<string, string>>({});
  const [drawerOrder, setDrawerOrder] = useState<Order | null>(null);

  const [refreshedAt, setRefreshedAt] = useState<string>("");
  const [stale, setStale] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");

  // Live refresh interval — 10 minutes production default
  const REFRESH_INTERVAL_MS = 600000;

  useEffect(() => { const i = setInterval(() => setTick(t => t + 1), 30000); return () => clearInterval(i); }, []);
  useEffect(() => { try { const s = sessionStorage.getItem("cesanekApptOverrides"); if (s) setLocalAppts(JSON.parse(s)); } catch {} }, []);

  const saveAppt = useCallback((id: string, val: string) => {
    setLocalAppts(prev => { const n = { ...prev, [id]: val }; sessionStorage.setItem("cesanekApptOverrides", JSON.stringify(n)); return n; });
  }, []);

  const loadData = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(""); setStale(false);
    try {
      const [ordJson, apptJson] = await Promise.all([
        wmsPost(token, "/wms-bam/outbound/order/search-by-paging", { currentPage: 1, pageSize: 100, statuses: API_STATUSES, sortingFields: [{ field: "createdTime", orderBy: "DESC" }] }),
        wmsPost(token, "/wms-bam/appointment/search-by-paging", { currentPage: 1, pageSize: 100 }).catch(() => null),
      ]);
      if (ordJson?.success) setOrders(ordJson.data?.list || []);
      else if (Array.isArray(ordJson?.data)) setOrders(ordJson.data);
      if (apptJson?.success) setAppointments(apptJson.data?.list || []);
      else if (apptJson && Array.isArray(apptJson?.data)) setAppointments(apptJson.data);
      setRefreshedAt(new Date().toLocaleString("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unable to retrieve the latest appointment data. Retrying...");
      setStale(true);
    }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh every 45 seconds
  useEffect(() => {
    const i = setInterval(() => { loadData(); }, REFRESH_INTERVAL_MS);
    return () => clearInterval(i);
  }, [loadData]);

  // --- Computed data (filtered by global search) ---
  const searchedOrders = useMemo(() => {
    if (!globalSearch) return orders;
    const q = globalSearch.toLowerCase();
    return orders.filter(o =>
      (o.customerName || "").toLowerCase().includes(q) ||
      (o.customerCode || "").toLowerCase().includes(q) ||
      (o.referenceNo || "").toLowerCase().includes(q) ||
      (o.loadNo || "").toLowerCase().includes(q) ||
      (o.carrierId || "").toLowerCase().includes(q) ||
      (o.carrierName || "").toLowerCase().includes(q) ||
      (o.poNo || "").toLowerCase().includes(q) ||
      (o.bolNo || "").toLowerCase().includes(q) ||
      o.id.toLowerCase().includes(q)
    );
  }, [orders, globalSearch]);

  const orderMetrics = useMemo(() => {
    void tick;
    const items = searchedOrders.map(o => {
      const ea = localAppts[o.id] || o.appointmentTime;
      const s = slaInfo(o.createdTime, ea);
      return { ...o, sla: s, effectiveAppt: ea };
    });
    const outOfSla = items.filter(i => i.sla.priority <= 0);
    const critical = items.filter(i => i.sla.priority === 1);
    const approaching = items.filter(i => i.sla.priority === 3);
    const scheduled = items.filter(i => i.sla.priority === 5);
    const missingAppt = items.filter(i => !i.effectiveAppt);
    const attention = [...outOfSla, ...critical, ...approaching].sort((a,b) => a.sla.priority - b.sla.priority).slice(0, 20);
    return { total: items.length, outOfSla: outOfSla.length, critical: critical.length, approaching: approaching.length, scheduled: scheduled.length, missingAppt: missingAppt.length, attention, all: items };
  }, [orders, localAppts, tick]);

  const apptMetrics = useMemo(() => {
    void tick;
    const now = Date.now();
    let missed = 0, pending = 0;
    const missedList: (Appointment & { customer: string })[] = [];
    const carrierMissed: Record<string, number> = {};
    const customerMissed: Record<string, number> = {};

    appointments.forEach(a => {
      const status = (a.apptStatus || "").toUpperCase();
      if (status === "COMPLETED" || status === "CHECKED_IN" || status === "CONFIRM") return;
      if (!a.appointmentTime) { pending++; return; }
      const diff = new Date(a.appointmentTime).getTime() - now;
      if (diff < -3600000) {
        missed++;
        const cust = getApptCustomer(a);
        const carrier = a.carrierName || a.carrierId || "Unknown";
        carrierMissed[carrier] = (carrierMissed[carrier] || 0) + 1;
        customerMissed[cust] = (customerMissed[cust] || 0) + 1;
        missedList.push({ ...a, customer: cust });
      } else if (diff > 0) { pending++; }
    });

    const worstCarrier = Object.entries(carrierMissed).sort((a,b) => b[1] - a[1])[0];
    const mostImpacted = Object.entries(customerMissed).sort((a,b) => b[1] - a[1])[0];
    const carrierData = Object.entries(carrierMissed).map(([label, value]) => ({ label, value }));
    const missedPct = appointments.length > 0 ? Math.round(missed / appointments.length * 100) : 0;

    return { missed, pending, missedPct, worstCarrier: worstCarrier?.[0] || "—", mostImpacted: mostImpacted?.[0] || "—", missedList: missedList.slice(0, 20), carrierData };
  }, [appointments, tick]);

  return (
    <>
      {/* Operations Control Center Header */}
      <div className="exception-banner" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <span style={{ color: "#eaf0ff", fontWeight: 700 }}>Operations Control Center</span>
          <span style={{ color: "#8899b4" }}>{new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" })}</span>
          <span style={{ color: "#8899b4" }}>Hours: 8:00 AM – 4:00 PM</span>
          <CutoffTimer />
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ color: stale ? "#fb7185" : "#4ade80", fontSize: 10 }}>{stale ? "● WMS Disconnected" : "● WMS Connected"}</span>
          {refreshedAt && <span style={{ fontSize: 10, color: "#64748b" }}>Updated: {refreshedAt}</span>}
        </div>
      </div>

      {/* Exception Summary */}
      <div style={{ display: "flex", gap: 12, padding: "6px 0", fontSize: 11, fontWeight: 700, flexWrap: "wrap" }}>
        <span className="bad">🔴 Out of SLA: {orderMetrics.outOfSla}</span>
        <span className="bad">🔴 Critical: {orderMetrics.critical}</span>
        <span className="warn">🟡 Approaching: {orderMetrics.approaching}</span>
        <span className="bad">🔴 Missed Appts: {apptMetrics.missed}</span>
        <span style={{ color: "#ff7a45" }}>⚠ Exceptions: {orderMetrics.missingAppt}</span>
      </div>

      {/* Global Search */}
      <div style={{ margin: "8px 0", display: "flex", gap: 8, alignItems: "center" }}>
        <input type="text" placeholder="Search by Customer, RN, DN, Load, Carrier, PO..." value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} style={{ flex: 1, maxWidth: 400, border: "1px solid #26344f", background: "#101b31", color: "#eaf0ff", borderRadius: 6, padding: "7px 12px", fontSize: 12 }} />
        {globalSearch && <button onClick={() => setGlobalSearch("")} style={{ border: 0, background: "#26344f", color: "#9aa8c7", borderRadius: 4, padding: "4px 8px", fontSize: 10, cursor: "pointer" }}>Clear</button>}
      </div>

      {/* Compact KPI Row */}
      <div className="kpi-row">
        <div className="kpi-card"><span className="kpi-label">Open Orders</span><span className="kpi-value">{orderMetrics.total}</span></div>
        <div className="kpi-card"><span className="kpi-label">Scheduled</span><span className="kpi-value good">{orderMetrics.scheduled}</span></div>
        <div className="kpi-card"><span className="kpi-label">Approaching</span><span className="kpi-value warn">{orderMetrics.approaching}</span></div>
        <div className="kpi-card"><span className="kpi-label">Critical</span><span className="kpi-value bad">{orderMetrics.critical}</span></div>
        <div className="kpi-card"><span className="kpi-label">Out of SLA</span><span className="kpi-value bad">{orderMetrics.outOfSla}</span></div>
        <div className="kpi-card"><span className="kpi-label">Missed Appts</span><span className="kpi-value bad">{apptMetrics.missed}</span></div>
      </div>

      {error && <div className="notice" style={{ borderColor: stale ? "#fb7185" : undefined }}>
        {error}
        {stale && refreshedAt && <span style={{ display: "block", fontSize: 10, marginTop: 4, color: "#9aa8c7" }}>Last successful update: {refreshedAt}</span>}
      </div>}
      {loading && <p style={{ color: "#64748b", fontSize: 12 }}>Loading operational data...</p>}
      {!loading && !error && orders.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "#9aa8c7", fontSize: 13 }}>
          <p style={{ margin: "0 0 8px" }}>No open orders loaded. This may indicate a session issue or no matching open orders in the facility.</p>
          <button onClick={loadData} className="linkbtn" style={{ fontSize: 12, padding: "8px 16px" }}>Retry</button>
        </div>
      )}

      {/* 3-Panel Command Center */}
      <div className="cmd-panels">
        {/* LEFT: Orders Requiring Attention */}
        <div className="cmd-panel">
          <Section title="Orders Requiring Attention" badge={<span className="bad" style={{ fontSize: 11, marginLeft: 6 }}>{orderMetrics.attention.length}</span>}>
            <div style={{ maxHeight: 480, overflowY: "auto" }}>
              <table style={{ width: "100%", minWidth: "auto" }}>
                <thead><tr><th>Customer</th><th>DN</th><th>SLA</th><th>Appt</th></tr></thead>
                <tbody>
                  {orderMetrics.attention.map(o => (
                    <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => setDrawerOrder(o)}>
                      <td style={{ fontSize: 11 }}>{(o.customerName || o.customerCode || "—").slice(0, 18)}</td>
                      <td style={{ fontSize: 11, fontWeight: 600 }}>{(o.referenceNo || o.id).slice(0, 12)}</td>
                      <td><span className={o.sla.cls} style={{ fontSize: 11, fontWeight: 700 }}>{o.sla.label}</span></td>
                      <td style={{ fontSize: 10 }}>{o.effectiveAppt ? fmt(o.effectiveAppt).slice(0, 12) : "—"}</td>
                    </tr>
                  ))}
                  {orderMetrics.attention.length === 0 && <tr><td colSpan={4} style={{ color: "#64748b", textAlign: "center", padding: 20 }}>No orders requiring immediate attention.</td></tr>}
                </tbody>
              </table>
            </div>
          </Section>
        </div>

        {/* CENTER: Appointment Exceptions */}
        <div className="cmd-panel">
          <Section title="Appointment Exceptions" badge={<span className="bad" style={{ fontSize: 11, marginLeft: 6 }}>{apptMetrics.missed}</span>}>
            <div style={{ maxHeight: 480, overflowY: "auto" }}>
              <table style={{ width: "100%", minWidth: "auto" }}>
                <thead><tr><th>Customer</th><th>Carrier</th><th>Scheduled</th><th>Status</th></tr></thead>
                <tbody>
                  {apptMetrics.missedList.map(a => (
                    <tr key={a.id}>
                      <td style={{ fontSize: 11 }}>{a.customer.slice(0, 18)}</td>
                      <td style={{ fontSize: 11 }}>{(a.carrierName || a.carrierId || "—").slice(0, 14)}</td>
                      <td style={{ fontSize: 10 }}>{fmt(a.appointmentTime).slice(0, 12)}</td>
                      <td><span className="bad" style={{ fontSize: 10, fontWeight: 700 }}>Missed</span></td>
                    </tr>
                  ))}
                  {apptMetrics.missedList.length === 0 && <tr><td colSpan={4} style={{ color: "#64748b", textAlign: "center", padding: 20 }}>No missed appointments.</td></tr>}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: "#64748b" }}>Pending: {apptMetrics.pending} · Missed %: {apptMetrics.missedPct}%</div>
          </Section>
        </div>

        {/* RIGHT: Carrier Performance */}
        <div className="cmd-panel">
          <Section title="Carrier Performance">
            <div style={{ fontSize: 11, color: "#9aa8c7", marginBottom: 8 }}>
              <div>Worst: <b style={{ color: "#fb7185" }}>{apptMetrics.worstCarrier}</b></div>
              <div>Most Impacted: <b style={{ color: "#a99cff" }}>{apptMetrics.mostImpacted}</b></div>
              <div>Missed Rate: <b className="bad">{apptMetrics.missedPct}%</b></div>
            </div>
            <p style={{ fontSize: 10, color: "#64748b", margin: "0 0 4px" }}>Top Carriers by Missed (last load)</p>
            <CarrierMiniChart data={apptMetrics.carrierData} />
          </Section>
        </div>
      </div>

      {/* Collapsible Sections below the fold */}
      <Section title="Appointments" defaultOpen={false} badge={<span style={{ fontSize: 10, color: "#64748b", marginLeft: 8 }}>Scheduling & pending</span>}>
        <p style={{ fontSize: 12, color: "#9aa8c7" }}>
          {apptMetrics.pending} pending appointments · {apptMetrics.missed} missed · {apptMetrics.missedPct}% miss rate
        </p>
        <a href="/dashboard/missed-appointments" style={{ fontSize: 12, color: "#5539f6", textDecoration: "none" }}>Open full Appointments dashboard →</a>
      </Section>

      <Section title="Carrier Analytics" defaultOpen={false} badge={<span style={{ fontSize: 10, color: "#64748b", marginLeft: 8 }}>Historical performance</span>}>
        <CarrierMiniChart data={apptMetrics.carrierData} />
        <a href="/dashboard/missed-appointments" style={{ fontSize: 12, color: "#5539f6", textDecoration: "none", marginTop: 8, display: "inline-block" }}>Open full analytics →</a>
      </Section>

      <Section title="Notifications" defaultOpen={false} badge={<span style={{ fontSize: 10, color: "#64748b", marginLeft: 8 }}>Customer & carrier communications</span>}>
        <p style={{ fontSize: 12, color: "#9aa8c7" }}>Send missed appointment, reschedule, or reminder notifications to customers and carriers.</p>
        <a href="/dashboard/notifications" style={{ fontSize: 12, color: "#5539f6", textDecoration: "none" }}>Open Notifications →</a>
      </Section>

      {/* SLA Performance Module */}
      <Section title="SLA Performance" defaultOpen={false} badge={<span style={{ fontSize: 10, color: "#64748b", marginLeft: 8 }}>Compliance overview</span>}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 6, fontSize: 11 }}>
          <div style={{ background: "#101b31", borderRadius: 6, padding: 8 }}><span style={{ color: "#8899b4" }}>On Track</span><br /><b className="good">{orderMetrics.scheduled}</b></div>
          <div style={{ background: "#101b31", borderRadius: 6, padding: 8 }}><span style={{ color: "#8899b4" }}>At Risk</span><br /><b className="warn">{orderMetrics.approaching + orderMetrics.critical}</b></div>
          <div style={{ background: "#101b31", borderRadius: 6, padding: 8 }}><span style={{ color: "#8899b4" }}>Breached</span><br /><b className="bad">{orderMetrics.outOfSla}</b></div>
          <div style={{ background: "#101b31", borderRadius: 6, padding: 8 }}><span style={{ color: "#8899b4" }}>Compliance</span><br /><b className="good">{orderMetrics.total > 0 ? Math.round((orderMetrics.scheduled / orderMetrics.total) * 100) : 0}%</b></div>
        </div>
        <a href="/dashboard/sla" style={{ fontSize: 11, color: "#5539f6", textDecoration: "none", marginTop: 8, display: "inline-block" }}>Open full SLA dashboard →</a>
      </Section>

      {/* Customer Performance Module */}
      <Section title="Customer Impact" defaultOpen={false} badge={<span style={{ fontSize: 10, color: "#64748b", marginLeft: 8 }}>Highest exceptions</span>}>
        {apptMetrics.mostImpacted !== "—" ? (
          <div style={{ fontSize: 11, color: "#9aa8c7" }}>Most impacted: <b style={{ color: "#a99cff" }}>{apptMetrics.mostImpacted}</b></div>
        ) : <p style={{ fontSize: 11, color: "#64748b" }}>No customer exception data available.</p>}
      </Section>

      {/* Exceptions Queue */}
      <Section title="Exceptions Queue" defaultOpen={false} badge={<span className="bad" style={{ fontSize: 10, marginLeft: 8 }}>{orderMetrics.missingAppt + apptMetrics.missed}</span>}>
        <div style={{ fontSize: 11, color: "#9aa8c7" }}>
          <div>Missing Appointments: <b style={{ color: "#ff7a45" }}>{orderMetrics.missingAppt}</b></div>
          <div>Missed Appointments: <b className="bad">{apptMetrics.missed}</b></div>
          <div>SLA Breached: <b className="bad">{orderMetrics.outOfSla}</b></div>
        </div>
        <a href="/dashboard/missed-appointments" style={{ fontSize: 11, color: "#5539f6", textDecoration: "none", marginTop: 6, display: "inline-block" }}>Open Exceptions →</a>
      </Section>

      {/* Activity Feed */}
      <Section title="Recent Activity" defaultOpen={false} badge={<span style={{ fontSize: 10, color: "#64748b", marginLeft: 8 }}>Notifications & workflow</span>}>
        <p style={{ fontSize: 11, color: "#9aa8c7" }}>View workflow actions, notifications, and status changes.</p>
        <a href="/dashboard/activity-log" style={{ fontSize: 11, color: "#5539f6", textDecoration: "none" }}>Open Activity Log →</a>
      </Section>

      <div className="actions" style={{ marginTop: 12 }}>
        <button onClick={loadData} disabled={loading}>{loading ? "Refreshing..." : "Refresh All"}</button>
        <span style={{ color: "#64748b", fontSize: 10 }}>{orderMetrics.total} orders · {appointments.length} appointments · 10m refresh</span>
      </div>

      {/* Drawer */}
      {drawerOrder && <Drawer order={drawerOrder} onClose={() => setDrawerOrder(null)} localAppts={localAppts} onSaveAppt={saveAppt} />}
    </>
  );
}
