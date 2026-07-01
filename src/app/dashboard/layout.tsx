"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, type ReactNode, Component } from "react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/sla", label: "SLA Monitoring" },
  { href: "/dashboard/missed-appointments", label: "Appointments" },
  { href: "/dashboard/ltl-appointments", label: "LTL Appointments" },
  { href: "/dashboard/notifications", label: "Notifications" },
];

// Module-level error boundary — isolates each tab so one failure doesn't crash the dashboard
class ModuleErrorBoundary extends Component<{ name: string; children: ReactNode }, { hasError: boolean; error?: string }> {
  constructor(props: { name: string; children: ReactNode }) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(e: Error) { return { hasError: true, error: e.message }; }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, textAlign: "center" }}>
          <p style={{ color: "#fb7185", fontWeight: 700, fontSize: 16 }}>{this.props.name} encountered an issue</p>
          <p style={{ color: "#64748b", fontSize: 13, margin: "8px 0 16px" }}>This module failed independently. Other tabs remain functional.</p>
          <button onClick={() => this.setState({ hasError: false })} className="linkbtn" style={{ fontSize: 12, padding: "8px 16px" }}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated, logout, tenantId, facilityId, timezone } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isAuthenticated) { router.replace("/"); }
  }, [isAuthenticated, router]);

  if (!isAuthenticated) {
    return (
      <div className="login-shell" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <p style={{ color: "#9aa8c7" }}>Redirecting to sign in...</p>
      </div>
    );
  }

  const currentTab = NAV_ITEMS.find(n => pathname === n.href)?.label || "Dashboard";

  return (
    <div className="dash-shell">
      <nav style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap", alignItems: "center" }}>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              background: pathname === item.href ? "#5539f6" : "#16233b",
              color: pathname === item.href ? "#fff" : "#9aa8c7",
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 700,
              border: "1px solid #26344f",
            }}
          >
            {item.label}
          </Link>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#64748b" }}>
          {facilityId} · {tenantId} · {timezone}
        </span>
        <button onClick={logout} className="linkbtn" style={{ fontSize: 12, padding: "6px 12px" }}>
          Sign out
        </button>
      </nav>
      <ModuleErrorBoundary name={currentTab}>
        {children}
      </ModuleErrorBoundary>
    </div>
  );
}
