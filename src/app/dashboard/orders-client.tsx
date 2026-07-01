"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import OrderDetailPanel from "./order-detail-panel";

// --- Types ---
type Order = {
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
  itemLines?: { itemId?: string; description?: string; qty?: number; uom?: string; lotNo?: string }[];
  bolNo?: string;
  loadNo?: string;
  trackingNo?: string;
  orderNote?: string;
  pickNote?: string;
  packNote?: string;
  deliveryInstructions?: string;
  totalPallets?: number;
  totalWeight?: number;
  updatedTime?: string;
  updatedBy?: string;
  soNos?: string[];
};

// --- Constants ---
// =============================================================================
// OVERVIEW TAB CONSTANTS — DO NOT SHARE WITH SLA TAB
// These 21 statuses are the locked Overview baseline. Do not reduce this list.
// =============================================================================
const OVERVIEW_OPEN_STATUSES = [
  "IMPORTED", "OPEN", "PARTIAL_COMMITTED", "PARTIAL COMMITTED", "COMMIT_BLOCKED", "COMMIT BLOCKED",
  "COMMIT_FAILED", "COMMIT FAILED", "COMMITTED", "PLANNING", "PLANNED", "PICKING", "PICKED",
  "READY_TO_SHIP", "READY TO SHIP", "PACKING", "PACKED", "STAGED", "LOADING", "LOADED",
  "REOPEN", "EXCEPTION", "PARTIAL_SHIPPED", "PARTIAL SHIPPED", "BLOCKED", "ON_HOLD", "ON HOLD",
] as const;
const OVERVIEW_OPEN_NORMALIZED = OVERVIEW_OPEN_STATUSES.map(s => s.replace(/[\s_]/g, "").toUpperCase());

// The 21 canonical statuses sent to WMS API (underscore form)
const OVERVIEW_API_STATUSES = [
  "IMPORTED", "OPEN", "PARTIAL_COMMITTED", "COMMIT_BLOCKED", "COMMIT_FAILED",
  "COMMITTED", "PLANNING", "PLANNED", "PICKING", "PICKED", "READY_TO_SHIP",
  "PACKING", "PACKED", "STAGED", "LOADING", "LOADED", "REOPEN", "EXCEPTION",
  "PARTIAL_SHIPPED", "BLOCKED", "ON_HOLD",
] as const;

const OVERVIEW_STATUS_LABELS: Record<string, string> = {
  IMPORTED: "Imported", OPEN: "Open", PARTIAL_COMMITTED: "Partial Committed",
  COMMIT_BLOCKED: "Commit Blocked", COMMIT_FAILED: "Commit Failed",
  COMMITTED: "Committed", PLANNING: "Planning", PLANNED: "Planned",
  PICKING: "Picking", PICKED: "Picked", READY_TO_SHIP: "Ready to Ship",
  PACKING: "Packing", PACKED: "Packed", STAGED: "Staged",
  LOADING: "Loading", LOADED: "Loaded", REOPEN: "Reopen",
  EXCEPTION: "Exception", PARTIAL_SHIPPED: "Partial Shipped",
  BLOCKED: "Blocked", ON_HOLD: "On Hold",
  SHIPPED: "Shipped", COMPLETED: "Completed", CANCELLED: "Cancelled",
};

// Filter UI shows all 21 open + 3 closed for optional viewing
const OVERVIEW_ALL_FILTER_STATUSES = [...OVERVIEW_API_STATUSES, "SHIPPED", "COMPLETED", "CANCELLED"] as const;
// Default selection = all 21 open statuses (must show "21 selected")
const OVERVIEW_DEFAULT_SELECTED = [...OVERVIEW_API_STATUSES] as string[];

function isOverviewOpenStatus(status?: string): boolean {
  if (!status) return false;
  const normalized = status.replace(/[\s_]/g, "").toUpperCase();
  return OVERVIEW_OPEN_NORMALIZED.includes(normalized);
}
// =============================================================================

