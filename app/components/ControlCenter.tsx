'use client';

import { useState, useEffect, useCallback, useRef } from "react";
import { OutboundOrder, fetchAllOrders } from "../lib/wms-api";
import { getStoredTokens, getUserInfo, isTokenExpired, clearTokens, DEFAULT_FACILITY, DEFAULT_TIMEZONE, DEFAULT_TENANT } from "../lib/auth";
import { loadPreferences, savePreferences, DensityMode } from "../lib/preferences";
import { KPIData, AttentionItem, Recommendation, CarrierPerformance, CustomerImpact, computeKPIs, computeAttentionItems, computeRecommendations, computeCarrierPerformance, computeCustomerImpact } from "../lib/kpi-engine";
import { syncTracker, SyncMetrics } from "../lib/sync-metrics";
import { transactionLog, Transaction } from "../lib/transaction-service";
import { exceptionQueue, ExceptionItem } from "../lib/exception-queue";
import { ticketQueue, PendingTicket } from "../lib/ticket-service";
import { auditLog } from "../lib/audit-service";
import SystemHealthBanner from "./SystemHealthBanner";
import KPICards from "./KPICards";
import AttentionPanel from "./AttentionPanel";
import OrderTable from "./OrderTable";
import ShipmentDrawer from "./ShipmentDrawer";
import DashboardFooter from "./DashboardFooter";
import SyncPanel from "./SyncPanel";

interface ControlCenterProps {
  onLogout: () => void;
}

