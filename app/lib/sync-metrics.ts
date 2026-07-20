// --- Connection State ---

export enum ConnectionState {
  Connected = "Connected",
  Connecting = "Connecting",
  Synchronizing = "Synchronizing",
  ConnectionFailed = "ConnectionFailed",
  AuthenticationFailed = "AuthenticationFailed",
}

// --- Sync Metrics Interface ---

export interface SyncMetrics {
  connectionState: ConnectionState;
  lastSuccessfulSync: string | null;
  nextScheduledSync: string | null;
  totalApiCallsSession: number;
  successfulUpdates: number;
  failedUpdates: number;
  avgResponseTimeMs: number;
  pendingTransactions: number;
  queueDepth: number;
  consecutiveFailures: number;
}

// --- Sync Tracker Class ---

class SyncTracker {
  private state: ConnectionState = ConnectionState.Connecting;
  private lastSuccessfulSync: string | null = null;
  private nextScheduledSync: string | null = null;
  private totalApiCalls = 0;
  private successfulCalls = 0;
  private failedCalls = 0;
  private responseTimes: number[] = [];
  private pendingTransactions = 0;
  private queueDepth = 0;
  private consecutiveFailures = 0;

  recordApiCall(success: boolean, responseTimeMs: number): void {
    this.totalApiCalls++;
    this.responseTimes.push(responseTimeMs);

    if (success) {
      this.successfulCalls++;
      this.consecutiveFailures = 0;
      this.state = ConnectionState.Connected;
    } else {
      this.failedCalls++;
      this.consecutiveFailures++;

      if (this.consecutiveFailures >= 3) {
        this.state = ConnectionState.ConnectionFailed;
      }
    }
  }

  recordSyncComplete(): void {
    this.lastSuccessfulSync = new Date().toISOString();
    this.state = ConnectionState.Connected;
    this.consecutiveFailures = 0;
  }

  recordSyncFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= 3) {
      this.state = ConnectionState.ConnectionFailed;
    }
  }

  getMetrics(): SyncMetrics {
    const avgResponseTimeMs =
      this.responseTimes.length > 0
        ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
        : 0;

    return {
      connectionState: this.state,
      lastSuccessfulSync: this.lastSuccessfulSync,
      nextScheduledSync: this.nextScheduledSync,
      totalApiCallsSession: this.totalApiCalls,
      successfulUpdates: this.successfulCalls,
      failedUpdates: this.failedCalls,
      avgResponseTimeMs: Math.round(avgResponseTimeMs),
      pendingTransactions: this.pendingTransactions,
      queueDepth: this.queueDepth,
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  getConnectionState(): ConnectionState {
    return this.state;
  }

  setNextScheduledSync(isoDate: string): void {
    this.nextScheduledSync = isoDate;
  }

  setPendingTransactions(count: number): void {
    this.pendingTransactions = count;
  }

  setQueueDepth(depth: number): void {
    this.queueDepth = depth;
  }
}

// --- Singleton instance (module-level) ---

export const syncTracker = new SyncTracker();