// --- Helpers ---
function fmt(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function slaDeadline(createdTime: string) {
  return new Date(new Date(createdTime).getTime() + 48 * 60 * 60 * 1000);
}

function timeRemaining(createdTime: string) {
  const deadline = slaDeadline(createdTime);
  const ms = deadline.getTime() - Date.now();
  const hrs = ms / (1000 * 60 * 60);
  if (ms <= 0) return { label: `${Math.abs(hrs).toFixed(1)}h overdue`, hrs, cls: "sla-critical" };
  if (hrs < 1) return { label: `${Math.round(ms / 60000)}m remaining`, hrs, cls: "sla-critical" };
  if (hrs < 4) return { label: `${hrs.toFixed(1)}h remaining`, hrs, cls: "sla-approaching" };
  return { label: `${hrs.toFixed(1)}h remaining`, hrs, cls: "sla-normal" };
}

function apptStatus(apptTime: string | undefined | null) {
  if (!apptTime) return { label: "—", cls: "", badge: "" };
  const appt = new Date(apptTime);
  const diff = appt.getTime() - Date.now();
  const diffHrs = diff / (1000 * 60 * 60);
  if (diff < -1 * 60 * 60 * 1000) return { label: "Missed", cls: "appt-missed", badge: "missed" };
  if (diff < 0) return { label: "Missed", cls: "appt-missed", badge: "missed" };
  if (diffHrs <= 1) return { label: "Approaching", cls: "appt-approaching", badge: "approaching" };
  return { label: "Scheduled", cls: "appt-scheduled", badge: "" };
}

// --- Priority sorting (urgency) ---
function getUrgency(order: Order, localAppts: Record<string, string>) {
  const sla = order.createdTime ? timeRemaining(order.createdTime) : null;
  const apptTime = localAppts[order.id] || order.appointmentTime;
  const appt = apptStatus(apptTime);

  if (sla && sla.hrs <= 0) return { priority: 0, sortVal: sla.hrs };
  if (sla && sla.hrs < 1) return { priority: 1, sortVal: sla.hrs };
  if (appt.badge === "missed") return { priority: 1.5, sortVal: 0 };
  if (sla && sla.hrs < 4) return { priority: 2, sortVal: sla.hrs };
  if (appt.badge === "approaching") return { priority: 2.5, sortVal: 0 };
  return { priority: 3, sortVal: sla?.hrs ?? 999 };
}

// --- WMS Proxy ---
async function wmsProxy(token: string, path: string, body: unknown) {
  const res = await fetch("/api/wms", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-session-token": token },
    body: JSON.stringify({ path, body }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Warehouse data could not be loaded.");
  return json;
}

// --- Component ---
export default function OrdersClient() {
  const { token } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);
  const [localAppts, setLocalAppts] = useState<Record<string, string>>({});
  const [editingAppt, setEditingAppt] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [tick, setTick] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string[]>(OVERVIEW_DEFAULT_SELECTED);
  const [apptFilter, setApptFilter] = useState<"all" | "assigned" | "none">("all");
  const [customerSearch, setCustomerSearch] = useState("");
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("cesanekApptOverrides");
      if (stored) setLocalAppts(JSON.parse(stored));
    } catch {}
  }, []);

  const saveApptOverride = useCallback((orderId: string, value: string) => {
    setLocalAppts(prev => {
      const next = { ...prev, [orderId]: value };
      sessionStorage.setItem("cesanekApptOverrides", JSON.stringify(next));
      return next;
    });
    setEditingAppt(null);
  }, []);

  async function load(p = 1) {
    setLoading(true); setError("");
    try {
      if (!token) { setError("Please sign in to view order data."); setLoading(false); return; }
      const json = await wmsProxy(token, "/wms-bam/outbound/order/search-by-paging", {
        currentPage: p, pageSize: 100,
        statuses: OVERVIEW_API_STATUSES,
        sortingFields: [{ field: "createdTime", orderBy: "DESC" }],
      });
      if (!json?.success) throw new Error("Warehouse order information could not be loaded. Please confirm your facility access.");
      setOrders(json.data?.list || []);
      setTotal(json.data?.totalCount || 0);
      setTotalPages(json.data?.totalPage || 1);
      setPage(p);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Warehouse order information could not be loaded.");
    } finally { setLoading(false); }
  }

  async function loadAll() {
    if (!token) return;
    setLoadingAll(true); setError("");
    try {
      const firstJson = await wmsProxy(token, "/wms-bam/outbound/order/search-by-paging", {
        currentPage: 1, pageSize: 100, statuses: OVERVIEW_API_STATUSES, sortingFields: [{ field: "createdTime", orderBy: "DESC" }],
      });
      if (!firstJson?.success) throw new Error("Could not load all orders.");
      const totalCount = firstJson.data?.totalCount || 0;
      const totalPg = firstJson.data?.totalPage || 1;
      let all: Order[] = firstJson.data?.list || [];
      setTotal(totalCount);
      setTotalPages(totalPg);

      for (let pg = 2; pg <= totalPg && pg <= 15; pg++) {
        const json = await wmsProxy(token, "/wms-bam/outbound/order/search-by-paging", {
          currentPage: pg, pageSize: 100, statuses: OVERVIEW_API_STATUSES, sortingFields: [{ field: "createdTime", orderBy: "DESC" }],
        });
        if (json?.success && json.data?.list) {
          all = all.concat(json.data.list);
        }
      }
      setAllOrders(all);
      setOrders(all);
      setPage(0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not load all orders.");
    } finally { setLoadingAll(false); }
  }

  useEffect(() => { if (token) load(1); }, [token]);

  const filtered = useMemo(() => {
    return orders.filter(o => {
      // Defensive client-side open status check
      if (!isOverviewOpenStatus(o.status)) {
        // If status filter explicitly includes closed statuses, allow them through
        const upperStatus = (o.status || "").replace(/[\s_]/g, "").toUpperCase();
        const inFilter = statusFilter.some(s => s.replace(/[\s_]/g, "").toUpperCase() === upperStatus);
        if (!inFilter) return false;
      }
      // Status filter UI
      const isAll = statusFilter.length === 0 || statusFilter.length === OVERVIEW_ALL_FILTER_STATUSES.length;
      if (!isAll && o.status) {
        const normalized = o.status.replace(/[\s_]/g, "").toUpperCase();
        const matches = statusFilter.some(s => s.replace(/[\s_]/g, "").toUpperCase() === normalized);
        if (!matches) return false;
      }
      const effectiveAppt = localAppts[o.id] || o.appointmentTime;
      if (apptFilter === "assigned" && !effectiveAppt) return false;
      if (apptFilter === "none" && effectiveAppt) return false;
      if (customerSearch) {
        const search = customerSearch.toLowerCase();
        const name = (o.customerName || o.customerCode || "").toLowerCase();
        if (!name.includes(search)) return false;
      }
      return true;
    });
  }, [orders, statusFilter, apptFilter, customerSearch, localAppts]);

  const sorted = useMemo(() => {
    void tick;
    return [...filtered].sort((a, b) => {
      const ua = getUrgency(a, localAppts);
      const ub = getUrgency(b, localAppts);
      if (ua.priority !== ub.priority) return ua.priority - ub.priority;
      return ua.sortVal - ub.sortVal;
    });
  }, [filtered, localAppts, tick]);

  const metrics = useMemo(() => {
    void tick;
    let approaching = 0, critical = 0, outOfSla = 0;
    let apptsToday = 0, upcoming = 0, missed = 0, rescheduled = 0;
    const today = new Date().toDateString();

    filtered.forEach(o => {
      if (o.createdTime) {
        const sla = timeRemaining(o.createdTime);
        if (sla.hrs <= 0) outOfSla++;
        else if (sla.hrs < 1) critical++;
        else if (sla.hrs < 4) approaching++;
      }
      const apptTime = localAppts[o.id] || o.appointmentTime;
      if (apptTime) {
        if (new Date(apptTime).toDateString() === today) apptsToday++;
        const as = apptStatus(apptTime);
        if (as.badge === "missed") missed++;
        else if (as.badge === "approaching") upcoming++;
      }
      if (localAppts[o.id] && o.appointmentTime && localAppts[o.id] !== o.appointmentTime) rescheduled++;
    });

    return { total: filtered.length, approaching, critical, outOfSla, apptsToday, upcoming, missed, rescheduled };
  }, [filtered, localAppts, tick]);

  const toggleStatus = (status: string) => {
    setStatusFilter(prev => prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]);
  };
  const selectAllStatuses = () => setStatusFilter([...OVERVIEW_ALL_FILTER_STATUSES]);
  const selectOpenOnly = () => setStatusFilter([...OVERVIEW_DEFAULT_SELECTED]);

  return (
    <>
      {/* SLA Metrics */}
      <h2>SLA Overview</h2>
      <section className="stats">
        <div>Open Orders<br /><b>{filtered.length}</b></div>
        <div>Approaching (&lt;4h)<br /><b className="warn">{metrics.approaching}</b></div>
        <div>Critical (&lt;1h)<br /><b className="bad">{metrics.critical}</b></div>
        <div>Out of SLA<br /><b className="bad">{metrics.outOfSla}</b></div>
      </section>

      {/* Appointment Metrics */}
      <h2>Appointments</h2>
      <section className="stats">
        <div>Today<br /><b>{metrics.apptsToday}</b></div>
        <div>Within 1 Hour<br /><b className="warn">{metrics.upcoming}</b></div>
        <div>Missed<br /><b className="bad">{metrics.missed}</b></div>
        <div>Rescheduled<br /><b>{metrics.rescheduled}</b></div>
      </section>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, margin: "16px 0 8px", flexWrap: "wrap", alignItems: "center" }}>
        <input type="text" placeholder="Search customer..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} style={{ border: "1px solid #26344f", background: "#101b31", color: "#eaf0ff", borderRadius: 8, padding: "8px 12px", fontSize: 12, width: 200 }} />
        <div style={{ position: "relative" }}>
          <button onClick={() => setShowStatusDropdown(!showStatusDropdown)} style={{ border: "1px solid #26344f", background: "#16233b", color: "#9aa8c7", borderRadius: 8, padding: "8px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
            Status: {statusFilter.length === OVERVIEW_ALL_FILTER_STATUSES.length ? "All" : statusFilter.length === 0 ? "None" : `${statusFilter.length} selected`} ▾
          </button>
          {showStatusDropdown && (
            <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "#16233b", border: "1px solid #26344f", borderRadius: 10, padding: 10, zIndex: 50, minWidth: 200, maxHeight: 360, overflowY: "auto", boxShadow: "0 8px 24px #0008" }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <button onClick={selectAllStatuses} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: "#5539f6", color: "#fff", border: 0, cursor: "pointer" }}>All</button>
                <button onClick={selectOpenOnly} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: "#26344f", color: "#9aa8c7", border: 0, cursor: "pointer" }}>Open Only</button>
              </div>
              {OVERVIEW_ALL_FILTER_STATUSES.map(s => (
                <label key={s} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", fontSize: 12, color: "#cdd6f4", cursor: "pointer" }}>
                  <input type="checkbox" checked={statusFilter.includes(s)} onChange={() => toggleStatus(s)} style={{ accentColor: "#5539f6" }} />
                  {OVERVIEW_STATUS_LABELS[s] || s}
                </label>
              ))}
              <button onClick={() => setShowStatusDropdown(false)} style={{ marginTop: 8, fontSize: 10, padding: "4px 10px", borderRadius: 4, background: "#26344f", color: "#9aa8c7", border: 0, cursor: "pointer", width: "100%" }}>Close</button>
            </div>
          )}
        </div>
        <select value={apptFilter} onChange={e => setApptFilter(e.target.value as "all" | "assigned" | "none")} style={{ border: "1px solid #26344f", background: "#16233b", color: "#9aa8c7", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
          <option value="all">All Orders</option>
          <option value="assigned">Appointments Assigned</option>
          <option value="none">No Appointment</option>
        </select>
      </div>

      <p style={{ fontSize: 11, color: "#64748b", margin: "0 0 6px" }}>
        Showing all open operational orders in Imported, Open, Partial Committed, Commit Blocked, Commit Failed, Committed, Planning, Planned, Picking, Picked, Ready to Ship, Packing, Packed, Staged, Loading, Loaded, Reopen, Exception, Partial Shipped, Blocked, and On Hold status, including older orders. Sorted by urgency. Click a row to view full order details.
      </p>

      {error && <div className="notice">{error}</div>}
      <div className="actions">
        <button onClick={() => load(page || 1)} disabled={loading || loadingAll}>{loading ? "Loading..." : "Refresh"}</button>
        <button onClick={loadAll} disabled={loading || loadingAll}>{loadingAll ? "Loading all..." : `Load All ${total > 0 ? total.toLocaleString() : ""} Orders`}</button>
        {page > 0 && <>
          <button onClick={() => load(page - 1)} disabled={loading || loadingAll || page <= 1}>Previous</button>
          <button onClick={() => load(page + 1)} disabled={loading || loadingAll || page >= totalPages}>Next</button>
        </>}
        <span style={{ color: "#64748b", fontSize: 12, marginLeft: 8 }}>
          {page > 0
            ? `Page ${page} of ${totalPages} · ${filtered.length} shown · ${total.toLocaleString()} total open orders in WMS`
            : `All ${allOrders.length.toLocaleString()} of ${total.toLocaleString()} open orders loaded · ${filtered.length} after filters`
          }
        </span>
      </div>

      <div className="table">
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <th>Customer</th>
              <th>DN / Order #</th>
              <th>Status</th>
              <th>Created</th>
              <th>SLA Deadline</th>
              <th>Time Remaining</th>
              <th>Appointment</th>
              <th>Ship To</th>
              <th>PO / Ref</th>
            </tr>
          </thead>
          <tbody>
            {!loading && sorted.length === 0 && !error && (
              <tr><td colSpan={10} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>No orders match the current filters.</td></tr>
            )}
            {sorted.map(o => {
              const sla = o.createdTime ? timeRemaining(o.createdTime) : null;
              const deadline = o.createdTime ? fmt(slaDeadline(o.createdTime).toISOString()) : "—";
              const effectiveAppt = localAppts[o.id] || o.appointmentTime;
              const as = apptStatus(effectiveAppt);
              const isOverride = !!localAppts[o.id] && localAppts[o.id] !== o.appointmentTime;
              const rowCls = sla?.cls === "sla-critical" ? "row-critical" : sla?.cls === "sla-approaching" ? "row-approaching" : as.badge === "missed" ? "row-critical" : as.badge === "approaching" ? "row-approaching" : "";

              return (
                <tr key={o.id} className={rowCls} style={{ cursor: "pointer" }} onClick={() => setSelectedOrder(o)}>
                  <td style={{ textAlign: "center", color: "#5539f6", fontSize: 14 }} title="Expand order details">▶</td>
                  <td>{o.customerName || o.customerCode || "—"}</td>
                  <td style={{ fontWeight: 600 }}>{o.referenceNo || o.id}</td>
                  <td>{o.status || "—"}</td>
                  <td>{fmt(o.createdTime)}</td>
                  <td>{deadline}</td>
                  <td className={sla?.cls || ""}>{sla?.label || "—"}</td>
                  <td onClick={e => e.stopPropagation()}>
                    {editingAppt === o.id ? (
                      <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <input type="datetime-local" value={editValue} onChange={e => setEditValue(e.target.value)} style={{ fontSize: 11, padding: "3px 5px", background: "#101b31", border: "1px solid #26344f", color: "#eaf0ff", borderRadius: 4, width: 160 }} />
                        <button onClick={() => saveApptOverride(o.id, editValue)} style={{ fontSize: 10, padding: "3px 7px", background: "#5539f6", color: "#fff", border: 0, borderRadius: 4, cursor: "pointer" }}>Save</button>
                        <button onClick={() => setEditingAppt(null)} style={{ fontSize: 10, padding: "3px 7px", background: "#26344f", color: "#9aa8c7", border: 0, borderRadius: 4, cursor: "pointer" }}>✕</button>
                      </span>
                    ) : (
                      <span
                        onClick={() => { setEditingAppt(o.id); setEditValue(effectiveAppt ? new Date(effectiveAppt).toISOString().slice(0, 16) : ""); }}
                        style={{ cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3 }}
                        title="Click to edit appointment date/time"
                      >
                        {effectiveAppt ? fmt(effectiveAppt) : <span style={{ color: "#64748b" }}>+ Add</span>}
                        {as.badge === "missed" && <span className="badge-missed">🔴 Missed</span>}
                        {as.badge === "approaching" && <span className="badge-approaching">⚠ 1h</span>}
                        {!as.badge && effectiveAppt && <span style={{ color: "#4ade80", marginLeft: 4, fontSize: 10 }}>●</span>}
                        {isOverride && <span style={{ fontSize: 9, color: "#a99cff", marginLeft: 4 }}>draft</span>}
                      </span>
                    )}
                  </td>
                  <td>{[o.shipToAddress?.name, o.shipToAddress?.city, o.shipToAddress?.state].filter(Boolean).join(", ") || "—"}</td>
                  <td>{o.poNo || o.referenceNo || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Order Detail Side Panel */}
      <OrderDetailPanel
        order={selectedOrder}
        localAppts={localAppts}
        onClose={() => setSelectedOrder(null)}
        onSaveAppt={saveApptOverride}
        token={token}
      />
    </>
  );
}
