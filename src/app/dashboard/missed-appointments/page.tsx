"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { saveActivityEntry, getShipmentActivity, type ActivityEntry } from "@/app/dashboard/activity-log/page";

// --- Types ---
interface Appointment {
  id: string;
  sid?: string;
  carrierId?: string;
  carrierName?: string;
  appointmentType?: string;
  appointmentTime?: string;
  apptStatus?: string;
  createdTime?: string;
  startTime?: string;
  endTime?: string;
  customerIds?: string[];
  customerNames?: string[];
  preCheckNo?: string;
  appointmentActions?: {
    appointmentType?: string;
    serviceType?: string;
    referenceNos?: string[];
    receipts?: { id?: string; referenceNo?: string; customerId?: string; customerName?: string; status?: string; receiptStatus?: string }[];
    loads?: { id?: string; loadNo?: string; customerId?: string; customerName?: string; status?: string; loadStatus?: string; orderStatus?: string; shipmentStatus?: string }[];
  }[];
}

// --- Helpers ---
function fmt(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function timeSince(d: string): { label: string; hours: number; days: number } {
  const ms = Date.now() - new Date(d).getTime();
  const hours = ms / (1000 * 60 * 60);
  const days = hours / 24;
  if (days >= 1) return { label: `${days.toFixed(1)} days`, hours, days };
  if (hours >= 1) return { label: `${hours.toFixed(1)} hours`, hours, days };
  return { label: `${Math.round(ms / 60000)} min`, hours, days };
}

const FINAL_PARENT_STATUS_WORDS = [
  "SHIPPED", "COMPLETED", "COMPLETE", "CLOSED", "CANCELLED", "CANCELED",
  "VOID", "DELIVERED", "SHORT_SHIPPED", "SHORTSHIPPED", "FINALIZED",
];
const RESOLVED_APPT_STATUS_WORDS = [
  "COMPLETED", "COMPLETE", "CONFIRMED_ARRIVED", "CONFIRMEDARRIVED", "CHECKED_IN", "CHECKEDIN",
  "IN_PROGRESS", "INPROGRESS", "ARRIVED", "CONFIRM", "CONFIRMED", "CANCELLED", "CANCELED", "CLOSED",
];

function normStatus(v?: string) { return (v || "").replace(/[\s-]/g, "_").toUpperCase(); }
function isFinalStatus(v?: string) {
  const n = normStatus(v).replace(/_/g, "");
  return FINAL_PARENT_STATUS_WORDS.some(s => n === s.replace(/_/g, "") || n.includes(s.replace(/_/g, "")));
}
function isResolvedAppointmentStatus(v?: string) {
  const n = normStatus(v).replace(/_/g, "");
  return RESOLVED_APPT_STATUS_WORDS.some(s => n === s.replace(/_/g, "") || n.includes(s.replace(/_/g, "")));
}
function getParentStatusValues(appt: Appointment): string[] {
  const values: string[] = [];
  const anyAppt = appt as unknown as Record<string, unknown>;
  ["orderStatus", "loadStatus", "shipmentStatus", "status", "statusDesc", "outboundStatus"].forEach(k => {
    const v = anyAppt[k]; if (typeof v === "string") values.push(v);
  });
  for (const action of appt.appointmentActions || []) {
    const anyAction = action as unknown as Record<string, unknown>;
    ["orderStatus", "loadStatus", "shipmentStatus", "status", "statusDesc", "outboundStatus"].forEach(k => {
      const v = anyAction[k]; if (typeof v === "string") values.push(v);
    });
    for (const load of action.loads || []) [load.status, load.loadStatus, load.orderStatus, load.shipmentStatus].forEach(v => { if (v) values.push(v); });
    for (const receipt of action.receipts || []) [receipt.status, receipt.receiptStatus].forEach(v => { if (v) values.push(v); });
  }
  return values;
}
function hasFinalParentStatus(appt: Appointment) { return getParentStatusValues(appt).some(isFinalStatus); }
function getAppointmentRefs(appt: Appointment): string[] {
  const refs = new Set<string>();
  const add = (v?: string) => { if (v) refs.add(v.trim().toUpperCase()); };
  add(appt.id); add(appt.sid); add(appt.preCheckNo);
  for (const action of appt.appointmentActions || []) {
    action.referenceNos?.forEach(add);
    action.loads?.forEach(l => { add(l.loadNo); add(l.id); });
    action.receipts?.forEach(r => { add(r.referenceNo); add(r.id); });
  }
  return [...refs].filter(Boolean);
}
function getOrderRefs(order: Record<string, unknown>): string[] {
  const refs = new Set<string>();
  const add = (v: unknown) => { if (typeof v === "string" && v.trim()) refs.add(v.trim().toUpperCase()); };
  ["id", "orderNo", "orderNumber", "referenceNo", "poNo", "loadNo", "bolNo", "containerNo", "trackingNo", "dnNo"].forEach(k => add(order[k]));
  const arrays = [order.soNos, order.referenceNos, order.dnNos, order.loadNos];
  arrays.forEach(arr => Array.isArray(arr) && arr.forEach(add));
  return [...refs];
}

function getApptStatus(appt: Appointment): { label: string; cls: string; badge: string } {
  const scheduled = appt.appointmentTime ? new Date(appt.appointmentTime) : null;
  if (!scheduled) return { label: "Unknown", cls: "", badge: "" };

  const now = Date.now();
  const status = appt.apptStatus || "";

  if (hasFinalParentStatus(appt) || isFinalStatus(status)) {
    return { label: "Closed", cls: "status-ontime", badge: "🟢" };
  }
  if (isResolvedAppointmentStatus(status)) {
    if (normStatus(status).includes("CANCEL")) return { label: "Cancelled", cls: "status-scheduled", badge: "" };
    return { label: normStatus(status).includes("IN_PROGRESS") || normStatus(status).includes("CHECKED") ? "In Progress" : "Confirmed", cls: "status-ontime", badge: "🟢" };
  }

  const msSincePast = now - scheduled.getTime();
  if (msSincePast > 60 * 60 * 1000) return { label: "Missed Appointment", cls: "status-missed", badge: "🔴" };
  if (msSincePast > 0) return { label: "In Progress", cls: "status-late", badge: "🟡" };
  return { label: "Scheduled", cls: "status-scheduled", badge: "" };
}

function getCustomerName(appt: Appointment): string {
  if (appt.customerNames?.length) return appt.customerNames[0];
  const actions = appt.appointmentActions || [];
  for (const a of actions) {
    if (a.receipts?.length) { const c = a.receipts.find(r => r.customerName); if (c) return c.customerName!; }
    if (a.loads?.length) { const c = a.loads.find(l => l.customerName); if (c) return c.customerName!; }
  }
  return "—";
}

function getRN(appt: Appointment): string {
  const actions = appt.appointmentActions || [];
  for (const a of actions) {
    if (a.receipts?.length) return a.receipts.map(r => r.referenceNo || r.id).filter(Boolean).join(", ");
    if (a.referenceNos?.length) return a.referenceNos.join(", ");
  }
  return "—";
}

function getDN(appt: Appointment): string {
  const actions = appt.appointmentActions || [];
  for (const a of actions) {
    if (a.loads?.length) return a.loads.map(l => l.loadNo || l.id).filter(Boolean).join(", ");
  }
  return "—";
}

// --- WMS Proxy ---
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

// --- Executive SVG Charts (high-contrast, larger, readable on dark bg) ---

const C = { red: "#FF4D4F", orange: "#FF7A45", blue: "#3B82F6", purple: "#8B5CF6", green: "#22C55E", yellow: "#FACC15", cyan: "#06B6D4" };

function CarrierBarChart({ data, title, totalMissed, onBarClick }: { data: { label: string; value: number }[]; title: string; totalMissed: number; onBarClick?: (label: string) => void }) {
  const sorted = [...data].sort((a, b) => b.value - a.value).slice(0, 12);
  if (sorted.length === 0) return <div className="chart-box full"><h3 className="chart-title">{title}</h3><p style={{ color: "#64748b", fontSize: 14 }}>No data available.</p></div>;
  const max = Math.max(...sorted.map(d => d.value), 1);
  const rowH = 44;
  const labelW = 180;
  const chartW = 700;
  const h = sorted.length * rowH + 10;

  return (
    <div className="chart-box full">
      <h3 className="chart-title">{title}</h3>
      <svg width="100%" height={h} viewBox={`0 0 ${chartW} ${h}`} preserveAspectRatio="xMinYMin meet" style={{ display: "block" }}>
        {sorted.map((d, i) => {
          const barW = Math.max((d.value / max) * (chartW - labelW - 120), 4);
          const y = i * rowH;
          const pct = totalMissed > 0 ? Math.round(d.value / totalMissed * 100) : 0;
          return (
            <g key={d.label} onClick={() => onBarClick?.(d.label)} style={{ cursor: onBarClick ? "pointer" : "default" }}>
              <title>{d.label}: {d.value} ({pct}%)</title>
              <text x={labelW - 10} y={y + 28} fontSize={13} fill="#eaf0ff" textAnchor="end" fontWeight={500}>{d.label.length > 24 ? d.label.slice(0, 22) + "…" : d.label}</text>
              <rect x={labelW} y={y + 10} width={barW} height={24} rx={5} fill={C.orange} opacity={0.9} />
              <text x={labelW + barW + 10} y={y + 28} fontSize={13} fill="#eaf0ff" fontWeight={700}>{d.value} · {pct}%</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function CustomerBarChart({ data, title, totalMissed, onBarClick }: { data: { label: string; value: number }[]; title: string; totalMissed: number; onBarClick?: (label: string) => void }) {
  const sorted = [...data].sort((a, b) => b.value - a.value).slice(0, 10);
  if (sorted.length === 0) return <div className="chart-box"><h3 className="chart-title">{title}</h3><p style={{ color: "#64748b", fontSize: 14 }}>No data available.</p></div>;
  const max = Math.max(...sorted.map(d => d.value), 1);
  const rowH = 40;
  const labelW = 170;
  const chartW = 560;
  const h = sorted.length * rowH + 10;

  return (
    <div className="chart-box">
      <h3 className="chart-title">{title}</h3>
      <svg width="100%" height={h} viewBox={`0 0 ${chartW} ${h}`} preserveAspectRatio="xMinYMin meet" style={{ display: "block" }}>
        {sorted.map((d, i) => {
          const barW = Math.max((d.value / max) * (chartW - labelW - 100), 4);
          const y = i * rowH;
          const pct = totalMissed > 0 ? Math.round(d.value / totalMissed * 100) : 0;
          return (
            <g key={d.label} onClick={() => onBarClick?.(d.label)} style={{ cursor: onBarClick ? "pointer" : "default" }}>
              <title>{d.label}: {d.value} ({pct}%)</title>
              <text x={labelW - 10} y={y + 26} fontSize={12} fill="#eaf0ff" textAnchor="end">{d.label.length > 22 ? d.label.slice(0, 20) + "…" : d.label}</text>
              <rect x={labelW} y={y + 9} width={barW} height={22} rx={4} fill={C.purple} opacity={0.9} />
              <text x={labelW + barW + 8} y={y + 26} fontSize={12} fill="#eaf0ff" fontWeight={700}>{d.value} · {pct}%</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function OverdueChart({ data, onBarClick }: { data: { label: string; avg: number; longest: number; total: number }[]; onBarClick?: (label: string) => void }) {
  const sorted = [...data].sort((a, b) => b.avg - a.avg).slice(0, 10);
  if (sorted.length === 0) return <div className="chart-box"><h3 className="chart-title">Average Days Overdue by Carrier</h3><p style={{ color: "#64748b", fontSize: 14 }}>No data available.</p></div>;

  return (
    <div className="chart-box">
      <h3 className="chart-title">Average Days Overdue by Carrier</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth: 400, borderCollapse: "collapse" }}>
          <thead><tr style={{ borderBottom: "1px solid #26344f" }}>
            <th style={{ textAlign: "left", padding: "8px 10px", fontSize: 11, color: "#8899b4", fontWeight: 700, background: "transparent" }}>Carrier</th>
            <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 11, color: "#8899b4", fontWeight: 700, background: "transparent" }}>Avg Days</th>
            <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 11, color: "#8899b4", fontWeight: 700, background: "transparent" }}>Longest</th>
            <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 11, color: "#8899b4", fontWeight: 700, background: "transparent" }}>Total Missed</th>
          </tr></thead>
          <tbody>
            {sorted.map(d => (
              <tr key={d.label} onClick={() => onBarClick?.(d.label)} style={{ cursor: onBarClick ? "pointer" : "default", borderBottom: "1px solid #1e2d47" }}>
                <td style={{ padding: "8px 10px", fontSize: 13, color: "#eaf0ff", fontWeight: 500 }}>{d.label.length > 22 ? d.label.slice(0, 20) + "…" : d.label}</td>
                <td style={{ padding: "8px 10px", fontSize: 14, color: C.red, fontWeight: 700, textAlign: "right" }}>{d.avg.toFixed(1)}</td>
                <td style={{ padding: "8px 10px", fontSize: 13, color: C.orange, textAlign: "right" }}>{d.longest.toFixed(1)}</td>
                <td style={{ padding: "8px 10px", fontSize: 13, color: "#cdd6f4", textAlign: "right" }}>{d.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TrendChart({ data, title }: { data: { label: string; value: number }[]; title: string }) {
  const [range, setRange] = useState<"7d" | "30d" | "90d" | "ytd">("90d");
  void range; // range selector UI below; data already pre-aggregated

  if (data.length === 0) return <div className="chart-box"><h3 className="chart-title">{title}</h3><p style={{ color: "#64748b", fontSize: 14 }}>No data available.</p></div>;

  if (data.length === 1) {
    return (
      <div className="chart-box">
        <h3 className="chart-title">{title}</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 20, padding: "24px 0" }}>
          <div style={{ width: 72, height: 72, borderRadius: "50%", background: C.cyan, display: "grid", placeItems: "center" }}>
            <span style={{ fontSize: 26, fontWeight: 800, color: "#fff" }}>{data[0].value}</span>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 16, color: "#eaf0ff", fontWeight: 700 }}>{data[0].label}</p>
            <p style={{ margin: "6px 0 0", fontSize: 13, color: "#9aa8c7" }}>{data[0].value} missed appointment{data[0].value !== 1 ? "s" : ""} this period</p>
          </div>
        </div>
      </div>
    );
  }

  const max = Math.max(...data.map(d => d.value), 1);
  const padding = { top: 30, right: 40, bottom: 50, left: 50 };
  const chartW = Math.max(data.length * 90, 400);
  const chartH = 240;
  const innerW = chartW - padding.left - padding.right;
  const innerH = chartH - padding.top - padding.bottom;

  const points = data.map((d, i) => {
    const x = padding.left + (i / (data.length - 1)) * innerW;
    const y = padding.top + innerH - (d.value / max) * innerH;
    return { x, y, ...d };
  });

  const polyline = points.map(p => `${p.x},${p.y}`).join(" ");
  const firstVal = data[0].value;
  const lastVal = data[data.length - 1].value;
  const trendUp = lastVal > firstVal;
  const trendLabel = lastVal === firstVal ? "— Stable" : trendUp ? "▲ Increasing" : "▼ Decreasing";
  const trendColor = lastVal === firstVal ? "#9aa8c7" : trendUp ? C.red : C.green;

  return (
    <div className="chart-box">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h3 className="chart-title" style={{ margin: 0 }}>{title}</h3>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {(["7d", "30d", "90d", "ytd"] as const).map(r => (
            <button key={r} onClick={() => setRange(r)} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: range === r ? C.cyan : "#26344f", color: range === r ? "#fff" : "#9aa8c7", border: 0, cursor: "pointer", fontWeight: 700 }}>
              {r === "7d" ? "7D" : r === "30d" ? "30D" : r === "90d" ? "90D" : "YTD"}
            </button>
          ))}
          <span style={{ fontSize: 12, fontWeight: 700, color: trendColor, marginLeft: 8 }}>{trendLabel}</span>
        </div>
      </div>
      <svg width="100%" height={chartH} viewBox={`0 0 ${chartW} ${chartH}`} preserveAspectRatio="xMinYMin meet" style={{ display: "block", marginTop: 12 }}>
        {[0, 0.25, 0.5, 0.75, 1].map(f => {
          const y = padding.top + innerH - f * innerH;
          return <line key={f} x1={padding.left} x2={chartW - padding.right} y1={y} y2={y} stroke="#26344f" strokeWidth={0.5} />;
        })}
        <polygon points={`${points[0].x},${padding.top + innerH} ${polyline} ${points[points.length - 1].x},${padding.top + innerH}`} fill={C.cyan} opacity={0.08} />
        <polyline points={polyline} fill="none" stroke={C.cyan} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <g key={i}>
            <title>{p.label}: {p.value}</title>
            <circle cx={p.x} cy={p.y} r={6} fill={C.cyan} stroke="#0e1729" strokeWidth={2.5} />
            <text x={p.x} y={p.y - 14} fontSize={13} fill="#eaf0ff" textAnchor="middle" fontWeight={700}>{p.value}</text>
            <text x={p.x} y={chartH - 10} fontSize={11} fill="#9aa8c7" textAnchor="middle">{p.label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function DonutChart({ data, title }: { data: { label: string; value: number; color: string }[]; title: string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div className="chart-box"><h3 className="chart-title">{title}</h3><p style={{ color: "#64748b", fontSize: 14 }}>No data available.</p></div>;

  const nonZero = data.filter(d => d.value > 0);
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 88;
  const innerR = 56;

  if (nonZero.length === 1) {
    return (
      <div className="chart-box">
        <h3 className="chart-title">{title}</h3>
        <div style={{ display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap" }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle cx={cx} cy={cy} r={outerR} fill={nonZero[0].color} opacity={0.9} />
            <circle cx={cx} cy={cy} r={innerR} fill="#16233b" />
            <text x={cx} y={cy + 8} fontSize={28} fill="#eaf0ff" textAnchor="middle" fontWeight={800}>{total}</text>
          </svg>
          <div style={{ display: "grid", gap: 10 }}>
            {data.map(d => (
              <div key={d.label} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 15, color: "#eaf0ff" }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, background: d.color, display: "inline-block", opacity: d.value > 0 ? 1 : 0.3 }} />
                <span style={{ fontWeight: 700 }}>{d.label}</span>
                <span style={{ color: "#9aa8c7", fontWeight: 500 }}>{d.value} ({Math.round(d.value / total * 100)}%)</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  let cumulative = 0;
  const segments = nonZero.map(d => {
    const startAngle = (cumulative / total) * 360;
    cumulative += d.value;
    const endAngle = (cumulative / total) * 360;
    return { ...d, startAngle, endAngle };
  });

  function describeArc(startAngle: number, endAngle: number, r: number) {
    const start = (startAngle - 90) * Math.PI / 180;
    const end = (endAngle - 90) * Math.PI / 180;
    return { x1: cx + r * Math.cos(start), y1: cy + r * Math.sin(start), x2: cx + r * Math.cos(end), y2: cy + r * Math.sin(end), largeArc: endAngle - startAngle > 180 ? 1 : 0 };
  }

  return (
    <div className="chart-box">
      <h3 className="chart-title">{title}</h3>
      <div style={{ display: "flex", gap: 28, alignItems: "center", flexWrap: "wrap" }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {segments.map(seg => {
            const outer = describeArc(seg.startAngle, seg.endAngle, outerR);
            const inner = describeArc(seg.startAngle, seg.endAngle, innerR);
            const path = `M ${outer.x1} ${outer.y1} A ${outerR} ${outerR} 0 ${outer.largeArc} 1 ${outer.x2} ${outer.y2} L ${inner.x2} ${inner.y2} A ${innerR} ${innerR} 0 ${outer.largeArc} 0 ${inner.x1} ${inner.y1} Z`;
            return <path key={seg.label} d={path} fill={seg.color} opacity={0.9}><title>{seg.label}: {seg.value} ({Math.round(seg.value / total * 100)}%)</title></path>;
          })}
          <circle cx={cx} cy={cy} r={innerR} fill="#16233b" />
          <text x={cx} y={cy + 8} fontSize={28} fill="#eaf0ff" textAnchor="middle" fontWeight={800}>{total}</text>
        </svg>
        <div style={{ display: "grid", gap: 10 }}>
          {data.map(d => (
            <div key={d.label} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 15, color: "#eaf0ff" }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: d.color, display: "inline-block", opacity: d.value > 0 ? 1 : 0.3 }} />
              <span style={{ fontWeight: 700 }}>{d.label}</span>
              <span style={{ color: "#9aa8c7", fontWeight: 500 }}>{d.value} ({Math.round(d.value / total * 100)}%)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Export ---
function exportCSV(appointments: Appointment[], localStatuses: Map<string, ReturnType<typeof getApptStatus>>) {
  const header = "Customer,RN,DN,Appointment Type,Carrier,Scheduled Date,Time Since Missed,Status\n";
  const rows = appointments.map(a => {
    const status = localStatuses.get(a.id) || getApptStatus(a);
    const ts = a.appointmentTime && status.label === "Missed Appointment" ? timeSince(a.appointmentTime).label : "—";
    return [getCustomerName(a), getRN(a), getDN(a), a.appointmentType || "", a.carrierName || a.carrierId || "", a.appointmentTime || "", ts, status.label].map(v => `"${(v || "").replace(/"/g, '""')}"`).join(",");
  }).join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `missed-appointments-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function exportPrint() {
  window.print();
}

// --- Main Component ---
export default function MissedAppointmentsPage() {
  const { token } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [stale, setStale] = useState(false);

  // Filters
  const [customerFilter, setCustomerFilter] = useState("");
  const [carrierFilter, setCarrierFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "INBOUND" | "OUTBOUND">("");
  const [statusFilterVal, setStatusFilterVal] = useState<"" | "missed" | "late" | "ontime">("");
  const [rnFilter, setRnFilter] = useState("");
  const [dnFilter, setDnFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [drillCarrier, setDrillCarrier] = useState("");

  // Sortable columns
  type ApptSortCol = "customer" | "rn" | "dn" | "type" | "carrier" | "scheduled" | "timeSince" | "status";
  type ApptSortDir = "asc" | "desc" | null;
  const [sortCol, setSortCol] = useState<ApptSortCol | null>(null);
  const [sortDir, setSortDir] = useState<ApptSortDir>(null);
  const handleSort = useCallback((col: ApptSortCol) => {
    if (sortCol !== col) { setSortCol(col); setSortDir("asc"); }
    else if (sortDir === "asc") { setSortDir("desc"); }
    else { setSortCol(null); setSortDir(null); }
  }, [sortCol, sortDir]);
  function sortInd(col: ApptSortCol) { if (sortCol !== col) return "▲▼"; return sortDir === "asc" ? "▲" : "▼"; }

  // Detail panel
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [panelActivity, setPanelActivity] = useState<ActivityEntry[]>([]);

  // Test mode notification
  const TEST_RECIPIENT = "erin.cambra@unisco.com";
  function sendTestNotification(appt: Appointment, template: "missed" | "late" | "rescheduled") {
    const subjects: Record<string, string> = { missed: "Missed Appointment Notification", late: "Carrier Running Late", rescheduled: "Your Appointment Has Been Rescheduled" };
    saveActivityEntry({ shipmentId: appt.id, orderNumber: appt.sid || appt.id, user: "System", previousStatus: "", newStatus: template === "missed" ? "Missed Appointment" : template === "late" ? "Late" : "Rescheduled", action: `Test notification: ${subjects[template]}`, emailSent: "test", recipient: TEST_RECIPIENT, comments: `Template: ${subjects[template]}. Test Mode — routed to ${TEST_RECIPIENT} only.` });
  }

  // Mark status action
  function markApptAction(appt: Appointment, newStatus: string) {
    const prev = statusMap.get(appt.id)?.label || "Unknown";
    saveActivityEntry({ shipmentId: appt.id, orderNumber: appt.sid || appt.id, user: "ecambra", previousStatus: prev, newStatus, action: `Status changed to ${newStatus}`, emailSent: "no", recipient: "", comments: "" });
    if (newStatus === "Missed Appointment") sendTestNotification(appt, "missed");
    if (newStatus === "Late") sendTestNotification(appt, "late");
    if (newStatus === "Rescheduled") sendTestNotification(appt, "rescheduled");
  }

  // Live refresh interval (45 seconds default)
  const REFRESH_INTERVAL_MS = 45000;
  const OPEN_ORDER_STATUSES = [
    "IMPORTED", "OPEN", "PARTIAL_COMMITTED", "COMMIT_BLOCKED", "COMMIT_FAILED",
    "COMMITTED", "PLANNING", "PLANNED", "PICKING", "PICKED", "READY_TO_SHIP",
    "PACKING", "PACKED", "STAGED", "LOADING", "LOADED", "REOPEN", "EXCEPTION",
    "PARTIAL_SHIPPED", "BLOCKED", "ON_HOLD",
  ];

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true); setError(""); setStale(false);
    try {
      const [apptJson, openOrdersJson] = await Promise.all([
        wmsProxy(token, "/wms-bam/appointment/search-by-paging", { currentPage: 1, pageSize: 500 }),
        // Delta appointment refresh is not exposed by the verified WMS endpoint; refresh the current live page and cross-check outbound appointments against open orders.
        wmsProxy(token, "/wms-bam/outbound/order/search-by-paging", { currentPage: 1, pageSize: 2000, statuses: OPEN_ORDER_STATUSES }).catch(() => null),
      ]);
      if (!apptJson?.success) throw new Error("Appointment data could not be loaded.");
      const raw: Appointment[] = apptJson.data?.list || [];
      const openOrderRefs = new Set<string>();
      const openOrders = openOrdersJson?.data?.list || [];
      openOrders.forEach((order: Record<string, unknown>) => getOrderRefs(order).forEach(ref => openOrderRefs.add(ref)));

      const active = raw.filter(a => {
        if (hasFinalParentStatus(a) || isFinalStatus(a.apptStatus) || isResolvedAppointmentStatus(a.apptStatus)) return false;
        const type = (a.appointmentType || "").toUpperCase();
        const refs = getAppointmentRefs(a);
        // For outbound appointments, remove rows whose DN/load/order reference is no longer in the open-order set.
        // If WMS does not provide parent refs, keep the row and rely on appointment/parent status fields above.
        if (type === "OUTBOUND" && openOrderRefs.size > 0 && refs.length > 0) return refs.some(ref => openOrderRefs.has(ref));
        return true;
      });
      const unique = Array.from(new Map(active.map(a => [a.id || getAppointmentRefs(a).join("|"), a])).values());
      setAppointments(unique);
      setLastUpdated(new Date().toLocaleString("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unable to retrieve the latest appointment data. Retrying...");
      setStale(true);
    } finally { setLoading(false); }
  }, [token]);

  // Initial load
  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 45 seconds + tick for time calculations
  useEffect(() => {
    const dataInterval = setInterval(() => { load(); }, REFRESH_INTERVAL_MS);
    const tickInterval = setInterval(() => setTick(t => t + 1), 30000);
    return () => { clearInterval(dataInterval); clearInterval(tickInterval); };
  }, [load]);

  // Compute statuses
  const statusMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getApptStatus>>();
    appointments.forEach(a => map.set(a.id, getApptStatus(a)));
    return map;
  }, [appointments, tick]);

  // Filtered list
  const filtered = useMemo(() => {
    return appointments.filter(a => {
      const status = statusMap.get(a.id);
      if (customerFilter) { if (!getCustomerName(a).toLowerCase().includes(customerFilter.toLowerCase())) return false; }
      if (carrierFilter) { if (!(a.carrierName || a.carrierId || "").toLowerCase().includes(carrierFilter.toLowerCase())) return false; }
      if (typeFilter) { if ((a.appointmentType || "").toUpperCase() !== typeFilter) return false; }
      if (statusFilterVal) {
        if (statusFilterVal === "missed" && status?.label !== "Missed Appointment") return false;
        if (statusFilterVal === "late" && status?.label !== "Late") return false;
        if (statusFilterVal === "ontime" && status?.label !== "On Time") return false;
      }
      if (rnFilter) { if (!getRN(a).toLowerCase().includes(rnFilter.toLowerCase())) return false; }
      if (dnFilter) { if (!getDN(a).toLowerCase().includes(dnFilter.toLowerCase())) return false; }
      if (dateFrom && a.appointmentTime && new Date(a.appointmentTime) < new Date(dateFrom)) return false;
      if (dateTo && a.appointmentTime && new Date(a.appointmentTime) > new Date(dateTo + "T23:59:59")) return false;
      if (drillCarrier) { if ((a.carrierName || a.carrierId || "") !== drillCarrier) return false; }
      return true;
    });
  }, [appointments, statusMap, customerFilter, carrierFilter, typeFilter, statusFilterVal, rnFilter, dnFilter, dateFrom, dateTo, drillCarrier]);

  // Sort: user column sort or default (missed first, then oldest)
  const sorted = useMemo(() => {
    void tick;
    const arr = [...filtered];
    if (!sortCol || !sortDir) {
      return arr.sort((a, b) => {
        const sa = statusMap.get(a.id); const sb = statusMap.get(b.id);
        const oA = sa?.label === "Missed Appointment" ? 0 : sa?.label === "Late" ? 1 : 2;
        const oB = sb?.label === "Missed Appointment" ? 0 : sb?.label === "Late" ? 1 : 2;
        if (oA !== oB) return oA - oB;
        return (a.appointmentTime ? new Date(a.appointmentTime).getTime() : Infinity) - (b.appointmentTime ? new Date(b.appointmentTime).getTime() : Infinity);
      });
    }
    const dir = sortDir === "asc" ? 1 : -1;
    return arr.sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "customer": cmp = getCustomerName(a).localeCompare(getCustomerName(b), undefined, { sensitivity: "base" }); break;
        case "rn": cmp = getRN(a).localeCompare(getRN(b), undefined, { sensitivity: "base" }); break;
        case "dn": cmp = getDN(a).localeCompare(getDN(b), undefined, { sensitivity: "base" }); break;
        case "type": cmp = (a.appointmentType || "").localeCompare(b.appointmentType || "", undefined, { sensitivity: "base" }); break;
        case "carrier": cmp = (a.carrierName || a.carrierId || "").localeCompare(b.carrierName || b.carrierId || "", undefined, { sensitivity: "base" }); break;
        case "scheduled": cmp = (a.appointmentTime ? new Date(a.appointmentTime).getTime() : 0) - (b.appointmentTime ? new Date(b.appointmentTime).getTime() : 0); break;
        case "timeSince": { const ta = a.appointmentTime ? Date.now() - new Date(a.appointmentTime).getTime() : 0; const tb = b.appointmentTime ? Date.now() - new Date(b.appointmentTime).getTime() : 0; cmp = ta - tb; break; }
        case "status": { const sa = statusMap.get(a.id); const sb = statusMap.get(b.id); const pA = sa?.label === "Missed Appointment" ? 0 : sa?.label === "Late" ? 1 : sa?.label === "On Time" ? 3 : 2; const pB = sb?.label === "Missed Appointment" ? 0 : sb?.label === "Late" ? 1 : sb?.label === "On Time" ? 3 : 2; cmp = pA - pB; break; }
      }
      return cmp * dir;
    });
  }, [filtered, statusMap, sortCol, sortDir, tick]);

  // KPI metrics
  const kpis = useMemo(() => {
    void tick;
    let missed = 0, late = 0, onTime = 0;
    const carrierMissed: Record<string, number> = {};
    const customerMissed: Record<string, number> = {};

    appointments.forEach(a => {
      const s = statusMap.get(a.id);
      if (s?.label === "Missed Appointment") {
        missed++;
        const carrier = a.carrierName || a.carrierId || "Unknown";
        carrierMissed[carrier] = (carrierMissed[carrier] || 0) + 1;
        const cust = getCustomerName(a);
        customerMissed[cust] = (customerMissed[cust] || 0) + 1;
      } else if (s?.label === "Late") { late++; }
      else if (s?.label === "On Time") { onTime++; }
    });

    const total = appointments.length || 1;
    const worstCarrier = Object.entries(carrierMissed).sort((a, b) => b[1] - a[1])[0];
    const mostImpacted = Object.entries(customerMissed).sort((a, b) => b[1] - a[1])[0];

    return {
      missed, late, onTime,
      missedPct: Math.round(missed / total * 100),
      onTimePct: Math.round(onTime / total * 100),
      worstCarrier: worstCarrier ? `${worstCarrier[0]} (${worstCarrier[1]})` : "—",
      mostImpacted: mostImpacted ? `${mostImpacted[0]} (${mostImpacted[1]})` : "—",
    };
  }, [appointments, statusMap, tick]);

  // Chart data
  const chartData = useMemo(() => {
    void tick;
    const carrierMissed: Record<string, number> = {};
    const customerMissed: Record<string, number> = {};
    const monthlyMissed: Record<string, number> = {};
    const carrierDaysOverdue: Record<string, { total: number; count: number; longest: number }> = {};

    appointments.forEach(a => {
      const s = statusMap.get(a.id);
      if (s?.label === "Missed Appointment") {
        const carrier = a.carrierName || a.carrierId || "Unknown";
        carrierMissed[carrier] = (carrierMissed[carrier] || 0) + 1;
        const cust = getCustomerName(a);
        customerMissed[cust] = (customerMissed[cust] || 0) + 1;
        if (a.appointmentTime) {
          const month = new Date(a.appointmentTime).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
          monthlyMissed[month] = (monthlyMissed[month] || 0) + 1;
          const days = timeSince(a.appointmentTime).days;
          if (!carrierDaysOverdue[carrier]) carrierDaysOverdue[carrier] = { total: 0, count: 0, longest: 0 };
          carrierDaysOverdue[carrier].total += days;
          carrierDaysOverdue[carrier].count++;
          if (days > carrierDaysOverdue[carrier].longest) carrierDaysOverdue[carrier].longest = days;
        }
      }
    });

    return {
      byCarrier: Object.entries(carrierMissed).map(([label, value]) => ({ label, value })),
      byCustomer: Object.entries(customerMissed).map(([label, value]) => ({ label, value })),
      monthly: Object.entries(monthlyMissed).map(([label, value]) => ({ label, value })),
      avgOverdue: Object.entries(carrierDaysOverdue).map(([label, v]) => ({ label, avg: Math.round(v.total / v.count * 10) / 10, longest: Math.round(v.longest * 10) / 10, total: v.count })),
    };
  }, [appointments, statusMap, tick]);

  const handleCarrierDrill = useCallback((carrier: string) => {
    setDrillCarrier(prev => prev === carrier ? "" : carrier);
  }, []);

  return (
    <>
      <h1>Missed Appointment Dashboard</h1>
      <p className="muted">Carrier performance visibility, reporting, and historical trend analysis for Cesanek LT_F21.</p>

      {/* KPI Cards */}
      <section className="stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        <div>Total Missed<br /><b className="bad">{kpis.missed}</b></div>
        <div>Missed %<br /><b className="bad">{kpis.missedPct}%</b></div>
        <div>Late Arrivals<br /><b className="warn">{kpis.late}</b></div>
        <div>On-Time %<br /><b className="good">{kpis.onTimePct}%</b></div>
        <div>Worst Carrier<br /><b style={{ fontSize: 13 }}>{kpis.worstCarrier}</b></div>
        <div>Most Impacted<br /><b style={{ fontSize: 13 }}>{kpis.mostImpacted}</b></div>
      </section>

      {/* Charts — shown first for immediate analytics visibility */}
      <h2 style={{ marginTop: 18, fontSize: 18, fontWeight: 800 }}>Historical Carrier Performance Analytics</h2>

      {/* Active filter chip */}
      {drillCarrier && (
        <div style={{ margin: "8px 0", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "#9aa8c7" }}>Filtered by:</span>
          <button onClick={() => setDrillCarrier("")} style={{ fontSize: 12, padding: "4px 12px", borderRadius: 20, background: "#1e1b4b", color: "#a99cff", border: "1px solid #5539f6", cursor: "pointer", fontWeight: 600 }}>
            {drillCarrier} ✕
          </button>
        </div>
      )}

      <div className="charts-grid-exec">
        <CarrierBarChart data={chartData.byCarrier} title="Missed Appointments by Carrier (Historical)" totalMissed={kpis.missed} onBarClick={handleCarrierDrill} />
        <TrendChart data={chartData.monthly} title="Monthly Missed Appointment Trend" />
        <CustomerBarChart data={chartData.byCustomer} title="Missed Appointments by Customer" totalMissed={kpis.missed} onBarClick={(cust) => setCustomerFilter(cust)} />
        <DonutChart
          title="Appointment Status Distribution"
          data={[
            { label: "Missed", value: kpis.missed, color: C.red },
            { label: "Late", value: kpis.late, color: C.yellow },
            { label: "On Time", value: kpis.onTime, color: C.green },
          ]}
        />
        <OverdueChart data={chartData.avgOverdue} onBarClick={handleCarrierDrill} />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 24, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Appointment Details</h2>
        <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 999, border: "1px solid #2f4368", color: "#9fb3d9", background: "#111c30" }}>Excludes closed orders</span>
      </div>
      <p style={{ margin: "6px 0 10px", fontSize: 11, color: "#8899b4" }}>Missed = scheduled time passed by more than 1 hour, appointment not completed/arrived/cancelled, and order/load still open.</p>
      <div style={{ display: "flex", gap: 8, margin: "10px 0 10px", flexWrap: "wrap", alignItems: "center" }}>
        <input type="text" placeholder="Customer" value={customerFilter} onChange={e => setCustomerFilter(e.target.value)} className="filter-input" />
        <input type="text" placeholder="Carrier" value={carrierFilter} onChange={e => setCarrierFilter(e.target.value)} className="filter-input" />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as typeof typeFilter)} className="filter-select">
          <option value="">All Types</option>
          <option value="INBOUND">Inbound</option>
          <option value="OUTBOUND">Outbound</option>
        </select>
        <select value={statusFilterVal} onChange={e => setStatusFilterVal(e.target.value as typeof statusFilterVal)} className="filter-select">
          <option value="">All Statuses</option>
          <option value="missed">Missed</option>
          <option value="late">Late</option>
          <option value="ontime">On Time</option>
        </select>
        <input type="text" placeholder="RN #" value={rnFilter} onChange={e => setRnFilter(e.target.value)} className="filter-input" style={{ width: 100 }} />
        <input type="text" placeholder="DN #" value={dnFilter} onChange={e => setDnFilter(e.target.value)} className="filter-input" style={{ width: 100 }} />
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="filter-input" style={{ width: 130 }} title="From date" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="filter-input" style={{ width: 130 }} title="To date" />
        {drillCarrier && (
          <button onClick={() => setDrillCarrier("")} style={{ fontSize: 11, padding: "5px 10px", borderRadius: 6, background: "#5539f6", color: "#fff", border: 0, cursor: "pointer" }}>
            ✕ {drillCarrier}
          </button>
        )}
      </div>

      {error && <div className="notice" style={{ borderColor: stale ? "#fb7185" : undefined }}>{error}</div>}
      {stale && lastUpdated && <p style={{ fontSize: 10, color: "#fb7185", margin: "4px 0" }}>Data may be stale. Last successful update: {lastUpdated}</p>}
      <div className="actions">
        <button onClick={load} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</button>
        <button onClick={() => exportCSV(sorted, statusMap)} disabled={sorted.length === 0}>Export CSV</button>
        <button onClick={exportPrint}>Print / PDF</button>
        {lastUpdated && <span style={{ fontSize: 10, color: "#64748b", marginLeft: 8 }}>Last Updated: {lastUpdated}</span>}
        <span style={{ fontSize: 10, color: "#4ade80", marginLeft: 4 }}>● Live (45s)</span>
      </div>

      {/* Table */}
      <div className="table">
        <table>
          <thead>
            <tr>
              <th style={{ width: 20 }}></th>
              <th style={{ cursor: "pointer" }} onClick={() => handleSort("customer")}>Customer <span style={{ opacity: sortCol === "customer" ? 1 : 0.3, fontSize: 9 }}>{sortInd("customer")}</span></th>
              <th style={{ cursor: "pointer" }} onClick={() => handleSort("rn")}>RN <span style={{ opacity: sortCol === "rn" ? 1 : 0.3, fontSize: 9 }}>{sortInd("rn")}</span></th>
              <th style={{ cursor: "pointer" }} onClick={() => handleSort("dn")}>DN <span style={{ opacity: sortCol === "dn" ? 1 : 0.3, fontSize: 9 }}>{sortInd("dn")}</span></th>
              <th style={{ cursor: "pointer" }} onClick={() => handleSort("type")}>Appt Type <span style={{ opacity: sortCol === "type" ? 1 : 0.3, fontSize: 9 }}>{sortInd("type")}</span></th>
              <th style={{ cursor: "pointer" }} onClick={() => handleSort("carrier")}>Carrier <span style={{ opacity: sortCol === "carrier" ? 1 : 0.3, fontSize: 9 }}>{sortInd("carrier")}</span></th>
              <th style={{ cursor: "pointer" }} onClick={() => handleSort("scheduled")}>Scheduled Date <span style={{ opacity: sortCol === "scheduled" ? 1 : 0.3, fontSize: 9 }}>{sortInd("scheduled")}</span></th>
              <th style={{ cursor: "pointer" }} onClick={() => handleSort("timeSince")}>Time Since Missed <span style={{ opacity: sortCol === "timeSince" ? 1 : 0.3, fontSize: 9 }}>{sortInd("timeSince")}</span></th>
              <th style={{ cursor: "pointer" }} onClick={() => handleSort("status")}>Status <span style={{ opacity: sortCol === "status" ? 1 : 0.3, fontSize: 9 }}>{sortInd("status")}</span></th>
            </tr>
          </thead>
          <tbody>
            {!loading && sorted.length === 0 && !error && (
              <tr><td colSpan={9} style={{ textAlign: "center", padding: 40, color: "#64748b" }}>No appointments match the current filters.</td></tr>
            )}
            {sorted.map(a => {
              const status = statusMap.get(a.id) || getApptStatus(a);
              const ts = a.appointmentTime && status.label === "Missed Appointment" ? timeSince(a.appointmentTime) : null;
              return (
                <tr key={a.id} style={{ cursor: "pointer" }} onClick={() => { setSelectedAppt(a); setPanelActivity(getShipmentActivity(a.id)); }}>
                  <td style={{ textAlign: "center", color: "#5539f6", fontSize: 12 }}>▶</td>
                  <td>{getCustomerName(a)}</td>
                  <td>{getRN(a)}</td>
                  <td>{getDN(a)}</td>
                  <td>{a.appointmentType || "—"}</td>
                  <td>{a.carrierName || a.carrierId || "—"}</td>
                  <td>{fmt(a.appointmentTime)}</td>
                  <td className={status.label === "Missed Appointment" ? "bad" : ""}>{ts ? ts.label : "—"}</td>
                  <td><span className={`status-badge ${status.cls}`}>{status.badge} {status.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Appointment Detail Panel */}
      {selectedAppt && (
        <div className="detail-overlay" onClick={() => setSelectedAppt(null)}>
          <aside className="detail-panel" onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #26344f", paddingBottom: 10, marginBottom: 12 }}>
              <div><p style={{ fontSize: 10, color: "#8899b4", margin: 0 }}>APPOINTMENT DETAIL</p><h2 style={{ fontSize: 16, margin: "2px 0 0", color: "#eaf0ff" }}>{selectedAppt.sid || selectedAppt.id}</h2></div>
              <button onClick={() => setSelectedAppt(null)} style={{ background: "#26344f", border: 0, color: "#9aa8c7", borderRadius: 6, width: 28, height: 28, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: "#cdd6f4", display: "grid", gap: 3 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8899b4" }}>Customer</span><span>{getCustomerName(selectedAppt)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8899b4" }}>RN</span><span>{getRN(selectedAppt)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8899b4" }}>DN</span><span>{getDN(selectedAppt)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8899b4" }}>Appointment Type</span><span>{selectedAppt.appointmentType || "—"}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8899b4" }}>Carrier</span><span>{selectedAppt.carrierName || selectedAppt.carrierId || "—"}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8899b4" }}>Scheduled</span><span>{fmt(selectedAppt.appointmentTime)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8899b4" }}>Status</span><span className={(statusMap.get(selectedAppt.id) || getApptStatus(selectedAppt)).cls} style={{ fontWeight: 600 }}>{(statusMap.get(selectedAppt.id) || getApptStatus(selectedAppt)).badge} {(statusMap.get(selectedAppt.id) || getApptStatus(selectedAppt)).label}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8899b4" }}>Check-In Time</span><span>{selectedAppt.startTime ? fmt(selectedAppt.startTime) : "—"}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#8899b4" }}>WMS Status</span><span>{selectedAppt.apptStatus || "—"}</span></div>
            </div>

            {/* Actions */}
            <div style={{ borderTop: "1px solid #26344f", marginTop: 12, paddingTop: 10 }}>
              <p style={{ fontSize: 10, color: "#8899b4", margin: "0 0 6px", textTransform: "uppercase" }}>Actions</p>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                <button onClick={() => markApptAction(selectedAppt, "In Progress")} className="panel-btn">In Progress</button>
                <button onClick={() => markApptAction(selectedAppt, "Missed Appointment")} className="panel-btn" style={{ borderColor: "#7f1d1d", color: "#fca5a5" }}>Mark Missed</button>
                <button onClick={() => markApptAction(selectedAppt, "Late")} className="panel-btn" style={{ borderColor: "#713f12", color: "#fde68a" }}>Mark Late</button>
                <button onClick={() => markApptAction(selectedAppt, "Completed")} className="panel-btn" style={{ borderColor: "#052e16", color: "#4ade80" }}>Completed</button>
                <button onClick={() => markApptAction(selectedAppt, "Rescheduled")} className="panel-btn">Rescheduled</button>
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
                <button onClick={() => { const st = (statusMap.get(selectedAppt.id) || getApptStatus(selectedAppt)).label; const tmpl = st === "Missed Appointment" ? "missed" : st === "Late" ? "late" : "rescheduled"; sendTestNotification(selectedAppt, tmpl); setPanelActivity(getShipmentActivity(selectedAppt.id)); }} className="panel-btn primary">Send Customer Notification</button>
                <button onClick={() => { sendTestNotification(selectedAppt, "late"); setPanelActivity(getShipmentActivity(selectedAppt.id)); }} className="panel-btn">Notify Carrier</button>
              </div>
              <p style={{ fontSize: 9, color: "#64748b", marginTop: 6 }}>Test Mode — notifications route to {TEST_RECIPIENT} only.</p>
            </div>

            {/* Activity History */}
            <div style={{ borderTop: "1px solid #26344f", marginTop: 12, paddingTop: 10 }}>
              <p style={{ fontSize: 10, color: "#8899b4", margin: "0 0 6px", textTransform: "uppercase" }}>Activity History</p>
              {panelActivity.length === 0 && <p style={{ fontSize: 11, color: "#64748b" }}>No activity recorded for this appointment.</p>}
              <div style={{ maxHeight: 200, overflowY: "auto" }}>
                {panelActivity.map(e => (
                  <div key={e.id} style={{ borderBottom: "1px solid #1e2d47", padding: "6px 0", fontSize: 11 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", color: "#9aa8c7" }}>
                      <span>{e.user}</span>
                      <span>{new Date(e.timestamp).toLocaleString("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                    </div>
                    <p style={{ margin: "2px 0", color: "#eaf0ff" }}>{e.action}</p>
                    {e.emailSent !== "no" && <p style={{ margin: 0, fontSize: 10, color: "#facc15" }}>Email: {e.emailSent} → {e.recipient}</p>}
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
