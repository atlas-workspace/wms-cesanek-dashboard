import { NextRequest, NextResponse } from "next/server";

/**
 * LTL Auto-Rollover Scan Endpoint
 * 
 * PRODUCTION DEPLOYMENT NOTE:
 * This endpoint should be called by a scheduled background job (cron, Azure Function,
 * AWS Lambda, Hangfire, Windows Service) every business day at 4:00 PM ET.
 * It is idempotent — calling multiple times on the same day produces the same result.
 * 
 * Current implementation: Returns proposed rollover candidates.
 * WMS MUTATION IS NOT PERFORMED — no verified appointment update endpoint confirmed.
 * When WMS update endpoint is verified, add mutation logic with retry (0/2min/5min)
 * and idempotency key based on loadNo+date.
 */

const WMS_API_BASE_URL = process.env.NEXT_PUBLIC_WMS_API_BASE_URL || "https://unis.item.com/api";
const FACILITY_ID = process.env.NEXT_PUBLIC_DEFAULT_FACILITY || "LT_F21";
const TENANT_ID = process.env.NEXT_PUBLIC_DEFAULT_TENANT || "LT";
const TIMEZONE = process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || "America/New_York";
const FINAL_STATUSES = ["SHIPPED", "COMPLETED", "CANCELLED", "SHORT_SHIPPED"];

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("x-session-token");
    if (!token) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    // Fetch LTL orders from WMS
    const wmsRes = await fetch(`${WMS_API_BASE_URL}/wms-bam/outbound/order/raw-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "x-facility-id": FACILITY_ID,
        "x-tenant-id": TENANT_ID,
        "item-time-zone": TIMEZONE,
      },
      body: JSON.stringify({
        currentPage: 1,
        pageSize: 200,
        shipMethod: "LTL",
        excludeStatuses: FINAL_STATUSES,
        sortingFields: [{ field: "createdTime", orderBy: "DESC" }],
      }),
    });

    if (!wmsRes.ok) {
      return NextResponse.json({ error: "WMS data unavailable.", wmsStatus: wmsRes.status }, { status: 502 });
    }

    const wmsJson = await wmsRes.json();
    const orders = Array.isArray(wmsJson?.data) ? wmsJson.data : [];

    // Identify rollover candidates: have appointment, past cutoff, not final
    const now = new Date();
    const estNow = new Date(now.toLocaleString("en-US", { timeZone: TIMEZONE }));
    const isPastCutoff = estNow.getHours() >= 16;
    const today = now.toISOString().slice(0, 10);

    const candidates = orders.filter((o: { appointmentTime?: string; status?: string }) => {
      if (!o.appointmentTime) return false;
      const apptDate = new Date(o.appointmentTime);
      if (apptDate > now) return false; // future appointment
      const hoursPast = (now.getTime() - apptDate.getTime()) / 3600000;
      if (hoursPast < 1) return false; // within grace period
      return true;
    });

    // Calculate proposed new appointments
    const proposals = candidates.map((o: { id: string; referenceNo?: string; loadNo?: string; carrierId?: string; carrierName?: string; appointmentTime?: string; customerName?: string }) => {
      const nextBizDay = new Date(now);
      nextBizDay.setDate(nextBizDay.getDate() + 1);
      while (nextBizDay.getDay() === 0 || nextBizDay.getDay() === 6) {
        nextBizDay.setDate(nextBizDay.getDate() + 1);
      }
      nextBizDay.setHours(8, 0, 0, 0);

      return {
        orderId: o.id,
        orderNumber: o.referenceNo || o.id,
        loadNumber: o.loadNo || "—",
        carrier: o.carrierName || o.carrierId || "—",
        customer: o.customerName || "—",
        originalAppointment: o.appointmentTime,
        proposedNewAppointment: nextBizDay.toISOString(),
        reason: "Missed Pickup Auto Rollover",
        idempotencyKey: `${o.id}_${today}`,
        // WMS UPDATE STATUS:
        wmsUpdateStatus: "pending_verification",
        wmsUpdateNote: "No verified WMS appointment mutation endpoint. Rollover is a proposal only.",
        emailStatus: "draft_pending",
      };
    });

    return NextResponse.json({
      success: true,
      scanTimestamp: now.toISOString(),
      timezone: TIMEZONE,
      isPastCutoff,
      totalLtlOrders: orders.length,
      candidatesFound: candidates.length,
      proposals,
      wmsIntegration: {
        mutationVerified: false,
        note: "WMS appointment update endpoint not yet verified. Proposals are generated but NOT executed against WMS.",
      },
      emailIntegration: {
        sendVerified: false,
        note: "Email send capability not verified. Notification drafts generated but NOT sent.",
      },
    });
  } catch (e) {
    return NextResponse.json({
      error: "Rollover scan failed.",
      detail: e instanceof Error ? e.message : "Unknown error",
    }, { status: 500 });
  }
}
