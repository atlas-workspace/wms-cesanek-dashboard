"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    router.replace("/dashboard");
    return (
      <main className="login-shell">
        <div style={{ textAlign: "center" }}>
          <div className="logo">C</div>
          <p style={{ color: "#9aa8c7", marginTop: 12 }}>Redirecting to dashboard...</p>
        </div>
      </main>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const username = String(form.get("username") || "").trim();
    const password = String(form.get("password") || "");
    try {
      await login(username, password);
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="logo">C</div>
        <h1>Cesanek WMS</h1>
        <p className="subtitle">Facility LT_F21 Operations Dashboard</p>
        <form onSubmit={handleSubmit} className="form">
          <label>Username<input name="username" autoComplete="username" defaultValue="ecambra" required /></label>
          <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
          {error && <div className="notice" style={{ borderColor: "#f87171", background: "#1c0505", color: "#fca5a5" }}>{error}</div>}
          <button type="submit" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</button>
        </form>
        <div className="context">Context: Tenant LT / Facility LT_F21 / America/New_York</div>
      </section>
    </main>
  );
}