export default function ControlCenter({ onLogout }: ControlCenterProps) {
  const [orders, setOrders] = useState<OutboundOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [wmsConnected, setWmsConnected] = useState(true);
  const [density, setDensity] = useState<DensityMode>("standard");
  const [kpiFilter, setKpiFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<OutboundOrder | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [syncPanelOpen, setSyncPanelOpen] = useState(false);
  const [activeView, setActiveView] = useState<"live" | "rollover" | "all">("live");
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [kpis, setKpis] = useState<KPIData | null>(null);
  const [attentionItems, setAttentionItems] = useState<AttentionItem[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [carrierPerf, setCarrierPerf] = useState<CarrierPerformance[]>([]);
  const [customerImpact, setCustomerImpact] = useState<CustomerImpact[]>([]);
  const [syncMetrics, setSyncMetrics] = useState<SyncMetrics | null>(null);
  const [exceptions, setExceptions] = useState<ExceptionItem[]>([]);
  const [pendingTickets, setPendingTickets] = useState<PendingTicket[]>([]);
  const [recentTxns, setRecentTxns] = useState<Transaction[]>([]);

  useEffect(() => {
    const prefs = loadPreferences();
    setDensity(prefs.density);
    setActiveView(prefs.activeView);
    setKpiFilter(prefs.kpiFilter);
  }, []);

  const fetchData = useCallback(async () => {
    const tokens = getStoredTokens();
    if (!tokens) { onLogout(); return; }
    if (isTokenExpired(tokens)) { clearTokens(); onLogout(); return; }

    const info = getUserInfo(tokens);
    if (info) setUsername(info.username);

    setLoading(true);
    setError("");

    const startTime = Date.now();

    try {
      const result = await fetchAllOrders(tokens.access_token, {
        facilityId: DEFAULT_FACILITY,
        timezone: DEFAULT_TIMEZONE,
        tenantId: info?.tenantId || DEFAULT_TENANT,
      });

      const allOrders = result.records;

      const responseTime = Date.now() - startTime;
      syncTracker.recordApiCall(true, responseTime);
      syncTracker.recordSyncComplete();
      syncTracker.setNextScheduledSync(new Date(Date.now() + 10 * 60 * 1000).toISOString());

      setOrders(allOrders);
      setWmsConnected(true);
      setLastSync(new Date());

      setKpis(computeKPIs(allOrders, DEFAULT_TIMEZONE));
      setAttentionItems(computeAttentionItems(allOrders));
      setRecommendations(computeRecommendations(allOrders));
      setCarrierPerf(computeCarrierPerformance(allOrders));
      setCustomerImpact(computeCustomerImpact(allOrders));

      auditLog.append({
        userId: info?.userId || "unknown",
        username: info?.username || "unknown",
        orderId: "*",
        actionType: "sync_complete",
        previousValue: null,
        updatedValue: { orderCount: allOrders.length, responseTime },
        apiAction: "Live WMS data sync",
        transactionId: null,
        wmsResponseStatus: 200,
        ticketId: null,
        notificationStatus: null,
        source: "wms_sync",
      });
    } catch (err) {
      const responseTime = Date.now() - startTime;
      syncTracker.recordApiCall(false, responseTime);
      syncTracker.recordSyncFailure();

      setError(err instanceof Error ? err.message : "Failed to load data");
      setWmsConnected(false);

      exceptionQueue.add({
        orderId: "*",
        type: "sync_failed",
        description: err instanceof Error ? err.message : "WMS sync failed",
        maxRetries: 3,
        assignedUser: null,
      });
    } finally {
      setLoading(false);
      setSyncMetrics(syncTracker.getMetrics());
      setExceptions(exceptionQueue.getOpen());
      setPendingTickets(ticketQueue.getPending());
      setRecentTxns(transactionLog.getRecent(10));
    }
  }, [onLogout]);

  useEffect(() => {
    fetchData();
    refreshRef.current = setInterval(fetchData, 10 * 60 * 1000);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [fetchData]);

  function handleDensityChange(d: DensityMode) {
    setDensity(d);
    savePreferences({ density: d });
  }

  function handleKpiClick(filter: string | null) {
    const newFilter = kpiFilter === filter ? null : filter;
    setKpiFilter(newFilter);
    savePreferences({ kpiFilter: newFilter });
  }

  function handleViewChange(view: "live" | "rollover" | "all") {
    setActiveView(view);
    savePreferences({ activeView: view });
  }

  function handleOrderClick(order: OutboundOrder) {
    setSelectedOrder(order);
    setDrawerOpen(true);
    setSyncPanelOpen(false);
  }

  function handleCloseDrawer() {
    setDrawerOpen(false);
    setSelectedOrder(null);
  }

  function handleOpenSyncPanel() {
    setSyncPanelOpen(true);
    setDrawerOpen(false);
    setSelectedOrder(null);
    setSyncMetrics(syncTracker.getMetrics());
    setExceptions(exceptionQueue.getOpen());
    setPendingTickets(ticketQueue.getPending());
    setRecentTxns(transactionLog.getRecent(10));
  }

  const filteredOrders = filterOrders(orders, kpiFilter, searchQuery, activeView);
  const sidePanelOpen = drawerOpen || syncPanelOpen;

  return (
    <div className="flex flex-col min-h-screen">
      <SystemHealthBanner
        wmsConnected={wmsConnected}
        lastSync={lastSync}
        loading={loading}
        username={username}
        density={density}
        syncMetrics={syncMetrics}
        onDensityChange={handleDensityChange}
        onLogout={() => { clearTokens(); onLogout(); }}
        onRefresh={fetchData}
        onOpenSyncPanel={handleOpenSyncPanel}
      />

      <div className={`flex-1 overflow-auto scrollbar-thin ${sidePanelOpen ? "mr-[480px]" : ""} transition-[margin] duration-200`}>
        {kpis && (
          <KPICards kpis={kpis} activeFilter={kpiFilter} onFilterClick={handleKpiClick} />
        )}

        {attentionItems.length > 0 && (
          <AttentionPanel items={attentionItems} onOrderClick={(id) => {
            const o = orders.find(x => x.id === id);
            if (o) handleOrderClick(o);
          }} />
        )}

        {error && (
          <div className="mx-4 mt-3 rounded-lg border border-danger/30 bg-danger-dim px-4 py-3" role="alert">
            <div className="flex items-center justify-between">
              <p className="text-sm text-danger">{error}</p>
              <button onClick={fetchData} className="ml-4 rounded-md bg-danger/20 px-3 py-1 text-xs font-medium text-danger hover:bg-danger/30">Retry</button>
            </div>
          </div>
        )}

        <div className="px-4 pt-3">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex rounded-lg border border-border overflow-hidden">
              {(["live", "rollover", "all"] as const).map(v => (
                <button
                  key={v}
                  onClick={() => handleViewChange(v)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${activeView === v ? "bg-primary text-white" : "bg-surface text-muted hover:text-foreground"}`}
                >
                  {v === "live" ? "Live Appointments" : v === "rollover" ? "Rollover Queue" : "All Orders"}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Search DN, Load, Customer, Carrier, PO..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="flex-1 max-w-md rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary"
            />
            {(searchQuery || kpiFilter) && (
              <button onClick={() => { setSearchQuery(""); handleKpiClick(null); }} className="text-xs text-muted hover:text-foreground">
                Clear Filters
              </button>
            )}
            <span className="ml-auto text-xs text-muted">
              {loading ? "Syncing from WMS..." : `${filteredOrders.length} of ${orders.length} orders`}
            </span>
          </div>
        </div>

        <OrderTable
          orders={filteredOrders}
          loading={loading}
          density={density}
          onOrderClick={handleOrderClick}
          recommendations={recommendations}
          wmsConnected={wmsConnected}
          onRequestRefresh={fetchData}
        />

        <div className="px-4 py-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
          <CarrierWidget carriers={carrierPerf} />
          <CustomerWidget customers={customerImpact} />
        </div>

        {kpis && <DashboardFooter kpis={kpis} orders={orders} />}
      </div>

      {drawerOpen && selectedOrder && (
        <ShipmentDrawer
          order={selectedOrder}
          recommendations={recommendations.filter(r => r.orderId === selectedOrder.id)}
          wmsConnected={wmsConnected}
          onClose={handleCloseDrawer}
          onRequestRefresh={fetchData}
        />
      )}

      {syncPanelOpen && (
        <SyncPanel
          syncMetrics={syncMetrics}
          exceptions={exceptions}
          pendingTickets={pendingTickets}
          recentTransactions={recentTxns}
          onClose={() => setSyncPanelOpen(false)}
        />
      )}
    </div>
  );
}

function filterOrders(orders: OutboundOrder[], kpiFilter: string | null, search: string, view: string): OutboundOrder[] {
  let filtered = orders;

  if (view === "live") {
    filtered = filtered.filter(o => !["SHIPPED", "COMPLETED", "CANCELLED"].includes((o.status || "").toUpperCase()));
  } else if (view === "rollover") {
    filtered = filtered.filter(o => {
      const s = (o.status || "").toUpperCase();
      return s === "PLANNED" && o.appointmentTime && new Date(o.appointmentTime).getTime() < Date.now();
    });
  }

  if (kpiFilter === "missed") {
    filtered = filtered.filter(o => o.appointmentTime && new Date(o.appointmentTime).getTime() < Date.now() && !["SHIPPED", "COMPLETED", "CANCELLED", "LOADED"].includes((o.status || "").toUpperCase()));
  } else if (kpiFilter === "exception") {
    filtered = filtered.filter(o => (o.status || "").toUpperCase() === "COMMIT_FAILED" || !!o.exceptionReason);
  } else if (kpiFilter === "completed") {
    filtered = filtered.filter(o => ["SHIPPED", "COMPLETED", "LOADED"].includes((o.status || "").toUpperCase()));
  }

  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(o =>
      (o.id || "").toLowerCase().includes(q) ||
      (o.loadNo || "").toLowerCase().includes(q) ||
      (o.shipToName || "").toLowerCase().includes(q) ||
      (o.carrierId || "").toLowerCase().includes(q) ||
      (o.poNo || "").toLowerCase().includes(q) ||
      (o.referenceNo || "").toLowerCase().includes(q) ||
      (o.customerName || "").toLowerCase().includes(q)
    );
  }

  return filtered;
}

function CarrierWidget({ carriers }: { carriers: CarrierPerformance[] }) {
  if (carriers.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">Carrier Performance</h3>
      <div className="space-y-2">
        {carriers.slice(0, 5).map(c => (
          <div key={c.carrierId} className="flex items-center justify-between text-xs">
            <span className="text-muted-light truncate max-w-[140px]" title={c.carrierId}>{c.carrierId}</span>
            <div className="flex items-center gap-3">
              <span className="text-danger">{c.missed} missed</span>
              <span className="text-muted">{c.avgDelay}d avg</span>
              <span className="text-success">{c.completedPct}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomerWidget({ customers }: { customers: CustomerImpact[] }) {
  if (customers.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">Customer Impact</h3>
      <div className="space-y-2">
        {customers.slice(0, 5).map(c => (
          <div key={c.customerId} className="flex items-center justify-between text-xs">
            <span className="text-muted-light truncate max-w-[140px]" title={c.customerName}>{c.customerName}</span>
            <div className="flex items-center gap-3">
              <span className="text-danger">{c.missedLoads} missed</span>
              <span className="text-muted">{c.avgDelay}d avg</span>
              {c.oldestOpen && <span className="text-warning">since {new Date(c.oldestOpen).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
