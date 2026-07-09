"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";

// =============================================================================
// NO APPOINTMENT QUEUE — Shows LTL orders with no appointment assigned
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
}

const FINAL_STATUSES = ["SHIPPED", "COMPLETED", "CANCELLED", "SHORT_SHIPPED"];

function fmt(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

async function wmsProxy(token: string, path: string, body: unknown) {
  const res = await fetch("/api/wms", { method: "POST", headers: { "Content-Type": "application/json", "x-session-token": token }, body: JSON.stringify({ path, body }) });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Data could not be loaded.");
  return json;
}

export default function NoAppointmentQueuePage() {
  const { token } = useAuth();
  const [orders, setOrders] = useState<LtlOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [carrierFilter, setCarrierFilter] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError("");
    try {
      const json = await wmsProxy(token, "/wms-bam/outbound/order/raw-search", {
        currentPage: 1, pageSize: 200, shipMethod: "LTL",
        excludeStatuses: FINAL_STATUSES,
        sortingFields: [{ field: "createdTime", orderBy: "DESC" }],
      });
      if (json?.success === false && json?.msg) throw new Error(json.msg);
      const list: LtlOrder[] = Array.isArray(json?.data) ? json.data : [];
      const noAppt = list.filter(o => !o.appointmentTime && !FINAL_STATUSES.includes((o.status || "").toUpperCase()));
      setOrders(noAppt);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Unable to load data."); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (customerFilter && !(o.customerName || o.customerCode || "").toLowerCase().includes(customerFilter.toLowerCase())) return false;
      if (carrierFilter && !(o.carrierName || o.carrierId || "").toLowerCase().includes(carrierFilter.toLowerCase())) return false;
      return true;
    });
  }, [orders, customerFilter, carrierFilter]);

  return (
    <>
      <h1>No Appointment Queue</h1>
      <p className="muted">LTL shipments without a scheduled appointment. These require appointment scheduling before pickup can occur.</p>

      <section className="stats">
        <div>Total Without Appt<br /><b>{filtered.length}</b></div>
      </section>

      <div className="filter-toolbar">
        <input type="text" placeholder="Customer" value={customerFilter} onChange={e => setCustomerFilter(e.target.value)} className="filter-input" />
        <input type="text" placeholder="Carrier" value={carrierFilter} onChange={e => setCarrierFilter(e.target.value)} className="filter-input" style={{ width: 120 }} />
        <button onClick={load} disabled={loading} style={{ border: 0, borderRadius: 6, background: "#5539f6", color: "#fff", padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{loading ? "Loading..." : "Refresh"}</button>
        <a href="/dashboard/ltl-appointments" style={{ fontSize: 11, color: "#5539f6", textDecoration: "none", marginLeft: "auto" }}>← Back to LTL Appointments</a>
      </div>

      {error && <div className="notice">{error}</div>}

      <div className="table">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Customer</th><th>RN</th><th>DN</th><th>Load #</th><th>Carrier</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              {!loading && filtered.length === 0 && !error && (
                <tr><td colSpan={7} style={{ textAlign: "center", padding: 30, color: "#64748b" }}>No LTL shipments without appointments.</td></tr>
              )}
              {filtered.map(o => (
                <tr key={o.id}>
                  <td>{o.customerName || o.customerCode || "—"}</td>
                  <td>{o.bolNo || "—"}</td>
                  <td style={{ fontWeight: 600 }}>{o.referenceNo || o.id}</td>
                  <td>{o.loadNo || "—"}</td>
                  <td>{o.carrierName || o.carrierId || "—"}</td>
                  <td>{o.status || "—"}</td>
                  <td>{fmt(o.createdTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
