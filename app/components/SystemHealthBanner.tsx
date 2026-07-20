'use client';

import { DensityMode } from "../lib/preferences";
import { SyncMetrics, ConnectionState } from "../lib/sync-metrics";

interface SystemHealthBannerProps {
  wmsConnected: boolean;
  lastSync: Date | null;
  loading: boolean;
  username: string;
  density: DensityMode;
  syncMetrics: SyncMetrics | null;
  onDensityChange: (d: DensityMode) => void;
  onLogout: () => void;
  onRefresh: () => void;
  onOpenSyncPanel: () => void;
}

export default function SystemHealthBanner({ wmsConnected, lastSync, loading, username, density, syncMetrics, onDensityChange, onLogout, onRefresh, onOpenSyncPanel }: SystemHealthBannerProps) {
  const now = new Date();
  const hour = now.getHours();
  const isBusinessHours = hour >= 6 && hour < 18;
  const hoursLeft = isBusinessHours ? 18 - hour : 0;

  const nextSync = lastSync ? new Date(lastSync.getTime() + 10 * 60 * 1000) : null;
  const connState = syncMetrics?.connectionState || (wmsConnected ? ConnectionState.Connected : ConnectionState.ConnectionFailed);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-surface-alt/95 backdrop-blur-sm">
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold text-foreground tracking-tight">Cesanek LTL Ops</h1>
          <div className="flex items-center gap-3 text-[11px]">
            <StatusDot ok={true} label="Engine" />
            <WmsConnectionBadge state={connState} onOpenPanel={onOpenSyncPanel} />
            <StatusDot ok={true} label="Tickets" sublabel="Queued" />
            <StatusDot ok={true} label="Email" sublabel="Test mode" />
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-muted">
          <span>Last WMS read: {lastSync ? formatTime(lastSync) : "—"}</span>
          <span className="text-border">|</span>
          <span>Next: {nextSync ? formatTime(nextSync) : "—"}</span>
          {syncMetrics && (
            <>
              <span className="text-border">|</span>
              <span>{syncMetrics.avgResponseTimeMs}ms avg</span>
            </>
          )}
          <span className="text-border">|</span>
          <span>{isBusinessHours ? `${hoursLeft}h to close` : "After hours"}</span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex rounded border border-border overflow-hidden">
            {(["compact", "standard", "comfortable"] as const).map(d => (
              <button
                key={d}
                onClick={() => onDensityChange(d)}
                className={`px-2 py-0.5 text-[10px] capitalize transition-colors ${density === d ? "bg-primary text-white" : "text-muted hover:text-foreground"}`}
                title={`${d} density`}
              >
                {d.charAt(0).toUpperCase()}
              </button>
            ))}
          </div>
          <button onClick={onRefresh} disabled={loading} className="rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:text-foreground disabled:opacity-50" title="Refresh from live WMS">
            {loading ? "⟳" : "⟳"}
          </button>
          <span className="text-[11px] text-muted-light">LT_F21 · {username}</span>
          <button onClick={onLogout} className="rounded px-2 py-0.5 text-[11px] text-muted hover:text-danger">Sign out</button>
        </div>
      </div>
    </header>
  );
}

function WmsConnectionBadge({ state, onOpenPanel }: { state: ConnectionState; onOpenPanel: () => void }) {
  let dotClass = "bg-success";
  let label = "WMS Live";

  switch (state) {
    case ConnectionState.Connected:
      dotClass = "bg-success";
      label = "WMS Live";
      break;
    case ConnectionState.Connecting:
      dotClass = "bg-warning animate-pulse";
      label = "WMS Connecting";
      break;
    case ConnectionState.Synchronizing:
      dotClass = "bg-info animate-pulse";
      label = "WMS Syncing";
      break;
    case ConnectionState.ConnectionFailed:
      dotClass = "bg-danger animate-pulse";
      label = "WMS Disconnected";
      break;
    case ConnectionState.AuthenticationFailed:
      dotClass = "bg-danger animate-pulse";
      label = "WMS Auth Failed";
      break;
  }

  return (
    <button onClick={onOpenPanel} className="flex items-center gap-1 hover:opacity-80 transition-opacity" title="Open synchronization panel">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotClass}`} />
      <span className="text-muted-light font-medium">{label}</span>
    </button>
  );
}

function StatusDot({ ok, label, sublabel }: { ok: boolean; label: string; sublabel?: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? "bg-success" : "bg-danger animate-pulse"}`} />
      <span className="text-muted-light">{label}</span>
      {sublabel && <span className="text-muted">({sublabel})</span>}
    </span>
  );
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
