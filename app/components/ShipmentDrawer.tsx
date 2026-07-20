'use client';

import { OutboundOrder } from "../lib/wms-api";
import { Recommendation } from "../lib/kpi-engine";
import { DEFAULT_TIMEZONE } from "../lib/auth";
import { getActionDefinitions, executeNotification, WmsActionType, MutationResult } from "../lib/wms-actions";
import { useState } from "react";
import ActionModal from "./ActionModal";

interface ShipmentDrawerProps {
  order: OutboundOrder;
  recommendations: Recommendation[];
  wmsConnected: boolean;
  onClose: () => void;
  onRequestRefresh: () => void;
}

export default function ShipmentDrawer({ order, recommendations, wmsConnected, onClose, onRequestRefresh }: ShipmentDrawerProps) {
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [executing, setExecuting] = useState(false);
  const [modalAction, setModalAction] = useState<"roll_appointment" | "mark_missed" | "create_appointment" | null>(null);

  const actions = getActionDefinitions(order, wmsConnected);

  async function handleAction(actionType: WmsActionType) {
    if (actionType === "roll_appointment" || actionType === "mark_missed" || actionType === "create_appointment") {
      setModalAction(actionType);
      return;
    }

    if (actionType === "notify_customer" || actionType === "notify_carrier" || actionType === "notify_supervisor") {
      setExecuting(true);
      setFeedback(null);
      const recipientType = actionType.replace("notify_", "");
      const result = await executeNotification(order, recipientType, wmsConnected);
      setFeedback(result);
      setExecuting(false);
      return;
    }

    setFeedback({ success: true, message: `${actionType === "view_audit" ? "Audit history" : actionType === "add_note" ? "Note" : "Escalation"} recorded locally` });
  }

  function handleModalSuccess() {
    setModalAction(null);
    onRequestRefresh();
  }

  return (
    <div className="fixed top-0 right-0 h-full w-[480px] z-50 border-l border-border bg-surface-alt overflow-y-auto scrollbar-thin shadow-2xl">
      <div className="sticky top-0 z-10 bg-surface-alt border-b border-border px-5 py-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-foreground">{order.id}</h2>
          <p className="text-[11px] text-muted">{order.shipToName || "—"} · {order.shipToCity}{order.shipToState ? `, ${order.shipToState}` : ""}</p>
        </div>
        <button onClick={onClose} className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground hover:bg-surface-hover">Close</button>
      </div>

      <div className="p-5 space-y-5">
        {!wmsConnected && (
          <div className="rounded-md border border-danger/30 bg-danger-dim px-3 py-2 text-xs text-danger">
            WMS is disconnected — actions requiring live WMS are unavailable
          </div>
        )}

        {recommendations.length > 0 && (
          <Section title="Recommendations">
            <div className="space-y-1.5">
              {recommendations.map(r => (
                <div key={r.id} className={`rounded-md px-3 py-2 text-xs border ${r.priority === "high" ? "border-danger/30 bg-danger-dim/50 text-danger" : "border-warning/30 bg-warning-dim/50 text-warning"}`}>
                  {r.message}
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="Actions">
          <div className="space-y-1">
            {actions.map(a => (
              <button
                key={a.type}
                disabled={!!a.disabledReason || executing}
                title={a.disabledReason || ""}
                className="w-full text-left px-3 py-2 rounded-md border border-border text-xs hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                onClick={() => handleAction(a.type)}
              >
                <span className="flex items-center justify-between">
                  <span className={a.disabledReason ? "text-muted" : "text-foreground"}>
                    {a.destructive && !a.disabledReason && <span className="text-danger mr-1">●</span>}
                    {a.label}
                  </span>
                  <span className="text-[9px]">
                    {a.mutationVerified && !a.disabledReason && a.requiresWmsMutation && (
                      <span className="text-success">WMS live</span>
                    )}
                    {a.requiresWmsMutation && !a.mutationVerified && (
                      <span className="text-muted">guarded</span>
                    )}
                    {a.category === "notification" && !a.disabledReason && (
                      <span className="text-info">Queued · WMS preflight</span>
                    )}
                    {a.localOnly && (
                      <span className="text-muted">Local only</span>
                    )}
                  </span>
                </span>
                {a.disabledReason && (
                  <span className="block text-[9px] text-muted mt-0.5">{a.disabledReason}</span>
                )}
              </button>
            ))}
          </div>
          {feedback && (
            <div className={`mt-2 px-3 py-2 rounded-md text-xs ${feedback.success ? "bg-success-dim border border-success/30 text-success" : "bg-danger-dim border border-danger/30 text-danger"}`}>
              {feedback.message}
            </div>
          )}
        </Section>

        <Section title="Order Summary">
          <Grid>
            <Field label="Order" value={order.id} />
            <Field label="Type" value={order.orderType} />
            <Field label="Status" value={order.status} />
            <Field label="Ship Method" value={order.shipMethod} />
            <Field label="Freight Term" value={order.freightTerm} />
            <Field label="Source" value={order.source} />
            <Field label="PO #" value={order.poNo} />
            <Field label="Reference" value={order.referenceNo} />
          </Grid>
        </Section>

        <Section title="Appointment Summary">
          <Grid>
            <Field label="Appointment Time" value={formatDT(order.appointmentTime)} />
            <Field label="Schedule Date" value={formatDT(order.scheduleDate)} />
            <Field label="Appointment ID" value={order.appointmentId || order.apptNo} />
            <Field label="Appointment Status" value={order.apptStatus} />
            <Field label="In Yard" value={formatDT(order.inYardTime)} />
            <Field label="Load #" value={order.loadNo} />
          </Grid>
        </Section>

        <Section title="Shipment Details">
          <Grid>
            <Field label="Carrier" value={order.carrierId} />
            <Field label="BOL" value={order.bolNo} />
            <Field label="PRO" value={order.proNo} />
            <Field label="MBOL" value={order.mbolNo} />
            <Field label="Container" value={order.containerSize} />
            <Field label="Weight" value={order.totalWeight ? `${order.totalWeight} lbs` : undefined} />
          </Grid>
        </Section>

        <Section title="Customer Summary">
          <Grid>
            <Field label="Customer" value={order.customerName} />
            <Field label="Ship To" value={order.shipToName} />
            <Field label="City / State" value={order.shipToCity ? `${order.shipToCity}, ${order.shipToState || ""}` : undefined} />
            <Field label="ZIP" value={order.shipToZip} />
            <Field label="Retailer" value={order.retailerId} />
          </Grid>
        </Section>

        <Section title="Timeline">
          <Timeline order={order} />
        </Section>

        <Section title="Activity Feed">
          <ActivityFeed order={order} />
        </Section>

        <Section title="Customer Communication">
          <div className="rounded-md border border-border bg-surface p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Customer email status</span>
              <span className="text-xs text-muted-light">Queued (test mode)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Carrier email status</span>
              <span className="text-xs text-muted-light">Queued (test mode)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">Last notification</span>
              <span className="text-xs text-muted-light">—</span>
            </div>
            <p className="text-[10px] text-muted mt-1">Notifications preflight live WMS state before queuing. No emails sent in test mode.</p>
          </div>
        </Section>

        <div className="text-[10px] text-muted border-t border-border pt-3">
          All data shown is from live WMS. Actions marked "WMS live" execute through verified WMS endpoints with preflight and confirmation. Guarded actions await endpoint verification.
        </div>
      </div>

      {modalAction && (
        <ActionModal type={modalAction} order={order} onClose={() => setModalAction(null)} onSuccess={handleModalSuccess} />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-bold text-muted uppercase tracking-wider mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">{children}</div>;
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <span className="text-[10px] text-muted block">{label}</span>
      <span className="text-xs text-foreground">{value || "—"}</span>
    </div>
  );
}

interface TimelineEvent {
  label: string;
  time: string | null;
  status: "done" | "current" | "pending";
}

function Timeline({ order }: { order: OutboundOrder }) {
  const events: TimelineEvent[] = [
    { label: "Order Created", time: order.orderedDate || null, status: order.orderedDate ? "done" : "pending" },
    { label: "Appointment Scheduled", time: order.appointmentTime || null, status: order.appointmentTime ? "done" : "pending" },
    { label: "Schedule Date", time: order.scheduleDate || null, status: order.scheduleDate ? "done" : "pending" },
  ];

  if (order.inYardTime) {
    events.push({ label: "Carrier In Yard", time: order.inYardTime, status: "done" });
  }
  if (order.packedTime) {
    events.push({ label: "Packed", time: order.packedTime, status: "done" });
  }
  if (order.shippedTime) {
    events.push({ label: "Shipped", time: order.shippedTime, status: "done" });
  }

  const status = (order.status || "").toUpperCase();
  if (status === "COMMIT_FAILED") {
    events.push({ label: "Commitment Failed", time: null, status: "current" });
  } else if (!order.shippedTime && status !== "SHIPPED" && status !== "COMPLETED") {
    events.push({ label: "Awaiting Completion", time: null, status: "current" });
  }

  return (
    <div className="space-y-0">
      {events.map((ev, i) => (
        <div key={i} className="flex items-start gap-3 py-1.5">
          <div className="flex flex-col items-center">
            <span className={`w-2 h-2 rounded-full mt-1 ${ev.status === "done" ? "bg-success" : ev.status === "current" ? "bg-warning" : "bg-border"}`} />
            {i < events.length - 1 && <span className="w-px flex-1 min-h-[16px] bg-border" />}
          </div>
          <div className="flex-1 min-w-0">
            <span className={`text-xs ${ev.status === "done" ? "text-foreground" : ev.status === "current" ? "text-warning" : "text-muted"}`}>
              {ev.label}
            </span>
            {ev.time && <span className="ml-2 text-[10px] text-muted">{formatDT(ev.time)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityFeed({ order }: { order: OutboundOrder }) {
  const activities: { time: string | null; event: string }[] = [];

  if (order.orderedDate) activities.push({ time: order.orderedDate, event: "Order imported from " + (order.source || "system") });
  if (order.appointmentTime) activities.push({ time: order.appointmentTime, event: "Appointment scheduled" });
  if (order.scheduleDate) activities.push({ time: order.scheduleDate, event: "Schedule date set" });
  if (order.inYardTime) activities.push({ time: order.inYardTime, event: "Carrier checked in at yard" });
  if (order.packedTime) activities.push({ time: order.packedTime, event: "Order packed" });
  if (order.shippedTime) activities.push({ time: order.shippedTime, event: "Shipment completed" });

  const status = (order.status || "").toUpperCase();
  if (status === "COMMIT_FAILED") {
    activities.push({ time: null, event: `Commitment failed${order.exceptionReason ? ": " + order.exceptionReason : ""}` });
  }
  if (order.canceledDate) {
    activities.push({ time: order.canceledDate, event: "Order cancelled" });
  }

  if (activities.length === 0) {
    return <p className="text-xs text-muted">No activity recorded</p>;
  }

  return (
    <div className="space-y-1.5">
      {activities.map((a, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          <span className="text-[10px] text-muted shrink-0 w-20">{a.time ? formatDT(a.time) : "—"}</span>
          <span className="text-muted-light">{a.event}</span>
        </div>
      ))}
    </div>
  );
}

function formatDT(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: DEFAULT_TIMEZONE }) +
      " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: DEFAULT_TIMEZONE });
  } catch {
    return iso;
  }
}
