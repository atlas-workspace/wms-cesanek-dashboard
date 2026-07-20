import { DEFAULT_FACILITY, DEFAULT_TIMEZONE, DEFAULT_TENANT } from "./auth";

export interface OutboundOrder {
  id: string;
  orderNo?: string;
  orderType?: string;
  status?: string;
  commitmentStatus?: string;
  appointmentTime?: string;
  shipMethod?: string;
  loadNo?: string;
  referenceNo?: string;
  referenceNo01?: string;
  carrierId?: string;
  carrierName?: string;
  customerId?: string;
  customerName?: string;
  retailerId?: string;
  shipToName?: string;
  shipToCity?: string;
  shipToState?: string;
  shipToZip?: string;
  shipFromName?: string;
  totalQty?: number;
  totalWeight?: number;
  waveNo?: string;
  priority?: number;
  createdTime?: string;
  orderedDate?: string;
  scheduleDate?: string;
  shippedTime?: string;
  packedTime?: string;
  appointmentId?: string;
  apptNo?: string;
  apptStatus?: string;
  inYardTime?: string;
  canceledDate?: string;
  poNo?: string;
  bolNo?: string;
  proNo?: string;
  mbolNo?: string;
  freightTerm?: string;
  source?: string;
  exceptionReason?: string;
  slaStatus?: string;
  containerSize?: string;
  isInternational?: boolean;
}

