const IAM_BASE_URL = process.env.NEXT_PUBLIC_IAM_BASE_URL!;
const WMS_API_BASE_URL = process.env.NEXT_PUBLIC_WMS_API_BASE_URL!;

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface JwtPayload {
  data: {
    user_id: string;
    tenant_id?: string;
    company_code?: string;
    username?: string;
    email?: string;
  };
}

export interface WmsOrder {
  id: string;
  referenceNo: string;
  poNo: string;
  status: string;
  customerId: string;
  createdTime: string;
  orderedDate: string;
  shipTo: string;
  shipToAddress?: { name?: string; city?: string; state?: string };
  appointmentTime?: string;
  carrierId?: string;
  bolNo?: string;
  orderType?: string;
  mabd?: string;
  scheduleDate?: string;
  channel?: string;
  source?: string;
  itemLineCount?: number;
  itemLineTotalQty?: number;
}

export interface WmsCustomer {
  id: string;
  customerCode: string;
  customerName: string;
  customerFullName?: string;
  orgId?: string;
}

export interface WmsAppointment {
  id: string;
  sid: string;
  carrierId?: string;
  carrierName?: string;
  appointmentType: string;
  appointmentTime: string;
  apptStatus: string;
  createdTime: string;
  customerIds?: string[];
  customerNames?: string[];
  appointmentActions?: {
    appointmentType?: string;
    serviceType?: string;
    referenceNos?: string[];
  }[];
}

function friendlyAuthError(status: number, body: string): string {
  if (status === 401 || status === 403) return "Invalid username or password. Please try again.";
  if (status === 404) return "Authentication service is unreachable. Please contact your administrator.";
  if (status === 429) return "Too many sign-in attempts. Please wait a moment and try again.";
  if (status >= 500) return "Authentication service is temporarily unavailable. Please try again later.";
  if (body) {
    try {
      const json = JSON.parse(body);
      if (json.msg) return json.msg;
      if (json.message) return json.message;
    } catch {
      // not JSON
    }
  }
  return "Unable to sign in. Please check your credentials and try again.";
}

function friendlyApiError(status: number): string {
  if (status === 401 || status === 403) return "Your session has expired or you lack access. Please sign in again.";
  if (status === 404) return "The requested data could not be found. Please confirm your facility access.";
  if (status >= 500) return "The warehouse service is temporarily unavailable. Please try again later.";
  return "Unable to load warehouse data. Please try again.";
}

export async function login(username: string, password: string): Promise<AuthTokens> {
  let res: Response;
  try {
    res = await fetch(`${IAM_BASE_URL}/auth/exchange-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "password", username, password }),
    });
  } catch {
    throw new Error("Unable to reach the authentication service. Please check your network connection.");
  }

  const text = await res.text();

  if (!res.ok) {
    throw new Error(friendlyAuthError(res.status, text));
  }

  let json: { code?: number | string; msg?: string; data?: AuthTokens };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Received an unexpected response from the authentication service.");
  }

  if (String(json.code) !== "0") {
    throw new Error(json.msg || "Invalid username or password. Please try again.");
  }

  if (!json.data?.access_token) {
    throw new Error("Sign-in succeeded but no session was returned. Please contact your administrator.");
  }

  return json.data;
}

export async function refreshToken(token: string): Promise<AuthTokens> {
  let res: Response;
  try {
    res = await fetch(`${IAM_BASE_URL}/auth/token/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: token }),
    });
  } catch {
    throw new Error("Unable to refresh session. Please sign in again.");
  }

  const text = await res.text();

  if (!res.ok) {
    throw new Error("Session expired. Please sign in again.");
  }

  let json: { code?: number | string; msg?: string; data?: AuthTokens };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Session refresh failed. Please sign in again.");
  }

  if (String(json.code) !== "0") {
    throw new Error(json.msg || "Session expired. Please sign in again.");
  }

  if (!json.data?.access_token) {
    throw new Error("Session refresh failed. Please sign in again.");
  }

  return json.data;
}

export function decodeJwt(token: string): JwtPayload {
  const base64 = token.split(".")[1];
  const decoded = atob(base64);
  return JSON.parse(decoded);
}

export function getWmsHeaders(accessToken: string, facilityId: string, tenantId: string, timezone: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "x-facility-id": facilityId,
    "x-tenant-id": tenantId,
    "item-time-zone": timezone,
  };
}

