import { OutboundOrder } from "./wms-api";

export interface KPIData {
  missedAppointments: number;
  awaitingRollover: number;
  rolledToday: number;
  completedToday: number;
  exceptionQueue: number;
  avgProcessingTime: string;
  avgDaysSinceMissed: string;
  rolledMoreThanOnce: number;
  totalActive: number;
}

export interface AttentionItem {
  id: string;
  type: "missed_24h" | "rolled_2x" | "carrier_late" | "notification_failed" | "sync_failed" | "sla_critical";
  severity: "critical" | "warning";
  orderId: string;
  message: string;
  action: string;
}

export interface Recommendation {
  id: string;
  orderId: string;
  type: "roll" | "notify_customer" | "notify_carrier" | "escalate" | "review";
  message: string;
  priority: "high" | "medium" | "low";
}

export interface CarrierPerformance {
  carrierId: string;
  missed: number;
  avgDelay: number;
  totalOrders: number;
  completedPct: number;
}

export interface CustomerImpact {
  customerId: string;
  customerName: string;
  missedLoads: number;
  avgDelay: number;
  totalRollovers: number;
  oldestOpen: string | null;
}

function daysBetween(dateStr: string, now: Date): number {
  const d = new Date(dateStr);
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)));
}

function isToday(dateStr: string | undefined, timezone: string): boolean {
  if (!dateStr) return false;
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const todayStr = formatter.format(new Date());
  const orderDate = formatter.format(new Date(dateStr));
  return todayStr === orderDate;
}

function isPast(dateStr: string | undefined): boolean {
  if (!dateStr) return false;
  return new Date(dateStr).getTime() < Date.now();
}

export function computeKPIs(orders: OutboundOrder[], timezone: string): KPIData {
  const now = new Date();
  let missed = 0;
  let awaitingRollover = 0;
  let rolledToday = 0;
  let completedToday = 0;
  let exceptionQueue = 0;
  let rolledMoreThanOnce = 0;
  let totalDaysSinceMissed = 0;
  let missedCount = 0;

  for (const o of orders) {
    const status = (o.status || "").toUpperCase();
    const isMissed = isPast(o.appointmentTime) && !["SHIPPED", "COMPLETED", "CANCELLED", "LOADED"].includes(status);

    if (isMissed) {
      missed++;
      if (o.appointmentTime) {
        totalDaysSinceMissed += daysBetween(o.appointmentTime, now);
        missedCount++;
      }
    }

    if (status === "COMMIT_FAILED" || o.exceptionReason) {
      exceptionQueue++;
    }

    if (status === "SHIPPED" || status === "COMPLETED" || status === "LOADED") {
      if (isToday(o.shippedTime || o.packedTime, timezone)) {
        completedToday++;
      }
    }

    // Heuristic: orders with scheduleDate today that are still in early status
    if (isPast(o.appointmentTime) && status === "PLANNED") {
      awaitingRollover++;
    }
  }

  const avgDays = missedCount > 0 ? (totalDaysSinceMissed / missedCount).toFixed(1) : "0";

  return {
    missedAppointments: missed,
    awaitingRollover,
    rolledToday,
    completedToday,
    exceptionQueue,
    avgProcessingTime: "—",
    avgDaysSinceMissed: avgDays,
    rolledMoreThanOnce,
    totalActive: orders.filter(o => !["SHIPPED", "COMPLETED", "CANCELLED"].includes((o.status || "").toUpperCase())).length,
  };
}

