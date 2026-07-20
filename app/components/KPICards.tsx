'use client';

import { KPIData } from "../lib/kpi-engine";

interface KPICardsProps {
  kpis: KPIData;
  activeFilter: string | null;
  onFilterClick: (filter: string | null) => void;
}

export default function KPICards({ kpis, activeFilter, onFilterClick }: KPICardsProps) {
  const cards = [
    { key: "missed", label: "Missed Appts", value: kpis.missedAppointments, color: "danger" as const, filter: "missed" },
    { key: "awaiting", label: "Awaiting Rollover", value: kpis.awaitingRollover, color: "warning" as const, filter: "missed" },
    { key: "rolled", label: "Rolled Today", value: kpis.rolledToday, color: "purple" as const, filter: null },
    { key: "completed", label: "Completed Today", value: kpis.completedToday, color: "success" as const, filter: "completed" },
    { key: "exception", label: "Exception Queue", value: kpis.exceptionQueue, color: "danger" as const, filter: "exception" },
    { key: "avgProc", label: "Avg Processing", value: kpis.avgProcessingTime, color: "info" as const, filter: null },
    { key: "avgDays", label: "Avg Days Missed", value: kpis.avgDaysSinceMissed, color: "warning" as const, filter: null },
    { key: "rolledMulti", label: "Rolled >1x", value: kpis.rolledMoreThanOnce, color: "purple" as const, filter: null },
  ];

  return (
    <div className="px-4 pt-3">
      <div className="grid grid-cols-4 xl:grid-cols-8 gap-2">
        {cards.map(card => {
          const isActive = activeFilter === card.filter && card.filter !== null;
          const colorMap = {
            danger: "border-danger/40 bg-danger-dim",
            warning: "border-warning/40 bg-warning-dim",
            success: "border-success/40 bg-success-dim",
            info: "border-info/40 bg-info-dim",
            purple: "border-purple/40 bg-purple-dim",
          };
          const textMap = {
            danger: "text-danger",
            warning: "text-warning",
            success: "text-success",
            info: "text-info",
            purple: "text-purple",
          };

          return (
            <button
              key={card.key}
              onClick={() => card.filter ? onFilterClick(card.filter) : undefined}
              className={`rounded-lg border p-3 text-left transition-all ${colorMap[card.color]} ${isActive ? "ring-1 ring-primary scale-[1.02]" : ""} ${card.filter ? "cursor-pointer hover:scale-[1.01]" : "cursor-default"}`}
            >
              <p className="text-[10px] uppercase tracking-wider text-muted mb-1">{card.label}</p>
              <p className={`text-xl font-bold tabular-nums ${textMap[card.color]}`}>{card.value}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
