'use client';

import { SyncMetrics } from "../lib/sync-metrics";
import { ExceptionItem } from "../lib/exception-queue";
import { PendingTicket } from "../lib/ticket-service";
import { Transaction } from "../lib/transaction-service";

interface SyncPanelProps {
  syncMetrics: SyncMetrics | null;
  exceptions: ExceptionItem[];
  pendingTickets: PendingTicket[];
  recentTransactions: Transaction[];
  onClose: () => void;
}

export default function SyncPanel({ syncMetrics, exceptions, pendingTickets, recentTransactions, onClose }: SyncPanelProps) {
  return (
    <div className="fixed top-0 right-0 h-full w-[420px] z-50 border-l border-border bg-surface-alt overflow-y-auto scrollbar-thin shadow-2xl">
      <div className="sticky top-0 z-10 bg-surface-alt border-b border-border px-5 py-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-foreground">Synchronization Panel</h2>
        <button onClick={onClose} className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-foreground hover:bg-surface-hover">Close</button>
      </div>

      <div className="p-5 space-y-5">
        <Section title="WMS Connection">
          {syncMetrics ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <Stat label="Status" value={syncMetrics.connectionState} highlight={syncMetrics.connectionState === "Connected" ? "success" : "danger"} />
              <Stat label="Last Sync" value={syncMetrics.lastSuccessfulSync ? formatDT(syncMetrics.lastSuccessfulSync) : "—"} />
              <Stat label="Next Sync" value={syncMetrics.nextScheduledSync ? formatDT(syncMetrics.nextScheduledSync) : "Auto (10m)"} />
              <Stat label="Avg Response" value={`${syncMetrics.avgResponseTimeMs}ms`} />
              <Stat label="API Calls (Session)" value={String(syncMetrics.totalApiCallsSession)} />
              <Stat label="Successful" value={String(syncMetrics.successfulUpdates)} highlight="success" />
              <Stat label="Failed" value={String(syncMetrics.failedUpdates)} highlight={syncMetrics.failedUpdates > 0 ? "danger" : undefined} />
              <Stat label="Pending Txns" value={String(syncMetrics.pendingTransactions)} />
              <Stat label="Queue Depth" value={String(syncMetrics.queueDepth)} />
              <Stat label="Consecutive Failures" value={String(syncMetrics.consecutiveFailures)} highlight={syncMetrics.consecutiveFailures > 0 ? "warning" : undefined} />
            </div>
          ) : (
            <p className="text-xs text-muted">No sync data available yet</p>
          )}
        </Section>

        <Section title="Recent Transactions">
          {recentTransactions.length === 0 ? (
            <p className="text-xs text-muted">No transactions recorded this session</p>
          ) : (
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto scrollbar-thin">
              {recentTransactions.slice(0, 10).map(txn => (
                <div key={txn.id} className="flex items-center justify-between rounded-md border border-border px-3 py-1.5 text-[11px]">
                  <div>
                    <span className="text-foreground">{txn.apiAction}</span>
                    <span className="ml-1.5 text-muted">{txn.orderId}</span>
                  </div>
                  <TxnBadge status={txn.status} />
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Exception Queue">
          {exceptions.length === 0 ? (
            <p className="text-xs text-muted">No exceptions</p>
          ) : (
            <div className="space-y-1.5 max-h-[180px] overflow-y-auto scrollbar-thin">
              {exceptions.map(ex => (
                <div key={ex.id} className="rounded-md border border-border px-3 py-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-foreground">{ex.orderId}</span>
                    <ExceptionBadge status={ex.status} />
                  </div>
                  <p className="text-[10px] text-muted mt-0.5">{ex.description}</p>
                  <p className="text-[10px] text-muted">Retries: {ex.retryCount}/{ex.maxRetries}</p>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Pending Tickets">
          {pendingTickets.length === 0 ? (
            <p className="text-xs text-muted">No pending ticket events</p>
          ) : (
            <div className="space-y-1.5 max-h-[180px] overflow-y-auto scrollbar-thin">
              {pendingTickets.map(t => (
                <div key={t.id} className="rounded-md border border-border px-3 py-2 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground capitalize">{t.event.replace(/_/g, " ")}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${t.status === "pending_integration" ? "bg-warning-dim text-warning" : "bg-info-dim text-info"}`}>
                      {t.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted">{t.orderId} · {t.payload.carrier || "—"}</p>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Integration Status">
          <div className="space-y-1.5">
            <IntegrationRow label="WMS Read (Orders/Loads)" status="live" />
            <IntegrationRow label="WMS Mutations (Appointments)" status="pending" detail="Endpoint verification required" />
            <IntegrationRow label="Ticketing (Create/Update)" status="pending" detail="Ticket-ops API integration pending" />
            <IntegrationRow label="Notifications (Email)" status="queued" detail="Test mode — SMTP not configured" />
            <IntegrationRow label="Audit Logging" status="live" detail="Session-scoped" />
          </div>
        </Section>

        <div className="text-[10px] text-muted border-t border-border pt-3">
          WMS is the system of record. Dashboard reflects WMS-confirmed data only. Actions requiring WMS mutations are disabled until endpoint verification is complete.
        </div>
      </div>
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

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: "success" | "danger" | "warning" }) {
  const colorClass = highlight === "success" ? "text-success" : highlight === "danger" ? "text-danger" : highlight === "warning" ? "text-warning" : "text-foreground";
  return (
    <div>
      <span className="text-[10px] text-muted block">{label}</span>
      <span className={`text-xs font-medium ${colorClass}`}>{value}</span>
    </div>
  );
}

function TxnBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Confirmed: "bg-success-dim text-success",
    Failed: "bg-danger-dim text-danger",
    Pending: "bg-warning-dim text-warning",
    Executing: "bg-info-dim text-info",
    TimedOut: "bg-danger-dim text-danger",
    Queued: "bg-purple-dim text-purple",
  };
  return <span className={`text-[9px] px-1.5 py-0.5 rounded ${colors[status] || "bg-muted/20 text-muted"}`}>{status}</span>;
}

function ExceptionBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: "bg-danger-dim text-danger",
    retrying: "bg-warning-dim text-warning",
    escalated: "bg-purple-dim text-purple",
    resolved: "bg-success-dim text-success",
  };
  return <span className={`text-[9px] px-1.5 py-0.5 rounded capitalize ${colors[status] || "bg-muted/20 text-muted"}`}>{status}</span>;
}

function IntegrationRow({ label, status, detail }: { label: string; status: "live" | "pending" | "queued"; detail?: string }) {
  const dotClass = status === "live" ? "bg-success" : status === "pending" ? "bg-warning" : "bg-info";
  const statusLabel = status === "live" ? "Active" : status === "pending" ? "Pending" : "Queued";
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotClass}`} />
        <span className="text-xs text-foreground">{label}</span>
      </div>
      <div className="text-right">
        <span className="text-[10px] text-muted-light">{statusLabel}</span>
        {detail && <span className="block text-[9px] text-muted">{detail}</span>}
      </div>
    </div>
  );
}

function formatDT(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}