export interface SearchResult {
  records: OutboundOrder[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  totalPage: number;
}

export interface OrderSearchFilters {
  orderTypes?: string[];
  shipMethods?: string[];
  statuses?: string[];
  appointmentFilter?: "all" | "has_appointment" | "no_appointment";
  appointmentTimeFrom?: string;
  appointmentTimeTo?: string;
}

function mapRawOrder(raw: Record<string, unknown>): OutboundOrder {
  const shipTo = raw.shipToAddress as Record<string, unknown> | undefined;
  const shipFrom = raw.shipFromAddress as Record<string, unknown> | undefined;
  const soldTo = raw.soldToAddress as Record<string, unknown> | undefined;
  return {
    id: raw.id as string,
    orderNo: raw.id as string,
    orderType: raw.orderType as string | undefined,
    status: raw.status as string | undefined,
    commitmentStatus: raw.commitmentStatus as string | undefined,
    appointmentTime: raw.appointmentTime as string | undefined,
    shipMethod: raw.shipMethod as string | undefined,
    loadNo: raw.loadNo as string | undefined,
    referenceNo: raw.referenceNo as string | undefined,
    referenceNo01: raw.referenceNo01 as string | undefined,
    carrierId: raw.carrierId as string | undefined,
    carrierName: (raw.carrierId as string) || undefined,
    customerId: raw.customerId as string | undefined,
    customerName: soldTo?.name as string || raw.customerId as string || undefined,
    retailerId: raw.retailerId as string | undefined,
    shipToName: shipTo?.name as string | undefined,
    shipToCity: shipTo?.city as string | undefined,
    shipToState: shipTo?.state as string | undefined,
    shipToZip: shipTo?.zipCode as string | undefined,
    shipFromName: shipFrom?.name as string | undefined,
    totalQty: raw.totalQty as number | undefined,
    totalWeight: raw.totalWeight as number | undefined,
    orderedDate: raw.orderedDate as string | undefined,
    scheduleDate: raw.scheduleDate as string | undefined,
    shippedTime: raw.shippedTime as string | undefined,
    packedTime: raw.packedTime as string | undefined,
    appointmentId: raw.appointmentId as string | undefined,
    apptNo: raw.apptNo as string | undefined,
    apptStatus: raw.apptStatus as string | undefined,
    inYardTime: raw.inYardTime as string | undefined,
    canceledDate: raw.canceledDate as string | undefined,
    poNo: raw.poNo as string | undefined,
    bolNo: raw.bolNo as string | undefined,
    proNo: raw.proNo as string | undefined,
    mbolNo: raw.mbolNo as string | undefined,
    freightTerm: raw.freightTerm as string | undefined,
    source: raw.source as string | undefined,
    exceptionReason: raw.exceptionReason as string | undefined,
    slaStatus: raw.slaStatus as string | undefined,
    containerSize: raw.containerSize as string | undefined,
    isInternational: raw.isInternational as boolean | undefined,
    priority: raw.priority as number | undefined,
    waveNo: raw.waveNo as string | undefined,
    createdTime: raw.createdTime as string | undefined,
  };
}

/**
 * Search outbound orders from live WMS.
 *
 * DEFAULT: orderTypes=["RG"] only. No appointmentTime filter, no shipMethod filter.
 * This ensures all regular orders show, including those without appointments.
 * Appointment and ship method are optional filters the user can apply.
 */
export async function searchOutboundOrders(
  accessToken: string,
  options?: {
    facilityId?: string;
    timezone?: string;
    tenantId?: string;
    page?: number;
    pageSize?: number;
    filters?: OrderSearchFilters;
  }
): Promise<SearchResult> {
  const facility = options?.facilityId || DEFAULT_FACILITY;
  const timezone = options?.timezone || DEFAULT_TIMEZONE;
  const tenant = options?.tenantId || DEFAULT_TENANT;
  const page = options?.page || 1;
  const pageSize = options?.pageSize || 100;
  const filters = options?.filters;

  const body: Record<string, unknown> = {
    currentPage: page,
    pageSize,
    orderTypes: filters?.orderTypes || ["RG"],
  };

  if (filters?.shipMethods && filters.shipMethods.length > 0) {
    body.shipMethods = filters.shipMethods;
  }

  if (filters?.statuses && filters.statuses.length > 0) {
    body.statuses = filters.statuses;
  }

  if (filters?.appointmentTimeFrom) {
    body.appointmentTimeFrom = filters.appointmentTimeFrom;
  }
  if (filters?.appointmentTimeTo) {
    body.appointmentTimeTo = filters.appointmentTimeTo;
  }

  const res = await fetch("/api/wms-proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "x-facility-id": facility,
      "x-tenant-id": tenant,
      "x-timezone": timezone,
    },
    body: JSON.stringify(body),
  });

  const json = await res.json();

  if (!json.success) {
    throw new Error(json.message || "WMS service error");
  }

  const data = json.data || {};
  let list: OutboundOrder[] = (data.list || []).map((raw: Record<string, unknown>) => mapRawOrder(raw));

  if (filters?.appointmentFilter === "has_appointment") {
    list = list.filter(o => !!o.appointmentTime);
  } else if (filters?.appointmentFilter === "no_appointment") {
    list = list.filter(o => !o.appointmentTime);
  }

  return {
    records: list,
    totalCount: data.totalCount || 0,
    currentPage: data.currentPage || page,
    pageSize: data.pageSize || pageSize,
    totalPage: data.totalPage || 1,
  };
}

/**
 * Fetch multiple pages of orders for KPI computation.
 * Default: all RG orders, no appointment/LTL filter.
 */
export async function fetchAllOrders(
  accessToken: string,
  options?: {
    facilityId?: string;
    timezone?: string;
    tenantId?: string;
    filters?: OrderSearchFilters;
    maxPages?: number;
  }
): Promise<{ records: OutboundOrder[]; totalCount: number }> {
  const firstPage = await searchOutboundOrders(accessToken, {
    ...options,
    page: 1,
    pageSize: 200,
  });

  let allRecords = [...firstPage.records];
  const maxPages = options?.maxPages || 5;

  if (firstPage.totalPage > 1) {
    const pages = Math.min(firstPage.totalPage, maxPages);
    for (let p = 2; p <= pages; p++) {
      const nextPage = await searchOutboundOrders(accessToken, {
        ...options,
        page: p,
        pageSize: 200,
      });
      allRecords = [...allRecords, ...nextPage.records];
    }
  }

  return { records: allRecords, totalCount: firstPage.totalCount };
}
