import { getUserInfo, getStoredTokens } from "./auth";

// --- Transaction States ---

export type TransactionStatus =
  | "Pending"
  | "Executing"
  | "Confirmed"
  | "Failed"
  | "TimedOut"
  | "Queued";

// --- Transaction Interface ---

export interface Transaction {
  id: string;
  type: string;
  orderId: string;
  status: TransactionStatus;
  createdAt: string;
  completedAt: string | null;
  responseTime: number | null;
  wmsTxnId: string | null;
  userId: string;
  previousValue: unknown;
  updatedValue: unknown;
  apiAction: string; // Human-readable label, not raw endpoint
  wmsResponseCode: number | null;
  ticketId: string | null;
  notificationStatus: string | null;
}

// --- ID Generation ---

export function generateTxnId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `txn_${timestamp}_${random}`;
}

// --- Transaction Log (session-scoped, in-memory) ---

export class TransactionLog {
  private transactions: Transaction[] = [];

  add(transaction: Transaction): void {
    this.transactions.push(transaction);
  }

  get(id: string): Transaction | undefined {
    return this.transactions.find((t) => t.id === id);
  }

  getByOrder(orderId: string): Transaction[] {
    return this.transactions.filter((t) => t.orderId === orderId);
  }

  getRecent(limit: number = 50): Transaction[] {
    return this.transactions.slice(-limit).reverse();
  }
}

// --- Singleton instance ---

export const transactionLog = new TransactionLog();

// --- Transaction Execution Orchestrator ---

export interface ExecuteTransactionCallbacks {
  preflight?: (orderId: string, payload: unknown) => Promise<boolean>;
  mutate?: (orderId: string, payload: unknown) => Promise<{ wmsTxnId: string; responseCode: number }>;
  refetch?: (orderId: string) => Promise<void>;
}

/**
 * Orchestrates a WMS transaction through: preflight -> validate -> mutate -> confirm -> refetch -> log.
 *
 * Since no mutations are verified yet, this always returns a Failed transaction with explanation.
 */
export async function executeWmsTransaction(
  actionType: string,
  orderId: string,
  payload: { previousValue: unknown; updatedValue: unknown; apiAction: string },
  callbacks?: ExecuteTransactionCallbacks
): Promise<Transaction> {
  const tokens = getStoredTokens();
  const userInfo = tokens ? getUserInfo(tokens) : null;

  const txn: Transaction = {
    id: generateTxnId(),
    type: actionType,
    orderId,
    status: "Pending",
    createdAt: new Date().toISOString(),
    completedAt: null,
    responseTime: null,
    wmsTxnId: null,
    userId: userInfo?.userId || "unknown",
    previousValue: payload.previousValue,
    updatedValue: payload.updatedValue,
    apiAction: payload.apiAction,
    wmsResponseCode: null,
    ticketId: null,
    notificationStatus: null,
  };

  const startTime = Date.now();

  try {
    // Step 1: Preflight check
    if (callbacks?.preflight) {
      const preflightOk = await callbacks.preflight(orderId, payload);
      if (!preflightOk) {
        txn.status = "Failed";
        txn.completedAt = new Date().toISOString();
        txn.responseTime = Date.now() - startTime;
        transactionLog.add(txn);
        return txn;
      }
    }

    // Step 2: Validate — no verified mutation endpoints exist yet
    // All transactions fail until mutation APIs are confirmed and integrated.
    txn.status = "Failed";
    txn.completedAt = new Date().toISOString();
    txn.responseTime = Date.now() - startTime;
    txn.wmsResponseCode = null;

    // Explanation: No verified WMS mutation endpoint is configured for this action.
    // Once verified, the orchestrator will proceed through mutate -> confirm -> refetch.

    transactionLog.add(txn);
    return txn;
  } catch (error) {
    txn.status = "Failed";
    txn.completedAt = new Date().toISOString();
    txn.responseTime = Date.now() - startTime;
    transactionLog.add(txn);
    return txn;
  }
}
