import { NextRequest, NextResponse } from "next/server";

/**
 * Ticket API Proxy — routes ticket creation to UNIS ITEM Ticket System
 * Uses IAM session token for authentication.
 * Test Mode: customerEmail forced to erin.cambra@unisco.com
 */

const TICKET_API_BASE_URL = process.env.TICKET_API_BASE_URL || "https://unisticket.item.com/api/item-tickets";
const TENANT_ID = process.env.NEXT_PUBLIC_DEFAULT_TENANT || "LT";

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("x-session-token");
    if (!token) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await req.json();
    const { action, ...payload } = body;

    if (action === "create") {
      // Test Mode: force customerEmail to test recipient
      const ticketPayload = {
        ...payload,
        customerEmail: "erin.cambra@unisco.com",
      };

      const res = await fetch(`${TICKET_API_BASE_URL}/v1/iam/tickets`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "X-Tenant-Id": TENANT_ID,
          "User-Agent": "wms-cesanek-dashboard/1.0",
        },
        body: JSON.stringify(ticketPayload),
      });

      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { msg: text }; }

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return NextResponse.json({ error: "Session expired or insufficient permissions for ticket creation.", status: "auth_failed" }, { status: 401 });
        }
        return NextResponse.json({
          error: "Ticket could not be created. The Ticket API returned an error.",
          status: "api_error",
          detail: json.msg || "Unknown error",
        }, { status: 502 });
      }

      if (json.success === false || (json.code && json.code !== 0)) {
        return NextResponse.json({
          error: json.msg || "Ticket creation was rejected by the system.",
          status: "rejected",
        }, { status: 422 });
      }

      return NextResponse.json({
        success: true,
        status: "created",
        data: json.data,
        testMode: true,
        testRecipient: "erin.caa@unisco.com",
        intendedRecipient: payload.customerEmail,
      });
    }

    if (action === "search") {
      const res = await fetch(`${TICKET_API_BASE_URL}/v1/iam/tickets/page`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "X-Tenant-Id": TENANT_ID,
          "User-Agent": "wms-cesanek-dashboard/1.0",
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return NextResponse.json({ error: "Could not retrieve tickets.", status: "api_error" }, { status: 502 });
      }
      return NextResponse.json(json);
    }

    return NextResponse.json({ error: "Unknown ticket action." }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Unable to reach the ticket service." }, { status: 502 });
  }
}
