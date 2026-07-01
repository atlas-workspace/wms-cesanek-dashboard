import { NextRequest, NextResponse } from "next/server";

const WMS_API_BASE_URL = process.env.NEXT_PUBLIC_WMS_API_BASE_URL || "https://unis.item.com/api";
const FACILITY_ID = process.env.NEXT_PUBLIC_DEFAULT_FACILITY || "LT_F21";
const TENANT_ID = process.env.NEXT_PUBLIC_DEFAULT_TENANT || "LT";
const TIMEZONE = process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || "America/New_York";

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("x-session-token");
    if (!token) {
      return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 401 });
    }

    const { path, body } = await req.json();
    if (!path) {
      return NextResponse.json({ error: "Missing request path." }, { status: 400 });
    }

    const res = await fetch(`${WMS_API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "x-facility-id": FACILITY_ID,
        "x-tenant-id": TENANT_ID,
        "item-time-zone": TIMEZONE,
      },
      body: JSON.stringify(body || {}),
    });

    const text = await res.text();

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
      }
      return NextResponse.json({ error: "Warehouse data could not be loaded. Please try again." }, { status: 502 });
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Unexpected response from warehouse service." }, { status: 502 });
    }

    return NextResponse.json(json);
  } catch {
    return NextResponse.json({ error: "Unable to reach the warehouse service." }, { status: 502 });
  }
}
