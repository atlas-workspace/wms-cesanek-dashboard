"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";

// =============================================================================
// LTL APPOINTMENT MANAGEMENT MODULE — Fully independent
// Uses shipMethod: "LTL" from WMS raw-search API
// =============================================================================

interface LtlOrder {
  id: string;
  status?: string;
  customerName?: string;
  customerCode?: string;
  referenceNo?: string;
  poNo?: string;
  bolNo?: string;
  loadNo?: string;
  carrierId?: string;
  carrierName?: string;
  appointmentTime?: string;
  createdTime?: string;
  shipMethod?: string;
  orderType?: string;
}

interface RolloverEntry {
  originalAppt: string;
  newAppt: string;
  timestamp: string;
  reason: string;
  user: string;
  wmsStatus?: "pending" | "verified" | "failed";
  emailStatus?: "draft" | "sent" | "failed";
  retryCount?: number;
  processingTimeMs?: number;
}

interface LtlState {
  apptOverride?: string;
  status?: string;
  rollovers: RolloverEntry[];
  rolloverCount: number;
  notes: string;
  notificationDraft?: string;
}

// --- Holiday/Calendar Configuration ---
// PRODUCTION NOTE: For production deployment, these should be loaded from
// a configuration service or database. Scheduled background job (Azure Function,
// AWS Lambda, cron) should call the /api/ltl-rollover-scan endpoint independently
// of browser sessions for reliable automation.
const WAREHOUSE_HOLIDAYS: string[] = []; // ISO date strings e.g. ["2025-12-25"]
const CARRIER_BLACKOUT_DATES: string[] = []; // Carrier-specific unavailable dates
const WAREHOUSE_OPERATING_HOURS = { start: 7, end: 16 }; // 7am-4pm ET

const LTL_OPEN_STATUSES = ["IMPORTED", "OPEN", "COMMITTED", "PLANNED", "PICKING", "PICKED", "PACKING", "PACKED", "STAGED", "LOADING", "LOADED", "READY_TO_SHIP", "PARTIAL_COMMITTED", "PARTIAL_SHIPPED", "EXCEPTION", "BLOCKED", "ON_HOLD", "REOPEN"];
const FINAL_STATUSES = ["SHIPPED", "COMPLETED", "CANCELLED", "SHORT_SHIPPED"];

