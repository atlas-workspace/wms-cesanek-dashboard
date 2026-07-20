// --- Audit Entry Source ---

export type AuditSource = "dashboard" | "wms_sync" | "system";

// --- Audit Entry Interface ---

export interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string;
  username: string;
  orderId: string;
  actionType: string;
  previousValue: unknown;
  updatedValue: unknown;
  apiAction: string; // Human-readable label
  transactionId: string | null;
  wmsResponseStatus: number | null;
  ticketId: string | null;
  notificationStatus: string | null;
  source: AuditSource;
}

// --- ID Generation ---

function generateAuditId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `aud_${timestamp}_${random}`;
}

// --- Immutable Audit Log Class ---

export class AuditLog {
  private entries: AuditEntry[] = [];

  /**
   * Append an entry to the audit log. Entries are never removed.
   */
  append(
    entry: Omit<AuditEntry, "id" | "timestamp">
  ): AuditEntry {
    const fullEntry: AuditEntry = {
      id: generateAuditId(),
      timestamp: new Date().toISOString(),
      ...entry,
    };

    this.entries.push(fullEntry);
    return fullEntry;
  }

  getByOrder(orderId: string): AuditEntry[] {
    return this.entries.filter((e) => e.orderId === orderId);
  }

  getRecent(limit: number = 50): AuditEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  getAll(): AuditEntry[] {
    return [...this.entries];
  }
}

// --- Singleton instance ---

export const auditLog = new AuditLog();
