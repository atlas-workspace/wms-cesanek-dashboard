// --- Exception Types ---

export type ExceptionType =
  | "sync_failed"
  | "update_failed"
  | "ticket_failed"
  | "notification_failed"
  | "timeout";

// --- Exception Status ---

export type ExceptionStatus = "open" | "retrying" | "escalated" | "resolved";

// --- Exception Item Interface ---

export interface ExceptionItem {
  id: string;
  orderId: string;
  type: ExceptionType;
  description: string;
  retryCount: number;
  maxRetries: number;
  lastAttempt: string | null;
  assignedUser: string | null;
  status: ExceptionStatus;
  createdAt: string;
}

// --- ID Generation ---

function generateExceptionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `exc_${timestamp}_${random}`;
}

// --- Exception Queue Class ---

export class ExceptionQueue {
  private items: ExceptionItem[] = [];

  add(
    item: Omit<ExceptionItem, "id" | "createdAt" | "retryCount" | "lastAttempt" | "status"> & {
      retryCount?: number;
      lastAttempt?: string | null;
      status?: ExceptionStatus;
    }
  ): ExceptionItem {
    const fullItem: ExceptionItem = {
      id: generateExceptionId(),
      createdAt: new Date().toISOString(),
      retryCount: 0,
      lastAttempt: null,
      status: "open",
      ...item,
    };

    this.items.push(fullItem);
    return fullItem;
  }

  getAll(): ExceptionItem[] {
    return [...this.items];
  }

  getOpen(): ExceptionItem[] {
    return this.items.filter((i) => i.status === "open" || i.status === "retrying");
  }

  retry(id: string): ExceptionItem | undefined {
    const item = this.items.find((i) => i.id === id);
    if (!item) return undefined;

    if (item.retryCount >= item.maxRetries) {
      item.status = "escalated";
    } else {
      item.retryCount++;
      item.lastAttempt = new Date().toISOString();
      item.status = "retrying";
    }

    return item;
  }

  escalate(id: string): ExceptionItem | undefined {
    const item = this.items.find((i) => i.id === id);
    if (!item) return undefined;

    item.status = "escalated";
    return item;
  }

  resolve(id: string): ExceptionItem | undefined {
    const item = this.items.find((i) => i.id === id);
    if (!item) return undefined;

    item.status = "resolved";
    return item;
  }
}

// --- Singleton instance ---

export const exceptionQueue = new ExceptionQueue();
