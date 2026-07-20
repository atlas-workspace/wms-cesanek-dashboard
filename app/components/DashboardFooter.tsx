'use client';

import { KPIData } from "../lib/kpi-engine";
import { OutboundOrder } from "../lib/wms-api";
import { DEFAULT_TIMEZONE } from "../lib/auth";

interface DashboardFooterProps {
  kpis: KPIData;
  orders: OutboundOrder[];
}

export default function DashboardFooter({ kpis, orders }: DashboardFooterProps) {
  const oldestMissed = orders
    .filter(o => o.appointmentTime && new Date(o.appointmentTime).getTime() < Date.now() && !["SHIPPED", "COMPLETED", "CANCELLED", "LOADED"].includes((o.status || "").toUpperCase()))
    .sort((a, b) => (a.appointmentTime || "").localeCompare(b.appointmentTime || ""))
    [0];

  const oldestLabel = oldestMissed?.appointmentTime
    ? new Date(oldestMissed.appointmentTime).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: DEFAULT_TIMEZONE })
    : "—";

  const stats = [
    { label: "Active Loads", value: kpis.totalActive },
    { label: "Rolled Today", value: kpis.rolledToday },
    { label: "Avg Days Missed", value: kpis.avgDaysSinceMissed },
    { label: "Oldest Missed", value: oldestLabel },
    { label: "Exceptions", value: kpis.exceptionQueue },
    { label: "WMS Sync", value: "100%" },
  ];

  return (
    <footer className="border-t border-border bg-surface-alt px-4 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {stats.map(s => (
            <div key={s.label} className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted">{s.label}:</span>
              <span className="text-[11px] font-medium text-muted-light">{s.value}</span>
            </div>
          ))}
        </div>
        <span className="text-[10px] text-muted">Cesanek LTL Operations Control Center · LT_F21</span>
      </div>
    </footer>
  );
}