function fmt(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function isMissed(apptTime: string | undefined, status?: string): boolean {
  if (!apptTime) return false;
  const diff = Date.now() - new Date(apptTime).getTime();
  if (diff < 60 * 60 * 1000) return false; // within 1h grace
  const upper = (status || "").toUpperCase();
  if (["COMPLETED", "COMPLETE", "CHECKED_IN", "CONFIRM", "CANCELLED"].includes(upper)) return false;
  return true;
}

function timeSinceMissed(apptTime: string): string {
  const ms = Date.now() - new Date(apptTime).getTime();
  const hrs = ms / (1000 * 60 * 60);
  if (hrs >= 24) return `${(hrs / 24).toFixed(1)} days`;
  return `${hrs.toFixed(1)}h`;
}

function getNextBusinessDay(from: Date): Date {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  let attempts = 0;
  while (attempts < 30) {
    const isWeekend = next.getDay() === 0 || next.getDay() === 6;
    const dateStr = next.toISOString().slice(0, 10);
    const isHoliday = WAREHOUSE_HOLIDAYS.includes(dateStr) || CARRIER_BLACKOUT_DATES.includes(dateStr);
    if (!isWeekend && !isHoliday) break;
    next.setDate(next.getDate() + 1);
    attempts++;
  }
  next.setHours(WAREHOUSE_OPERATING_HOURS.start, 0, 0, 0);
  return next;
}

// 4:00 PM ET is the daily pickup cutoff
function isPastCutoff(): boolean {
  const now = new Date();
  const estNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  return estNow.getHours() >= 16;
}

function calculateRolloverTime(missedAppt: string): string {
  const now = new Date();
  const estNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = estNow.getHours();

  // After 4:00 PM cutoff or after noon: always next business day
  if (hour >= 16 || hour >= 12) {
    return getNextBusinessDay(now).toISOString();
  }
  // Before noon: try same-day afternoon slot
  const sameDay = new Date(now);
  sameDay.setHours(14, 0, 0, 0);
  if (sameDay.getTime() > now.getTime()) return sameDay.toISOString();
  return getNextBusinessDay(now).toISOString();
}

const STORAGE_KEY = "cesanekLtlState";

function loadLtlState(): Record<string, LtlState> {
  if (typeof window === "undefined") return {};
  try { const s = sessionStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : {}; } catch { return {}; }
}

function saveLtlState(state: Record<string, LtlState>) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function wmsProxy(token: string, path: string, body: unknown) {
  const res = await fetch("/api/wms", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-session-token": token },
    body: JSON.stringify({ path, body }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Data could not be loaded.");
  return json;
}

// --- Audit Drawer ---
function AuditDrawer({ entries, onClose }: { entries: RolloverEntry[]; onClose: () => void }) {
  return (
    <div className="detail-overlay" onClick={onClose}>
      <aside className="detail-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #26344f", paddingBottom: 12, marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, margin: 0, color: "#eaf0ff" }}>Rollover Audit Trail</h2>
          <button onClick={onClose} style={{ background: "#26344f", border: 0, color: "#9aa8c7", borderRadius: 6, width: 32, height: 32, fontSize: 16, cursor: "pointer" }}>✕</button>
        </div>
        {entries.length === 0 && <p style={{ color: "#64748b", fontSize: 13 }}>No rollovers recorded for this order.</p>}
        {entries.map((e, i) => (
          <div key={i} style={{ borderBottom: "1px solid #1e2d47", padding: "10px 0", fontSize: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#9aa8c7" }}>
              <span>#{i + 1}</span>
              <span>{new Date(e.timestamp).toLocaleString("en-US", { timeZone: "America/New_York" })}</span>
            </div>
            <p style={{ margin: "4px 0", color: "#eaf0ff" }}>{fmt(e.originalAppt)} → {fmt(e.newAppt)}</p>
            <p style={{ margin: "2px 0", color: "#64748b" }}>{e.reason} · {e.user}</p>
            <div style={{ display: "flex", gap: 8, marginTop: 2, fontSize: 10 }}>
              <span style={{ color: e.wmsStatus === "verified" ? "#4ade80" : e.wmsStatus === "failed" ? "#fb7185" : "#ff7a45" }}>WMS: {e.wmsStatus || "pending"}</span>
              <span style={{ color: e.emailStatus === "sent" ? "#4ade80" : e.emailStatus === "failed" ? "#fb7185" : "#facc15" }}>Email: {e.emailStatus || "draft"}</span>
              {e.retryCount ? <span style={{ color: "#9aa8c7" }}>Retries: {e.retryCount}</span> : null}
            </div>
          </div>
        ))}
      </aside>
    </div>
  );
}

// --- Cutoff Countdown ---
function CutoffCountdown() {
  const [, setT] = useState(0);
  useEffect(() => { const i = setInterval(() => setT(t => t + 1), 60000); return () => clearInterval(i); }, []);
  const now = new Date();
  const est = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const cutoff = new Date(est);
  cutoff.setHours(16, 0, 0, 0);
  if (est >= cutoff) return <span style={{ color: "#fb7185", fontWeight: 700 }}>Past cutoff</span>;
  const diff = cutoff.getTime() - est.getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return <span style={{ color: h < 1 ? "#facc15" : "#eaf0ff", fontWeight: 700 }}>{h}h {m}m to 4:00 PM</span>;
}

// --- Main Component ---
export default function LtlAppointmentsPage() {
  const { token, username } = useAuth();
  const [orders, setOrders] = useState<LtlOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ltlState, setLtlState] = useState<Record<string, LtlState>>({});
  const [tick, setTick] = useState(0);
  const [editingAppt, setEditingAppt] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteValue, setNoteValue] = useState("");
  const [auditOrderId, setAuditOrderId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [stale, setStale] = useState(false);

  // Filters
  const [customerFilter, setCustomerFilter] = useState("");
  const [carrierFilter, setCarrierFilter] = useState("");
  const [rnFilter, setRnFilter] = useState("");
  const [dnFilter, setDnFilter] = useState("");
  const [loadFilter, setLoadFilter] = useState("");
  const [statusFilterVal, setStatusFilterVal] = useState("");
  const [rolloverFilter, setRolloverFilter] = useState("");

  const REFRESH_INTERVAL_MS = 600000; // 10 minutes

  useEffect(() => { setLtlState(loadLtlState()); }, []);

  const updateState = useCallback((orderId: string, updater: (prev: LtlState) => LtlState) => {
    setLtlState(prev => {
      const current = prev[orderId] || { rollovers: [], rolloverCount: 0, notes: "" };
      const next = { ...prev, [orderId]: updater(current) };
      saveLtlState(next);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(""); setStale(false);
    try {
      const json = await wmsProxy(token, "/wms-bam/outbound/order/raw-search", {
        currentPage: 1, pageSize: 200,
        shipMethod: "LTL",
        excludeStatuses: FINAL_STATUSES,
        sortingFields: [{ field: "createdTime", orderBy: "DESC" }],
      });
      if (json?.success === false && json?.msg) throw new Error(json.msg);
      const list: LtlOrder[] = Array.isArray(json?.data) ? json.data : [];
      setOrders(list.filter(o => {
        const upper = (o.status || "").toUpperCase();
        return !FINAL_STATUSES.includes(upper);
      }));
      setLastUpdated(new Date().toLocaleString("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unable to retrieve the latest appointment data. Retrying...");
      setStale(true);
    } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 45 seconds + tick for time calculations
  useEffect(() => {
    const dataInterval = setInterval(() => { load(); }, REFRESH_INTERVAL_MS);
    const tickInterval = setInterval(() => setTick(t => t + 1), 30000);
    return () => { clearInterval(dataInterval); clearInterval(tickInterval); };
  }, [load]);

  // Auto-rollover check — triggers after 4:00 PM ET cutoff or when >1h past appointment
  useEffect(() => {
    void tick;
    const pastCutoff = isPastCutoff();
    const today = new Date().toDateString();
    orders.forEach(o => {
      if (!o.appointmentTime) return; // No-appointment orders hidden from main view
      const state = ltlState[o.id];
      const effectiveAppt = state?.apptOverride || o.appointmentTime;
      if (!effectiveAppt) return;
      if (state?.status === "Complete" || state?.status === "Confirmed" || state?.status === "Cancelled") return;
      // Skip if already rolled today (idempotency)
      if (state?.rollovers?.some(r => new Date(r.timestamp).toDateString() === today && r.reason.includes("Auto Rollover"))) return;

      const shouldRoll = pastCutoff
        ? isMissed(effectiveAppt, state?.status) // After cutoff: standard missed check
        : (Date.now() - new Date(effectiveAppt).getTime() > 60 * 60 * 1000); // Before cutoff: >1h past

      if (shouldRoll && state?.status !== "Rolled Over") {
        const newAppt = calculateRolloverTime(effectiveAppt);
        updateState(o.id, prev => ({
          ...prev,
          status: "Rolled Over",
          apptOverride: newAppt,
          rolloverCount: prev.rolloverCount + 1,
          rollovers: [...prev.rollovers, {
            originalAppt: effectiveAppt,
            newAppt,
            timestamp: new Date().toISOString(),
            reason: pastCutoff ? "Missed Pickup Auto Rollover (4:00 PM cutoff)" : "Missed Pickup Auto Rollover",
            user: "System",
          }],
          notificationDraft: "pending",
        }));
      }
    });
  }, [tick, orders]);

  // Filtered — hide orders without appointments (shown in No Appointment Queue)
  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (!o.appointmentTime && !ltlState[o.id]?.apptOverride) return false; // Hide no-appt from main
      const state = ltlState[o.id];
      if (customerFilter && !(o.customerName || o.customerCode || "").toLowerCase().includes(customerFilter.toLowerCase())) return false;
      if (carrierFilter && !(o.carrierName || o.carrierId || "").toLowerCase().includes(carrierFilter.toLowerCase())) return false;
      if (rnFilter && !(o.bolNo || "").toLowerCase().includes(rnFilter.toLowerCase())) return false;
      if (dnFilter && !(o.referenceNo || o.id || "").toLowerCase().includes(dnFilter.toLowerCase())) return false;
      if (loadFilter && !(o.loadNo || "").toLowerCase().includes(loadFilter.toLowerCase())) return false;
      if (statusFilterVal) {
        const s = state?.status || (isMissed(state?.apptOverride || o.appointmentTime, state?.status) ? "Missed" : "Pending");
        if (s.toLowerCase() !== statusFilterVal.toLowerCase()) return false;
      }
      if (rolloverFilter && String(state?.rolloverCount || 0) !== rolloverFilter) return false;
      return true;
    });
  }, [orders, ltlState, customerFilter, carrierFilter, rnFilter, dnFilter, loadFilter, statusFilterVal, rolloverFilter]);

  // Pagination for large datasets — display max 100 rows
  const PAGE_SIZE = 100;
  const [displayPage, setDisplayPage] = useState(1);
  const totalDisplayPages = Math.ceil(filtered.length / PAGE_SIZE);
  const displaySlice = filtered.slice((displayPage - 1) * PAGE_SIZE, displayPage * PAGE_SIZE);

  // KPIs — production metrics
  const kpis = useMemo(() => {
    void tick;
    let missed = 0, rolledToday = 0, pending = 0, completed = 0, exception = 0, autoRolloversToday = 0, wmsSyncFails = 0;
    const today = new Date().toDateString();
    let totalRolloverMs = 0, rolloverCount = 0;
    orders.forEach(o => {
      if (!o.appointmentTime && !ltlState[o.id]?.apptOverride) return; // skip no-appt
      const state = ltlState[o.id];
      const effectiveAppt = state?.apptOverride || o.appointmentTime;
      const st = state?.status;
      if (st === "Complete" || st === "Confirmed") { completed++; return; }
      if (st === "Exception") { exception++; return; }
      if (st === "Cancelled") return;
      if (st === "Rolled Over" || st === "Missed" || isMissed(effectiveAppt, st)) missed++;
      else pending++;
      if (state?.rollovers) {
        state.rollovers.forEach(r => {
          if (new Date(r.timestamp).toDateString() === today) {
            rolledToday++;
            if (r.user === "System") autoRolloversToday++;
            const diff = new Date(r.newAppt).getTime() - new Date(r.originalAppt).getTime();
            if (diff > 0) { totalRolloverMs += diff; rolloverCount++; }
          }
        });
      }
    });
    const avgRolloverHrs = rolloverCount > 0 ? (totalRolloverMs / rolloverCount / 3600000).toFixed(1) : "—";
    return { total: orders.filter(o => o.appointmentTime || ltlState[o.id]?.apptOverride).length, missed, rolledToday, pending, completed, exception, autoRolloversToday, wmsSyncFails, avgRolloverHrs };
  }, [orders, ltlState, tick]);

  // Actions
  const markStatus = useCallback((orderId: string, status: string) => {
    updateState(orderId, prev => ({ ...prev, status }));
  }, [updateState]);

  const manualRollover = useCallback((orderId: string) => {
    const state = ltlState[orderId];
    const order = orders.find(o => o.id === orderId);
    const effectiveAppt = state?.apptOverride || order?.appointmentTime;
    if (!effectiveAppt) return;
    const newAppt = calculateRolloverTime(effectiveAppt);
    updateState(orderId, prev => ({
      ...prev,
      status: "Rolled Over",
      apptOverride: newAppt,
      rolloverCount: prev.rolloverCount + 1,
      rollovers: [...prev.rollovers, {
        originalAppt: effectiveAppt,
        newAppt,
        timestamp: new Date().toISOString(),
        reason: "Manual rollover by user",
        user: username || "ecambra",
      }],
      notificationDraft: "pending",
    }));
  }, [ltlState, orders, updateState, username]);

  const saveAppt = useCallback((orderId: string, value: string) => {
    updateState(orderId, prev => ({ ...prev, apptOverride: value }));
    setEditingAppt(null);
  }, [updateState]);

  const saveNote = useCallback((orderId: string, note: string) => {
    updateState(orderId, prev => ({ ...prev, notes: note }));
    setEditingNote(null);
  }, [updateState]);

  const auditEntries = auditOrderId ? (ltlState[auditOrderId]?.rollovers || []) : [];

  return (
    <>
      <h1>LTL Appointment Management</h1>
      <p className="muted">AI-Powered LTL Appointment Management & Automatic WMS Rollover Engine. After 4:00 PM ET cutoff, missed pickups auto-roll to next business day.</p>

      {/* Automation Engine Status Panel */}
      <div style={{ background: "#16233b", border: "1px solid #26344f", borderRadius: 8, padding: "10px 14px", margin: "8px 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, fontSize: 11 }}>
        <div><span style={{ color: "#8899b4" }}>Engine Status</span><br /><span style={{ color: "#4ade80", fontWeight: 700 }}>● Active</span></div>
        <div><span style={{ color: "#8899b4" }}>WMS Mutation</span><br /><span style={{ color: "#ff7a45", fontWeight: 700 }}>Pending Verification</span></div>
        <div><span style={{ color: "#8899b4" }}>Email Automation</span><br /><span style={{ color: "#ff7a45", fontWeight: 700 }}>Draft Mode</span></div>
        <div><span style={{ color: "#8899b4" }}>Last Scan</span><br /><span style={{ color: "#eaf0ff" }}>{lastUpdated || "—"}</span></div>
        <div><span style={{ color: "#8899b4" }}>Next Scan</span><br /><span style={{ color: "#eaf0ff" }}>~10 min</span></div>
        <div><span style={{ color: "#8899b4" }}>Cutoff Countdown</span><br /><CutoffCountdown /></div>
      </div>

      {/* KPIs — Production Automation Metrics */}
      <section className="stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(105px, 1fr))" }}>
        <div>Active LTL<br /><b>{kpis.total}</b></div>
        <div>Scheduled Today<br /><b style={{ color: "#3b82f6" }}>{kpis.pending}</b></div>
        <div>Missed Today<br /><b className="bad">{kpis.missed}</b></div>
        <div>Auto-Rolled<br /><b className="warn">{kpis.autoRolloversToday}</b></div>
        <div>WMS Verified<br /><b style={{ color: "#64748b" }}>Pending</b></div>
        <div>Emails Sent<br /><b style={{ color: "#64748b" }}>Draft</b></div>
        <div>Email Fails<br /><b style={{ color: "#64748b" }}>0</b></div>
        <div>WMS Sync Fails<br /><b style={{ color: "#ff7a45" }}>{kpis.wmsSyncFails}</b></div>
        <div>Exception Queue<br /><b style={{ color: "#ff7a45" }}>{kpis.exception}</b></div>
        <div>Avg Processing<br /><b>{kpis.avgRolloverHrs}h</b></div>
        <div>Completed<br /><b className="good">{kpis.completed}</b></div>
        <div>Awaiting Sched<br /><b style={{ color: "#64748b" }}>{orders.filter(o => !o.appointmentTime && !ltlState[o.id]?.apptOverride).length}</b></div>
      </section>
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "#64748b", margin: "4px 0 8px" }}>
        <span>Pickup cutoff: 4:00 PM ET</span>
        <span>·</span>
        <span>{isPastCutoff() ? "⚠ Past cutoff — missed pickups will auto-roll" : "Before cutoff"}</span>
        <span style={{ marginLeft: "auto" }}><a href="/dashboard/ltl-appointments/no-appointment-queue" style={{ color: "#5539f6", textDecoration: "none", fontSize: 11 }}>No Appointment Queue →</a></span>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, margin: "14px 0 8px", flexWrap: "wrap", alignItems: "center" }}>
        <input type="text" placeholder="Customer" value={customerFilter} onChange={e => setCustomerFilter(e.target.value)} className="filter-input" />
        <input type="text" placeholder="Carrier" value={carrierFilter} onChange={e => setCarrierFilter(e.target.value)} className="filter-input" style={{ width: 120 }} />
        <input type="text" placeholder="RN #" value={rnFilter} onChange={e => setRnFilter(e.target.value)} className="filter-input" style={{ width: 90 }} />
        <input type="text" placeholder="DN #" value={dnFilter} onChange={e => setDnFilter(e.target.value)} className="filter-input" style={{ width: 90 }} />
        <input type="text" placeholder="Load #" value={loadFilter} onChange={e => setLoadFilter(e.target.value)} className="filter-input" style={{ width: 90 }} />
        <select value={statusFilterVal} onChange={e => setStatusFilterVal(e.target.value)} className="filter-select">
          <option value="">All Statuses</option>
          <option value="Missed">Missed</option>
          <option value="Rolled Over">Rolled Over</option>
          <option value="Confirmed">Confirmed</option>
          <option value="Complete">Complete</option>
          <option value="Pending">Pending</option>
          <option value="Exception">Exception</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        <select value={rolloverFilter} onChange={e => setRolloverFilter(e.target.value)} className="filter-select">
          <option value="">Any Rollovers</option>
          <option value="0">0 rollovers</option>
          <option value="1">1 rollover</option>
          <option value="2">2+ rollovers</option>
        </select>
      </div>

      {error && <div className="notice" style={{ borderColor: stale ? "#fb7185" : undefined }}>{error}{stale && lastUpdated && <span style={{ display: "block", fontSize: 10, marginTop: 4, color: "#9aa8c7" }}>Last successful update: {lastUpdated}</span>}</div>}
      <div className="actions">
        <button onClick={load} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</button>
        <button onClick={() => { const hdr = "Customer,RN,DN,Load,Carrier,Appointment,Status,Rolled Appt,Rollovers,Notes\n"; const rows = filtered.map(o => { const st = ltlState[o.id]; return [o.customerName||"",o.bolNo||"",o.referenceNo||o.id,o.loadNo||"",o.carrierName||o.carrierId||"",o.appointmentTime||"",st?.status||"Pending",st?.apptOverride||"",st?.rolloverCount||0,st?.notes||""].map(v=>`"${String(v).replace(/"/g,"\"\"")}"`) .join(","); }).join("\n"); const b = new Blob([hdr+rows],{type:"text/csv"}); const u=URL.createObjectURL(b); const a=document.createElement("a"); a.href=u; a.download=`ltl-appointments-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(u); }} style={{ background: "#16233b", border: "1px solid #26344f", color: "#9aa8c7" }}>Export CSV</button>
        <button onClick={() => setDisplayPage(Math.max(1, displayPage - 1))} disabled={displayPage <= 1} style={{ background: "#16233b", border: "1px solid #26344f", color: "#9aa8c7" }}>Prev</button>
        <button onClick={() => setDisplayPage(Math.min(totalDisplayPages, displayPage + 1))} disabled={displayPage >= totalDisplayPages} style={{ background: "#16233b", border: "1px solid #26344f", color: "#9aa8c7" }}>Next</button>
        <span style={{ color: "#64748b", fontSize: 10, marginLeft: 8 }}>{filtered.length} loads · Page {displayPage}/{totalDisplayPages || 1}</span>
        {lastUpdated && <span style={{ fontSize: 10, color: "#64748b", marginLeft: 8 }}>Last Updated: {lastUpdated}</span>}
        <span style={{ fontSize: 10, color: stale ? "#fb7185" : "#4ade80", marginLeft: 4 }}>{stale ? "● Stale — retrying" : "● Connected (10m refresh)"}</span>
      </div>

      {/* Table */}
      <div className="table">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>RN</th>
              <th>DN</th>
              <th>Load #</th>
              <th>Carrier</th>
              <th>Appointment</th>
              <th>Appt Status</th>
              <th>Time Since Missed</th>
              <th>Rolled Appt</th>
              <th>Rollovers</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={12} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>Loading LTL data...</td></tr>}
            {!loading && filtered.length === 0 && !error && (
              <tr><td colSpan={12} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>No LTL loads match filters. LTL classification uses the shipMethod field from WMS.</td></tr>
            )}
            {displaySlice.map(o => {
              const state = ltlState[o.id] || { rollovers: [], rolloverCount: 0, notes: "" };
              const originalAppt = o.appointmentTime;
              const effectiveAppt = state.apptOverride || originalAppt;
              const missed = isMissed(effectiveAppt, state.status);
              const displayStatus = state.status || (missed ? "Missed" : effectiveAppt ? "Pending" : "No Appt");
              const statusCls = displayStatus === "Missed" ? "bad" : displayStatus === "Rolled Over" ? "warn" : displayStatus === "Confirmed" || displayStatus === "Complete" ? "good" : displayStatus === "Exception" ? "" : displayStatus === "Pending" ? "" : displayStatus === "Cancelled" ? "" : "";
              const statusColor = displayStatus === "Missed" ? "#fb7185" : displayStatus === "Rolled Over" ? "#facc15" : displayStatus === "Confirmed" || displayStatus === "Complete" ? "#4ade80" : displayStatus === "Pending" ? "#3b82f6" : displayStatus === "Exception" ? "#ff7a45" : displayStatus === "Cancelled" ? "#64748b" : "#9aa8c7";
              const hasRolledAppt = state.apptOverride && state.apptOverride !== originalAppt;

              return (
                <tr key={o.id}>
                  <td>{o.customerName || o.customerCode || "—"}</td>
                  <td>{o.bolNo || "—"}</td>
                  <td style={{ fontWeight: 600 }}>{o.referenceNo || o.id}</td>
                  <td>{o.loadNo || "—"}</td>
                  <td>{o.carrierName || o.carrierId || "—"}</td>
                  <td>
                    {editingAppt === o.id ? (
                      <span style={{ display: "flex", gap: 3 }}>
                        <input type="datetime-local" value={editValue} onChange={e => setEditValue(e.target.value)} style={{ fontSize: 10, padding: "2px 4px", background: "#101b31", border: "1px solid #26344f", color: "#eaf0ff", borderRadius: 4, width: 145 }} />
                        <button onClick={() => saveAppt(o.id, editValue)} style={{ fontSize: 9, padding: "2px 5px", background: "#5539f6", color: "#fff", border: 0, borderRadius: 3, cursor: "pointer" }}>✓</button>
                        <button onClick={() => setEditingAppt(null)} style={{ fontSize: 9, padding: "2px 5px", background: "#26344f", color: "#9aa8c7", border: 0, borderRadius: 3, cursor: "pointer" }}>✕</button>
                      </span>
                    ) : (
                      <span onClick={() => { setEditingAppt(o.id); setEditValue(effectiveAppt ? new Date(effectiveAppt).toISOString().slice(0, 16) : ""); }} style={{ cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3 }} title="Click to edit">
                        {originalAppt ? fmt(originalAppt) : "—"}
                      </span>
                    )}
                  </td>
                  <td><span style={{ fontWeight: 700, color: statusColor }}>{displayStatus}{state.notificationDraft === "pending" && <span style={{ fontSize: 8, color: "#a99cff", marginLeft: 3 }}>📧 draft</span>}</span></td>
                  <td className={missed ? "bad" : ""}>{missed && effectiveAppt ? timeSinceMissed(effectiveAppt) : "—"}</td>
                  <td style={{ color: hasRolledAppt ? "#facc15" : "#64748b" }}>
                    {hasRolledAppt ? fmt(state.apptOverride) : "—"}
                    {hasRolledAppt && <span style={{ fontSize: 9, color: "#a99cff", marginLeft: 3 }}>draft</span>}
                  </td>
                  <td>{state.rolloverCount || 0}</td>
                  <td>
                    {editingNote === o.id ? (
                      <span style={{ display: "flex", gap: 3 }}>
                        <input value={noteValue} onChange={e => setNoteValue(e.target.value)} style={{ fontSize: 10, padding: "2px 4px", background: "#101b31", border: "1px solid #26344f", color: "#eaf0ff", borderRadius: 4, width: 120 }} placeholder="Note..." />
                        <button onClick={() => saveNote(o.id, noteValue)} style={{ fontSize: 9, padding: "2px 5px", background: "#5539f6", color: "#fff", border: 0, borderRadius: 3, cursor: "pointer" }}>✓</button>
                      </span>
                    ) : (
                      <span onClick={() => { setEditingNote(o.id); setNoteValue(state.notes); }} style={{ cursor: "pointer", color: state.notes ? "#cdd6f4" : "#64748b", textDecoration: "underline dotted", textUnderlineOffset: 3, fontSize: 11 }}>
                        {state.notes ? (state.notes.length > 20 ? state.notes.slice(0, 18) + "…" : state.notes) : "+ Note"}
                      </span>
                    )}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                      <button onClick={() => setAuditOrderId(o.id)} style={{ fontSize: 9, padding: "2px 6px", background: "#16233b", color: "#a99cff", border: "1px solid #26344f", borderRadius: 3, cursor: "pointer" }}>Audit</button>
                      <button onClick={() => manualRollover(o.id)} title="Force Rollover (Admin)" style={{ fontSize: 9, padding: "2px 6px", background: "#1c1505", color: "#facc15", border: "1px solid #ca8a0430", borderRadius: 3, cursor: "pointer" }}>↻ Roll</button>
                      <button onClick={() => markStatus(o.id, "Cancelled")} style={{ fontSize: 9, padding: "2px 6px", background: "#16233b", color: "#64748b", border: "1px solid #26344f", borderRadius: 3, cursor: "pointer" }}>Cancel</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Notification drafts note */}
      {Object.values(ltlState).some(s => s.notificationDraft === "pending") && (
        <div style={{ marginTop: 16, padding: 12, background: "#1e1b4b", border: "1px solid #5539f6", borderRadius: 8 }}>
          <p style={{ margin: "0 0 6px", fontSize: 12, color: "#c7d2fe" }}>
            Rolled-over appointments have pending notification drafts.
          </p>
          <p style={{ margin: "0 0 8px", fontSize: 11, color: "#9aa8c7" }}>
            Test notification recipient: <b style={{ color: "#eaf0ff" }}>erin.cambra@unisco.com</b> · Email automation in Draft/Test Mode — no emails are auto-sent.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href={`mailto:erin.cambra@unisco.com?subject=${encodeURIComponent("Your LTL Pickup Appointment Has Been Automatically Rescheduled")}&body=${encodeURIComponent("Hello,\n\nYour shipment has automatically been rescheduled after today's pickup window closed.\n\nShipment Details:\n• Order Number: [See rolled orders above]\n• Load Number: —\n• Carrier: —\n• Original Pickup: —\n• New Pickup: Next business day 8:00 AM ET\n\nNo action is required from you.\n\nIf you have questions, please contact Customer Service.\n\nThank you.")}`} className="panel-btn primary" style={{ textDecoration: "none", fontSize: 11 }}>Open Customer Email Draft</a>
            <a href={`mailto:erin.cambra@unisco.com?subject=${encodeURIComponent("[Internal] LTL Missed Pickup Auto-Rollover — Cesanek LT_F21")}&body=${encodeURIComponent("Internal Notification — LTL Auto-Rollover\n\nFacility: Cesanek LT_F21\nTriggered By: System Automation\nReason: Missed Pickup Auto Rollover (4:00 PM cutoff)\n\nRolled appointments require review.\n\nRecipients: Transportation Planning, Warehouse Operations, Customer Service, Dispatch")}`} className="panel-btn" style={{ textDecoration: "none", fontSize: 11 }}>Open Internal Email Draft</a>
            <a href="/dashboard/notifications" className="panel-btn" style={{ textDecoration: "none", fontSize: 11 }}>Use Templates →</a>
          </div>
        </div>
      )}

      {/* Audit Trail Drawer */}
      {auditOrderId && <AuditDrawer entries={auditEntries} onClose={() => setAuditOrderId(null)} />}
    </>
  );
}
