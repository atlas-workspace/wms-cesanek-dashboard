'use client';

import { useState } from "react";
import { OutboundOrder } from "../lib/wms-api";
import { preflightAppointment, executeRollAppointment, executeMarkMissed, executeCreateAppointment, MutationResult } from "../lib/wms-actions";
import { DEFAULT_TIMEZONE } from "../lib/auth";

interface ActionModalProps {
  type: "roll_appointment" | "mark_missed" | "create_appointment";
  order: OutboundOrder;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ActionModal({ type, order, onClose, onSuccess }: ActionModalProps) {
  if (type === "roll_appointment") return <RollModal order={order} onClose={onClose} onSuccess={onSuccess} />;
  if (type === "mark_missed") return <MarkMissedModal order={order} onClose={onClose} onSuccess={onSuccess} />;
  if (type === "create_appointment") return <CreateAppointmentModal order={order} onClose={onClose} onSuccess={onSuccess} />;
  return null;
}

function RollModal({ order, onClose, onSuccess }: { order: OutboundOrder; onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState<"form" | "preflight" | "executing" | "result">("form");
  const [newDateTime, setNewDateTime] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<MutationResult | null>(null);
  const [preflightData, setPreflightData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  const appointmentId = Number(order.appointmentId);
  const currentApptTime = order.appointmentTime ? formatFullDT(order.appointmentTime) : "Unknown";

  const nextBusinessDay = getNextBusinessDay();

  async function handleSubmit() {
    if (!newDateTime) { setError("New appointment date/time is required"); return; }
    if (!reason) { setError("Reason is required"); return; }
    setError("");
    setStep("preflight");

    const preflight = await preflightAppointment(appointmentId);
    if (!preflight.success) {
      setError(preflight.message);
      setStep("form");
      return;
    }

    setPreflightData(preflight.appointmentData);
    setStep("executing");

    const res = await executeRollAppointment(
      appointmentId,
      preflight.appointmentData || {},
      newDateTime,
      reason,
      note || undefined
    );
    setResult(res);
    setStep("result");
    if (res.success) setTimeout(onSuccess, 1500);
  }

  return (
    <ModalShell title="Roll / Update Appointment" onClose={onClose}>
      {step === "form" && (
        <div className="space-y-4">
          <InfoRow label="Order" value={order.id} />
          <InfoRow label="Current Appointment" value={currentApptTime} />
          <InfoRow label="Carrier" value={order.carrierId || "—"} />
          <InfoRow label="WMS Appointment ID" value={String(appointmentId)} />

          <div>
            <label className="block text-xs text-muted mb-1">New Appointment Date/Time</label>
            <div className="flex gap-2">
              <input
                type="datetime-local"
                value={newDateTime}
                onChange={e => setNewDateTime(e.target.value)}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={() => setNewDateTime(nextBusinessDay)}
                className="rounded-md border border-border px-3 py-2 text-xs text-muted hover:text-foreground hover:bg-surface-hover"
              >
                Next business day
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Reason (required)</label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Carrier no-show, customer request"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Note (optional)</label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Additional context"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex items-center justify-between pt-2">
            <p className="text-[10px] text-muted">This will update the appointment in WMS</p>
            <div className="flex gap-2">
              <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-xs text-muted hover:text-foreground">Cancel</button>
              <button onClick={handleSubmit} className="rounded-md bg-primary px-4 py-2 text-xs text-white hover:bg-primary-hover">Update Appointment</button>
            </div>
          </div>
        </div>
      )}

      {(step === "preflight" || step === "executing") && (
        <div className="py-8 text-center space-y-3">
          <div className="inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted">
            {step === "preflight" ? "Fetching current appointment from WMS..." : "Updating appointment in WMS..."}
          </p>
        </div>
      )}

      {step === "result" && result && (
        <ResultDisplay result={result} preflightData={preflightData} onClose={onClose} />
      )}
    </ModalShell>
  );
}

function MarkMissedModal({ order, onClose, onSuccess }: { order: OutboundOrder; onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState<"form" | "confirm" | "executing" | "result">("form");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<MutationResult | null>(null);
  const [error, setError] = useState("");

  const appointmentId = Number(order.appointmentId);

  async function handleConfirm() {
    if (!reason) { setError("Reason is required"); return; }
    setError("");
    setStep("executing");

    const res = await executeMarkMissed(appointmentId, reason, note || undefined);
    setResult(res);
    setStep("result");
    if (res.success) setTimeout(onSuccess, 1500);
  }

  return (
    <ModalShell title="Mark Missed Appointment" onClose={onClose}>
      {step === "form" && (
        <div className="space-y-4">
          <div className="rounded-md border border-danger/30 bg-danger-dim p-3">
            <p className="text-xs text-danger font-medium">This action will cancel the appointment in WMS and mark it as missed. This cannot be undone from the dashboard.</p>
          </div>

          <InfoRow label="Order" value={order.id} />
          <InfoRow label="Appointment" value={order.appointmentTime ? formatFullDT(order.appointmentTime) : "—"} />
          <InfoRow label="WMS Appointment ID" value={String(appointmentId)} />

          <div>
            <label className="block text-xs text-muted mb-1">Reason (required)</label>
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g. Carrier did not arrive within window"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Note (optional)</label>
            <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Additional details"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary" />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex items-center justify-between pt-2">
            <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-xs text-muted hover:text-foreground">Cancel</button>
            <button onClick={() => { if (!reason) { setError("Reason required"); return; } setStep("confirm"); }} className="rounded-md bg-danger px-4 py-2 text-xs text-white hover:bg-danger/80">Continue</button>
          </div>
        </div>
      )}

      {step === "confirm" && (
        <div className="space-y-4">
          <div className="rounded-md border border-danger/50 bg-danger-dim p-4 text-center">
            <p className="text-sm text-danger font-medium mb-2">Confirm: Mark appointment as missed?</p>
            <p className="text-xs text-muted">This will cancel appointment {appointmentId} in WMS with reason: "{reason}"</p>
          </div>
          <div className="flex justify-center gap-3">
            <button onClick={() => setStep("form")} className="rounded-md border border-border px-4 py-2 text-xs text-muted">Go Back</button>
            <button onClick={handleConfirm} className="rounded-md bg-danger px-4 py-2 text-xs text-white">Yes, Mark Missed</button>
          </div>
        </div>
      )}

      {step === "executing" && (
        <div className="py-8 text-center space-y-3">
          <div className="inline-block w-5 h-5 border-2 border-danger border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted">Marking appointment as missed in WMS...</p>
        </div>
      )}

      {step === "result" && result && (
        <ResultDisplay result={result} onClose={onClose} />
      )}
    </ModalShell>
  );
}

function CreateAppointmentModal({ order, onClose, onSuccess }: { order: OutboundOrder; onClose: () => void; onSuccess: () => void }) {
  const [step, setStep] = useState<"form" | "executing" | "result">("form");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [result, setResult] = useState<MutationResult | null>(null);
  const [error, setError] = useState("");

  const carrierId = order.carrierId || "";
  const loadId = order.loadNo || "";
  const customerId = order.customerId || order.retailerId || "";

  async function handleSubmit() {
    if (!appointmentTime) { setError("Appointment date/time required"); return; }
    if (!loadId) { setError("Load ID required but not available for this order"); return; }
    setError("");
    setStep("executing");

    const res = await executeCreateAppointment(
      appointmentTime,
      carrierId,
      customerId ? [customerId] : [],
      loadId
    );
    setResult(res);
    setStep("result");
    if (res.success) setTimeout(onSuccess, 1500);
  }

  return (
    <ModalShell title="Create Appointment" onClose={onClose}>
      {step === "form" && (
        <div className="space-y-4">
          <InfoRow label="Order" value={order.id} />
          <InfoRow label="Load" value={loadId || "—"} />
          <InfoRow label="Carrier" value={carrierId || "Not assigned"} />
          <InfoRow label="Customer" value={customerId || "—"} />

          {!loadId && (
            <div className="rounded-md border border-warning/30 bg-warning-dim p-2">
              <p className="text-xs text-warning">No load ID available — appointment creation requires a load reference</p>
            </div>
          )}

          <div>
            <label className="block text-xs text-muted mb-1">Appointment Date/Time</label>
            <input
              type="datetime-local"
              value={appointmentTime}
              onChange={e => setAppointmentTime(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {error && <p className="text-xs text-danger">{error}</p>}

          <div className="flex items-center justify-between pt-2">
            <p className="text-[10px] text-muted">This will create an outbound appointment in WMS</p>
            <div className="flex gap-2">
              <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-xs text-muted hover:text-foreground">Cancel</button>
              <button onClick={handleSubmit} disabled={!loadId} className="rounded-md bg-primary px-4 py-2 text-xs text-white hover:bg-primary-hover disabled:opacity-50">Create Appointment</button>
            </div>
          </div>
        </div>
      )}

      {step === "executing" && (
        <div className="py-8 text-center space-y-3">
          <div className="inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted">Creating appointment in WMS...</p>
        </div>
      )}

      {step === "result" && result && (
        <ResultDisplay result={result} onClose={onClose} />
      )}
    </ModalShell>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-surface-alt p-6 shadow-2xl">
        <h2 className="text-sm font-bold text-foreground mb-4">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xs text-foreground font-mono">{value}</span>
    </div>
  );
}

function ResultDisplay({ result, preflightData, onClose }: { result: MutationResult; preflightData?: Record<string, unknown> | null; onClose: () => void }) {
  return (
    <div className="space-y-4">
      <div className={`rounded-md border p-4 text-center ${result.success ? "border-success/30 bg-success-dim" : "border-danger/30 bg-danger-dim"}`}>
        <p className={`text-sm font-medium ${result.success ? "text-success" : "text-danger"}`}>
          {result.success ? "Success" : "Failed"}
        </p>
        <p className="text-xs text-muted mt-1">{result.message}</p>
      </div>
      <div className="space-y-1 text-[10px] text-muted">
        <p>Transaction: {result.transactionId}</p>
        <p>Response time: {result.responseTime}ms</p>
        {result.wmsResponseCode && <p>WMS response: {result.wmsResponseCode}</p>}
        {result.success && <p className="text-success">Dashboard will refresh from live WMS</p>}
      </div>
      <button onClick={onClose} className="w-full rounded-md border border-border px-4 py-2 text-xs text-muted hover:text-foreground">
        Close
      </button>
    </div>
  );
}

function formatFullDT(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: DEFAULT_TIMEZONE }) +
      " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: DEFAULT_TIMEZONE });
  } catch { return iso; }
}

function getNextBusinessDay(): string {
  const now = new Date();
  const day = now.getDay();
  let addDays = 1;
  if (day === 5) addDays = 3;
  else if (day === 6) addDays = 2;

  const next = new Date(now.getTime() + addDays * 24 * 60 * 60 * 1000);
  next.setHours(8, 0, 0, 0);
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, "0");
  const d = String(next.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}T08:00`;
}
