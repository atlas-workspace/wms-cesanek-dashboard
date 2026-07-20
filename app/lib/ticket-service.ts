/**
 * Ticketing integration scaffolding.
 *
 * Ticket creation requires verified ticket-ops API endpoint.
 * Queue events until integration is configured.
 */

// --- Ticket Event Types ---

export type TicketEvent =
  | "appointment_missed"
  | "appointment_rolled"
  | "carrier_late"
  | "notification_failed"
  | "sync_error"
  | "sla_exceeded"
  | "multiple_rollovers";

// --- Ticket Priority ---

export type TicketPriority = "low" | "medium" | "high" | "critical";

// --- Ticket Status ---

export type TicketStatus = "pending_integration" | "queued" | "created" | "failed";

// --- Ticket Payload ---

export interface TicketPayload {
  customer: string;
  orderNo: string;
  loadId: string;
  carrier: string;
  appointmentTime: string;
  status: string;
  timeSinceMissed: string | null;
  rolloverCount: number;
  assignedTeam: string;
  reasonCode: string | null;
}

// --- Pending Ticket Interface ---

export interface PendingTicket {
  id: string;
  event: TicketEvent;
  orderId: string;
  priority: TicketPriority;
  payload: TicketPayload;
  createdAt: string;
  status: TicketStatus;
  ticketNumber: string | null; // null until created
  ticketUrl: string | null; // null until created
}

// --- ID Generation ---

function generateTicketQueueId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `tkt_${timestamp}_${random}`;
}

// --- Ticket Queue Class ---

export class TicketQueue {
  private tickets: PendingTicket[] = [];

  /**
   * Queue a ticket event for future creation.
   * Ticket creation requires verified ticket-ops API endpoint.
   * All queued events remain in pending_integration until integration is configured.
   */
  queue(
    event: TicketEvent,
    orderId: string,
    priority: TicketPriority,
    payload: TicketPayload
  ): PendingTicket {
    const ticket: PendingTicket = {
      id: generateTicketQueueId(),
      event,
      orderId,
      priority,
      payload,
      createdAt: new Date().toISOString(),
      status: "pending_integration",
      ticketNumber: null,
      ticketUrl: null,
    };

    this.tickets.push(ticket);
    return ticket;
  }

  getAll(): PendingTicket[] {
    return [...this.tickets];
  }

  getByOrder(orderId: string): PendingTicket[] {
    return this.tickets.filter((t) => t.orderId === orderId);
  }

  getPending(): PendingTicket[] {
    return this.tickets.filter(
      (t) => t.status === "pending_integration" || t.status === "queued"
    );
  }
}

// --- Singleton instance ---

export const ticketQueue = new TicketQueue();
