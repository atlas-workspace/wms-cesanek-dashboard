'use client';

import { OutboundOrder } from "../lib/wms-api";
import { Recommendation } from "../lib/kpi-engine";
import { DensityMode } from "../lib/preferences";
import { useState } from "react";
import { DEFAULT_TIMEZONE } from "../lib/auth";
import { getActionDefinitions, executeNotification, WmsActionType, MutationResult } from "../lib/wms-actions";
import ActionModal from "./ActionModal";

interface OrderTableProps {
  orders: OutboundOrder[];
  loading: boolean;
  density: DensityMode;
  onOrderClick: (order: OutboundOrder) => void;
  recommendations: Recommendation[];
  wmsConnected: boolean;
  onRequestRefresh: () => void;
}

export default function OrderTable({ orders, loading, density, onOrderClick, recommendations, wmsConnected, onRequestRefresh }: OrderTableProps) {
  const [sortCol, setSortCol] = useState<string>("appointmentTime");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [actionsOpen, setActionsOpen] = useState<string | null>(null);
  const [modalAction, setModalAction] = useState<{ type: "roll_appointment" | "mark_missed" | "create_appointment"; order: OutboundOrder } | null>(null);

  const pyClass = density === "compact" ? "py-1.5" : density === "comfortable" ? "py-3.5" : "py-2.5";
  const textClass = density === "compact" ? "text-[11px]" : "text-xs";

  function handleSort(col: string) {
    if (sortCol === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  const sorted = [...orders].sort((a, b) => {
    const av = String((a as unknown as Record<string, unknown>)[sortCol] ?? "");
    const bv = String((b as unknown as Record<string, unknown>)[sortCol] ?? "");
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const hasRec = (id: string) => recommendations.some(r => r.orderId === id);

  function handleModalSuccess() {
    setModalAction(null);
    onRequestRefresh();
  }

  return (
    <>
      <div className="px-4 pb-2">
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin max-h-[520px] overflow-y-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 z-10 bg-surface border-b border-border">
                <tr className={textClass}>
                  {columns.map(col => (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={`${pyClass} px-3 font-medium text-muted uppercase tracking-wider cursor-pointer hover:text-foreground select-none whitespace-nowrap ${col.sticky ? "sticky left-0 z-20 bg-surface" : ""}`}
                    >
                      {col.label} {sortCol === col.key ? (sortDir === "asc" ? "↑" : "↓") : ""}
                    </th>
                  ))}
                  <th className={`${pyClass} px-3 font-medium text-muted uppercase tracking-wider`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && orders.length === 0 && (
                  <tr><td colSpan={columns.length + 1} className="px-4 py-12 text-center text-muted text-sm">Loading appointments...</td></tr>
                )}
                {!loading && orders.length === 0 && (
                  <tr><td colSpan={columns.length + 1} className="px-4 py-12 text-center text-muted text-sm">No orders match current filters</td></tr>
                )}
                {sorted.map((order, idx) => {
                  const isOverdue = order.appointmentTime && new Date(order.appointmentTime).getTime() < Date.now() && !["SHIPPED", "COMPLETED", "CANCELLED", "LOADED"].includes((order.status || "").toUpperCase());
                  const rowBg = isOverdue ? "bg-danger-dim/30" : idx % 2 === 0 ? "bg-transparent" : "bg-surface-alt/50";

                  return (
                    <tr
                      key={order.id}
                      className={`${rowBg} border-b border-border/50 hover:bg-surface-hover/60 cursor-pointer transition-colors ${textClass}`}
                      onClick={() => onOrderClick(order)}
                    >
                      <td className={`${pyClass} px-3 font-mono sticky left-0 z-10 ${isOverdue ? "bg-danger-dim/30" : idx % 2 === 0 ? "bg-background" : "bg-surface-alt"}`}>
                        <span className="flex items-center gap-1">
                          {hasRec(order.id) && <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" title="Has recommendation" />}
                          {order.id}
                        </span>
                      </td>
                      <td className={`${pyClass} px-3`}><StatusBadge status={order.status} /></td>
                      <td className={`${pyClass} px-3 text-muted-light whitespace-nowrap`}>{formatApptTime(order.appointmentTime)}</td>
                      <td className={`${pyClass} px-3 truncate max-w-[160px]`} title={order.shipToName}>{order.shipToName || "—"}</td>
                      <td className={`${pyClass} px-3 text-muted-light`}>{order.carrierId || "—"}</td>
                      <td className={`${pyClass} px-3 font-mono text-muted`}>{order.loadNo || "—"}</td>
                      <td className={`${pyClass} px-3 font-mono text-muted`}>{order.referenceNo || "—"}</td>
                      <td className={`${pyClass} px-3`}>
                        <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-muted-light">{order.shipMethod || "—"}</span>
                      </td>
                      <td className={`${pyClass} px-3`} onClick={e => e.stopPropagation()}>
                        <div className="relative">
                          <button
                            onClick={() => setActionsOpen(actionsOpen === order.id ? null : order.id)}
                            className="rounded border border-border px-2 py-0.5 text-[10px] text-muted hover:text-foreground hover:bg-surface-hover"
                          >
                            Actions ▾
                          </button>
                          {actionsOpen === order.id && (
                            <ActionsDropdown
                              order={order}
                              wmsConnected={wmsConnected}
                              onClose={() => setActionsOpen(null)}
                              onOpenModal={(type) => { setActionsOpen(null); setModalAction({ type, order }); }}
                              onRequestRefresh={onRequestRefresh}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {modalAction && (
        <ActionModal
          type={modalAction.type}
          order={modalAction.order}
          onClose={() => setModalAction(null)}
          onSuccess={handleModalSuccess}
        />
      )}
    </>
  );
}

const columns = [
  { key: "id", label: "Order", sticky: true },
  { key: "status", label: "Status", sticky: false },
  { key: "appointmentTime", label: "Appointment", sticky: false },
  { key: "shipToName", label: "Ship To", sticky: false },
  { key: "carrierId", label: "Carrier", sticky: false },
  { key: "loadNo", label: "Load #", sticky: false },
  { key: "referenceNo", label: "Reference", sticky: false },
  { key: "shipMethod", label: "Ship", sticky: false },
];

function ActionsDropdown({ order, wmsConnected, onClose, onOpenModal, onRequestRefresh }: {
  order: OutboundOrder; wmsConnected: boolean; onClose: () => void;
  onOpenModal: (type: "roll_appointment" | "mark_missed" | "create_appointment") => void;
  onRequestRefresh: () => void;
}) {
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [executing, setExecuting] = useState(false);

  const actions = getActionDefinitions(order, wmsConnected);

  async function handleAction(actionType: WmsActionType) {
    if (actionType === "roll_appointment" || actionType === "mark_missed" || actionType === "create_appointment") {
      onOpenModal(actionType);
      return;
    }

    if (actionType === "notify_customer" || actionType === "notify_carrier" || actionType === "notify_supervisor") {
      setExecuting(true);
      const recipientType = actionType.replace("notify_", "");
      const result = await executeNotification(order, recipientType, wmsConnected);
      setFeedback(result);
      setExecuting(false);
      return;
    }

    if (actionType === "view_audit" || actionType === "add_note" || actionType === "escalate") {
      setFeedback({ success: true, message: `${actionType === "view_audit" ? "Audit history" : actionType === "add_note" ? "Note" : "Escalation"} recorded locally` });
      return;
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-border bg-surface shadow-xl py-1">
        {!wmsConnected && (
          <div className="px-3 py-1.5 text-[10px] text-danger border-b border-border mb-1">
            WMS disconnected — mutation actions disabled
          </div>
        )}

        {actions.map(a => (
          <button
            key={a.type}
            disabled={!!a.disabledReason || executing}
            title={a.disabledReason || ""}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => handleAction(a.type)}
          >
            <span className="flex items-center justify-between">
              <span className={a.disabledReason ? "text-muted" : "text-foreground"}>
                {a.destructive && !a.disabledReason && <span className="text-danger mr-1">●</span>}
                {a.label}
              </span>
              {a.mutationVerified && !a.disabledReason && a.requiresWmsMutation && (
                <span className="text-[9px] text-success">WMS live</span>
              )}
              {a.requiresWmsMutation && !a.mutationVerified && (
                <span className="text-[9px] text-muted">guarded</span>
              )}
              {a.category === "notification" && !a.disabledReason && (
                <span className="text-[9px] text-info">queued</span>
              )}
              {a.localOnly && (
                <span className="text-[9px] text-muted">local</span>
              )}
            </span>
            {a.disabledReason && (
              <span className="block text-[9px] text-muted mt-0.5">{a.disabledReason}</span>
            )}
          </button>
        ))}

        {feedback && (
          <div className={`mx-2 mt-1 px-2 py-1.5 rounded text-[10px] ${feedback.success ? "bg-success-dim text-success" : "bg-danger-dim text-danger"}`}>
            {feedback.message}
          </div>
        )}
      </div>
    </>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const s = (status || "").toUpperCase();
  let colorClass = "bg-muted/20 text-muted-light";
  let label = status || "—";

  if (s === "PLANNED") { colorClass = "bg-primary/15 text-primary"; label = "Scheduled"; }
  else if (s === "IMPORTED" || s === "CREATED") { colorClass = "bg-info/15 text-info"; label = "Imported"; }
  else if (s === "COMMIT_FAILED") { colorClass = "bg-danger/15 text-danger"; label = "Exception"; }
  else if (s === "PICKED" || s === "PACKED") { colorClass = "bg-warning/15 text-warning"; label = s.charAt(0) + s.slice(1).toLowerCase(); }
  else if (s === "LOADED") { colorClass = "bg-success/15 text-success"; label = "Loaded"; }
  else if (s === "SHIPPED" || s === "COMPLETED") { colorClass = "bg-success/15 text-success"; label = "Completed"; }
  else if (s === "CANCELLED") { colorClass = "bg-muted/20 text-muted"; label = "Cancelled"; }

  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${colorClass}`}>
      {label}
    </span>
  );
}

function formatApptTime(iso?: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: DEFAULT_TIMEZONE }) +
      " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: DEFAULT_TIMEZONE });
  } catch {
    return iso;
  }
}
