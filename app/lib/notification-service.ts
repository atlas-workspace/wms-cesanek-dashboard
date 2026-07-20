/**
 * Notification workflow service.
 *
 * External email delivery requires SMTP/notification provider configuration.
 * All notifications queue in test mode.
 */

// --- Recipient Types ---

export type RecipientType = "customer" | "carrier" | "supervisor";

// --- Notification Status ---

export type NotificationStatus = "queued" | "sent" | "failed" | "test_mode";

// --- Notification Rule Interface ---

export interface NotificationRule {
  event: string;
  recipients: RecipientType[];
  template: string;
  enabled: boolean;
  requiresWmsPreflight: boolean;
}

// --- Notification Log Interface ---

export interface NotificationLog {
  id: string;
  orderId: string;
  recipientType: RecipientType;
  recipientId: string;
  event: string;
  status: NotificationStatus;
  sentAt: string | null;
  retryCount: number;
  messageTemplate: string;
}

// --- ID Generation ---

function generateNotificationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `ntf_${timestamp}_${random}`;
}

// --- Notification Service Class ---

export class NotificationService {
  private log: NotificationLog[] = [];

  /**
   * Queue a notification for an order event.
   * All notifications default to test_mode/queued unless real send is configured.
   */
  queueNotification(
    orderId: string,
    event: string,
    recipientType: RecipientType,
    recipientId?: string,
    messageTemplate?: string
  ): NotificationLog {
    const entry: NotificationLog = {
      id: generateNotificationId(),
      orderId,
      recipientType,
      recipientId: recipientId || "unresolved",
      event,
      status: "test_mode",
      sentAt: null,
      retryCount: 0,
      messageTemplate: messageTemplate || `[${event}] Notification for order ${orderId}`,
    };

    this.log.push(entry);
    return entry;
  }

  getLog(): NotificationLog[] {
    return [...this.log];
  }

  getByOrder(orderId: string): NotificationLog[] {
    return this.log.filter((n) => n.orderId === orderId);
  }
}

// --- Singleton instance ---

export const notificationService = new NotificationService();