async function wmsRequest(method: string, path: string, body: unknown, accessToken: string, facilityId: string, tenantId: string, timezone: string) {
  let res: Response;
  try {
    res = await fetch(`${WMS_API_BASE_URL}${path}`, {
      method,
      headers: getWmsHeaders(accessToken, facilityId, tenantId, timezone),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error("Unable to reach the warehouse service. Please check your network connection.");
  }

  if (!res.ok) {
    throw new Error(friendlyApiError(res.status));
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Received an unexpected response from the warehouse service.");
  }
}

export async function wmsGet(path: string, accessToken: string, facilityId: string, tenantId: string, timezone: string) {
  return wmsRequest("GET", path, null, accessToken, facilityId, tenantId, timezone);
}

export async function wmsPost(path: string, body: unknown, accessToken: string, facilityId: string, tenantId: string, timezone: string) {
  return wmsRequest("POST", path, body, accessToken, facilityId, tenantId, timezone);
}

// --- Domain-specific API calls ---

export async function searchCustomer(
  keyword: string,
  accessToken: string,
  facilityId: string,
  tenantId: string,
  timezone: string
): Promise<WmsCustomer[]> {
  const result = await wmsPost(
    "/mdm/customer/search",
    { keyword, currentPage: 1, pageSize: 20 },
    accessToken, facilityId, tenantId, timezone
  );
  if (result.success !== false && Array.isArray(result.data)) {
    return result.data.map((c: Record<string, unknown>) => ({
      id: c.id || "",
      customerCode: c.customerCode || "",
      customerName: c.customerName || "",
      customerFullName: c.customerFullName || "",
      orgId: c.orgId || "",
    }));
  }
  return [];
}

export async function searchOrders(
  customerId: string,
  page: number,
  pageSize: number,
  accessToken: string,
  facilityId: string,
  tenantId: string,
  timezone: string
): Promise<{ orders: WmsOrder[]; total: number }> {
  const body: Record<string, unknown> = {
    currentPage: page,
    pageSize,
    customerId,
    sortingFields: [{ field: "createdTime", orderBy: "DESC" }],
  };

  const result = await wmsPost(
    "/wms-bam/outbound/order/raw-search",
    body,
    accessToken, facilityId, tenantId, timezone
  );

  if (result.success !== false && Array.isArray(result.data)) {
    const orders: WmsOrder[] = result.data.map((o: Record<string, unknown>) => ({
      id: String(o.id || ""),
      referenceNo: String(o.referenceNo || ""),
      poNo: String(o.poNo || ""),
      status: String(o.status || ""),
      customerId: String(o.customerId || ""),
      createdTime: String(o.createdTime || ""),
      orderedDate: String(o.orderedDate || ""),
      shipTo: String(o.shipTo || ""),
      shipToAddress: o.shipToAddress as WmsOrder["shipToAddress"],
      appointmentTime: o.appointmentTime ? String(o.appointmentTime) : undefined,
      carrierId: o.carrierId ? String(o.carrierId) : undefined,
      bolNo: o.bolNo ? String(o.bolNo) : undefined,
      orderType: o.orderType ? String(o.orderType) : undefined,
      mabd: o.mabd ? String(o.mabd) : undefined,
      scheduleDate: o.scheduleDate ? String(o.scheduleDate) : undefined,
      channel: o.channel ? String(o.channel) : undefined,
      source: o.source ? String(o.source) : undefined,
      itemLineCount: typeof o.itemLineCount === "number" ? o.itemLineCount : undefined,
      itemLineTotalQty: typeof o.itemLineTotalQty === "number" ? o.itemLineTotalQty : undefined,
    }));
    return { orders, total: result.totalCount || orders.length };
  }
  return { orders: [], total: 0 };
}

export async function searchAppointments(
  customerId: string,
  page: number,
  pageSize: number,
  accessToken: string,
  facilityId: string,
  tenantId: string,
  timezone: string
): Promise<{ appointments: WmsAppointment[]; total: number }> {
  const body: Record<string, unknown> = {
    currentPage: page,
    pageSize,
    customerId,
  };

  const result = await wmsPost(
    "/wms-bam/appointment/search-by-paging",
    body,
    accessToken, facilityId, tenantId, timezone
  );

  if (result.success && result.data?.list) {
    const appointments: WmsAppointment[] = result.data.list.map((a: Record<string, unknown>) => ({
      id: String(a.id || ""),
      sid: String(a.sid || ""),
      carrierId: a.carrierId ? String(a.carrierId) : undefined,
      carrierName: a.carrierName ? String(a.carrierName) : undefined,
      appointmentType: String(a.appointmentType || ""),
      appointmentTime: String(a.appointmentTime || ""),
      apptStatus: String(a.apptStatus || ""),
      createdTime: String(a.createdTime || ""),
      customerIds: a.customerIds as string[] | undefined,
      customerNames: a.customerNames as string[] | undefined,
      appointmentActions: a.appointmentActions as WmsAppointment["appointmentActions"],
    }));
    return { appointments, total: result.data.totalCount || appointments.length };
  }
  return { appointments: [], total: 0 };
}
