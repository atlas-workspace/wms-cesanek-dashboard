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
}

interface LtlState {
  apptOverride?: string;
  status?: string;
  rollovers: RolloverEntry[];
  rolloverCount: number;
  notes: string;
  notificationDraft?: string;
}

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
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  next.setHours(8, 0, 0, 0);
  return next;
}

function calculateRolloverTime(missedAppt: string): string {
  const missed = new Date(missedAppt);
  const now = new Date();
  const estNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = estNow.getHours();

  if (hour < 12) {
    // Roll to same-day afternoon
    const sameDay = new Date(missed);
    sameDay.setHours(14, 0, 0, 0);
    if (sameDay.getTime() > now.getTime()) return sameDay.toISOString();
  }
  // Roll to next business day morning
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
          </div>
        ))}
      </aside>
    </div>
  );
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

  const REFRESH_INTERVAL_MS = 45000;

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

  // Auto-rollover check
  useEffect(() => {
    void tick;
    orders.forEach(o => {
      const state = ltlState[o.id];
      const effectiveAppt = state?.apptOverride || o.appointmentTime;
      if (!effectiveAppt) return;
      if (state?.status === "Complete" || state?.status === "Confirmed") return;
      if (isMissed(effectiveAppt, state?.status)) {
        if (state?.status !== "Missed" && state?.status !== "Rolled Over") {
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
              reason: "Automatic rollover (missed >1h)",
              user: "System",
            }],
            notificationDraft: "pending",
          }));
        }
      }
    });
  }, [tick, orders]);

  // Filtered
  const filtered = useMemo(() => {
    return orders.filter(o => {
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

  // KPIs
  const kpis = useMemo(() => {
    void tick;
    let missed = 0, rolledToday = 0, pending = 0, completed = 0;
    const today = new Date().toDateString();
    orders.forEach(o => {
      const state = ltlState[o.id];
      const effectiveAppt = state?.apptOverride || o.appointmentTime;
      const st = state?.status;
      if (st === "Complete" || st === "Confirmed") { completed++; return; }
      if (st === "Rolled Over" || st === "Missed" || isMissed(effectiveAppt, st)) missed++;
      else pending++;
      if (state?.rollovers?.some(r => new Date(r.timestamp).toDateString() === today)) rolledToday++;
    });
    return { total: orders.length, missed, rolledToday, pending, completed };
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
      <p className="muted">LTL loads with automatic appointment rollover. Missed appointments are rolled to the next available slot. WMS rollover is a local dashboard draft — appointments are not mutated in WMS.</p>

      {/* KPIs */}
      <section className="stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <div>Total LTL Loads<br /><b>{kpis.total}</b></div>
        <div>Missed<br /><b className="bad">{kpis.missed}</b></div>
        <div>Rolled Over Today<br /><b className="warn">{kpis.rolledToday}</b></div>
        <div>Pending<br /><b>{kpis.pending}</b></div>
        <div>Completed<br /><b className="good">{kpis.completed}</b></div>
      </section>

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
        <span style={{ color: "#64748b", fontSize: 10, marginLeft: 8 }}>{filtered.length} LTL loads</span>
        {lastUpdated && <span style={{ fontSize: 10, color: "#64748b", marginLeft: 8 }}>Last Updated: {lastUpdated}</span>}
        <span style={{ fontSize: 10, color: stale ? "#fb7185" : "#4ade80", marginLeft: 4 }}>{stale ? "● Stale — retrying" : "● Live (45s)"}</span>
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
            {filtered.map(o => {
              const state = ltlState[o.id] || { rollovers: [], rolloverCount: 0, notes: "" };
              const originalAppt = o.appointmentTime;
              const effectiveAppt = state.apptOverride || originalAppt;
              const missed = isMissed(effectiveAppt, state.status);
              const displayStatus = state.status || (missed ? "Missed" : effectiveAppt ? "Pending" : "No Appt");
              const statusCls = displayStatus === "Missed" ? "bad" : displayStatus === "Rolled Over" ? "warn" : displayStatus === "Confirmed" || displayStatus === "Complete" ? "good" : "";
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
                  <td><span className={statusCls} style={{ fontWeight: 700 }}>{displayStatus}</span></td>
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
                      <button onClick={() => markStatus(o.id, "Confirmed")} style={{ fontSize: 9, padding: "2px 6px", background: "#052e16", color: "#4ade80", border: "1px solid #16a34a30", borderRadius: 3, cursor: "pointer" }}>✓</button>
                      <button onClick={() => markStatus(o.id, "Missed")} style={{ fontSize: 9, padding: "2px 6px", background: "#2a0a0f", color: "#fb7185", border: "1px solid #be123c30", borderRadius: 3, cursor: "pointer" }}>✗</button>
                      <button onClick={() => manualRollover(o.id)} style={{ fontSize: 9, padding: "2px 6px", background: "#1c1505", color: "#facc15", border: "1px solid #ca8a0430", borderRadius: 3, cursor: "pointer" }}>↻</button>
                      <button onClick={() => markStatus(o.id, "Complete")} style={{ fontSize: 9, padding: "2px 6px", background: "#16233b", color: "#9aa8c7", border: "1px solid #26344f", borderRadius: 3, cursor: "pointer" }}>Done</button>
                      <button onClick={() => setAuditOrderId(o.id)} style={{ fontSize: 9, padding: "2px 6px", background: "#16233b", color: "#a99cff", border: "1px solid #26344f", borderRadius: 3, cursor: "pointer" }}>Audit</button>
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
          <p style={{ margin: 0, fontSize: 12, color: "#c7d2fe" }}>
            Rolled-over appointments have pending notification drafts. Visit <a href="/dashboard/notifications" style={{ color: "#a99cff" }}>Notifications</a> to send Missed LTL Appointment or LTL Appointment Rolled Over communications.
          </p>
        </div>
      )}

      {/* Audit Trail Drawer */}
      {auditOrderId && <AuditDrawer entries={auditEntries} onClose={() => setAuditOrderId(null)} />}
    </>
  );
}