export function computeAttentionItems(orders: OutboundOrder[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  const now = new Date();

  for (const o of orders) {
    const status = (o.status || "").toUpperCase();
    if (["SHIPPED", "COMPLETED", "CANCELLED"].includes(status)) continue;

    if (o.appointmentTime && isPast(o.appointmentTime)) {
      const hours = (now.getTime() - new Date(o.appointmentTime).getTime()) / (1000 * 60 * 60);
      if (hours > 24) {
        items.push({
          id: `missed_24h_${o.id}`,
          type: "missed_24h",
          severity: "critical",
          orderId: o.id,
          message: `${o.id} missed appointment ${Math.floor(hours)}h ago`,
          action: "Roll or escalate",
        });
      }
    }

    if (status === "COMMIT_FAILED") {
      items.push({
        id: `exception_${o.id}`,
        type: "sync_failed",
        severity: "critical",
        orderId: o.id,
        message: `${o.id} commitment failed${o.exceptionReason ? `: ${o.exceptionReason}` : ""}`,
        action: "Review inventory allocation",
      });
    }
  }

  return items.slice(0, 10);
}

export function computeRecommendations(orders: OutboundOrder[]): Recommendation[] {
  const recs: Recommendation[] = [];

  for (const o of orders) {
    const status = (o.status || "").toUpperCase();
    if (["SHIPPED", "COMPLETED", "CANCELLED"].includes(status)) continue;

    if (o.appointmentTime && isPast(o.appointmentTime) && status === "PLANNED") {
      recs.push({
        id: `roll_${o.id}`,
        orderId: o.id,
        type: "roll",
        message: `Roll appointment now — ${o.id} past scheduled time`,
        priority: "high",
      });
    }

    if (status === "COMMIT_FAILED") {
      recs.push({
        id: `escalate_${o.id}`,
        orderId: o.id,
        type: "escalate",
        message: `Escalate ${o.id} — commitment failure needs resolution`,
        priority: "high",
      });
    }
  }

  return recs.slice(0, 8);
}

export function computeCarrierPerformance(orders: OutboundOrder[]): CarrierPerformance[] {
  const carrierMap = new Map<string, { total: number; missed: number; completed: number; delayDays: number }>();

  for (const o of orders) {
    const carrier = o.carrierId || "Unknown";
    if (!carrierMap.has(carrier)) {
      carrierMap.set(carrier, { total: 0, missed: 0, completed: 0, delayDays: 0 });
    }
    const c = carrierMap.get(carrier)!;
    c.total++;

    const status = (o.status || "").toUpperCase();
    if (["SHIPPED", "COMPLETED", "LOADED"].includes(status)) {
      c.completed++;
    } else if (isPast(o.appointmentTime)) {
      c.missed++;
      if (o.appointmentTime) {
        c.delayDays += daysBetween(o.appointmentTime, new Date());
      }
    }
  }

  return Array.from(carrierMap.entries())
    .map(([carrierId, d]) => ({
      carrierId,
      missed: d.missed,
      avgDelay: d.missed > 0 ? Math.round(d.delayDays / d.missed) : 0,
      totalOrders: d.total,
      completedPct: d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0,
    }))
    .sort((a, b) => b.missed - a.missed)
    .slice(0, 8);
}

export function computeCustomerImpact(orders: OutboundOrder[]): CustomerImpact[] {
  const custMap = new Map<string, { name: string; missed: number; rollovers: number; delayDays: number; oldestAppt: string | null }>();

  for (const o of orders) {
    const custId = o.customerId || o.retailerId || "Unknown";
    const custName = o.customerName || o.shipToName || custId;
    if (!custMap.has(custId)) {
      custMap.set(custId, { name: custName, missed: 0, rollovers: 0, delayDays: 0, oldestAppt: null });
    }
    const c = custMap.get(custId)!;

    const status = (o.status || "").toUpperCase();
    if (!["SHIPPED", "COMPLETED", "CANCELLED", "LOADED"].includes(status) && isPast(o.appointmentTime)) {
      c.missed++;
      if (o.appointmentTime) {
        c.delayDays += daysBetween(o.appointmentTime, new Date());
        if (!c.oldestAppt || o.appointmentTime < c.oldestAppt) {
          c.oldestAppt = o.appointmentTime;
        }
      }
    }
  }

  return Array.from(custMap.entries())
    .map(([customerId, d]) => ({
      customerId,
      customerName: d.name,
      missedLoads: d.missed,
      avgDelay: d.missed > 0 ? Math.round(d.delayDays / d.missed) : 0,
      totalRollovers: d.rollovers,
      oldestOpen: d.oldestAppt,
    }))
    .filter(c => c.missedLoads > 0)
    .sort((a, b) => b.missedLoads - a.missedLoads)
    .slice(0, 8);
}
