import { NextRequest } from "next/server";

/**
 * WMS Proxy Route Handler
 *
 * Routes requests to the correct WMS endpoint based on x-wms-action header.
 * Supported actions:
 *   - "search-orders" (default): POST /wms-bam/outbound/order/search-by-paging
 *   - "get-appointment": GET /wms/appointment/{id}
 *   - "get-appointment-bam": GET /wms-bam/appointment/{id}
 *   - "search-loads": POST /wms-bam/outbound/load/search-by-paging
 *   - "update-appointment": PUT /wms/appointment/{id}
 *   - "cancel-appointment": PUT /wms/appointment/cancel/{id}
 *   - "create-appointment": POST /wms/appointment
 */
export async function POST(request: NextRequest) {
  const wmsBaseUrl = process.env.WMS_API_BASE_URL;
  if (!wmsBaseUrl) {
    return Response.json(
      { success: false, message: "WMS service not configured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return Response.json(
      { success: false, message: "Not authenticated" },
      { status: 401 }
    );
  }

  const facilityId = request.headers.get("x-facility-id") || "LT_F21";
  const tenantId = request.headers.get("x-tenant-id") || "LT";
  const timezone = request.headers.get("x-timezone") || "America/New_York";
  const wmsAction = request.headers.get("x-wms-action") || "search-orders";

  const commonHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": authHeader,
    "x-facility-id": facilityId,
    "x-tenant-id": tenantId,
    "x-timezone": timezone,
  };

  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    if (!["get-appointment", "get-appointment-bam"].includes(wmsAction)) {
      return Response.json(
        { success: false, message: "Invalid request body" },
        { status: 400 }
      );
    }
  }

  let endpoint: string;
  let method: string = "POST";

  switch (wmsAction) {
    case "search-orders":
      endpoint = `${wmsBaseUrl}/wms-bam/outbound/order/search-by-paging`;
      break;

    case "get-appointment": {
      const apptId = body?.appointmentId;
      if (!apptId || typeof apptId !== "number") {
        return Response.json({ success: false, message: "Numeric appointmentId required" }, { status: 400 });
      }
      endpoint = `${wmsBaseUrl}/wms/appointment/${apptId}`;
      method = "GET";
      break;
    }

    case "get-appointment-bam": {
      const apptId = body?.appointmentId;
      if (!apptId) {
        return Response.json({ success: false, message: "appointmentId required" }, { status: 400 });
      }
      endpoint = `${wmsBaseUrl}/wms-bam/appointment/${apptId}`;
      method = "GET";
      break;
    }

    case "search-loads":
      endpoint = `${wmsBaseUrl}/wms-bam/outbound/load/search-by-paging`;
      break;

    case "update-appointment": {
      const apptId = body?.appointmentId;
      if (!apptId || typeof apptId !== "number") {
        return Response.json({ success: false, message: "Numeric appointmentId required for update" }, { status: 400 });
      }
      const payload = body?.payload;
      if (!payload || typeof payload !== "object") {
        return Response.json({ success: false, message: "Payload required for appointment update" }, { status: 400 });
      }
      endpoint = `${wmsBaseUrl}/wms/appointment/${apptId}`;
      method = "PUT";
      body = payload as Record<string, unknown>;
      break;
    }

    case "cancel-appointment": {
      const apptId = body?.appointmentId;
      if (!apptId || typeof apptId !== "number") {
        return Response.json({ success: false, message: "Numeric appointmentId required for cancel" }, { status: 400 });
      }
      const payload = body?.payload;
      if (!payload || typeof payload !== "object") {
        return Response.json({ success: false, message: "Payload with reason required for cancel" }, { status: 400 });
      }
      endpoint = `${wmsBaseUrl}/wms/appointment/cancel/${apptId}`;
      method = "PUT";
      body = payload as Record<string, unknown>;
      break;
    }

    case "create-appointment": {
      const payload = body?.payload;
      if (!payload || typeof payload !== "object") {
        return Response.json({ success: false, message: "Payload required for appointment creation" }, { status: 400 });
      }
      endpoint = `${wmsBaseUrl}/wms/appointment`;
      method = "POST";
      body = payload as Record<string, unknown>;
      break;
    }

    default:
      return Response.json({ success: false, message: `Unknown WMS action: ${wmsAction}` }, { status: 400 });
  }

  const startTime = Date.now();

  try {
    const fetchOptions: RequestInit = {
      method,
      headers: commonHeaders,
    };

    if (method !== "GET" && body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const res = await fetch(endpoint, fetchOptions);
    const responseTime = Date.now() - startTime;
    const json = await res.json();

    if (!res.ok || (json.code !== undefined && String(json.code) !== "0")) {
      console.error(`[wms-proxy] ${wmsAction} error:`, res.status, json.code, json.msg || json.message);
      return Response.json(
        {
          success: false,
          message: json.msg || json.message || `WMS returned status ${res.status}`,
          wmsCode: json.code,
          responseTime,
        },
        { status: res.ok ? 422 : res.status }
      );
    }

    return Response.json({ success: true, data: json.data ?? json, responseTime });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[wms-proxy] ${wmsAction} unreachable:`, errMsg);
    return Response.json(
      { success: false, message: "Unable to reach WMS service", responseTime: Date.now() - startTime },
      { status: 502 }
    );
  }
}
