"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

interface AuthState {
  token: string | null;
  username: string | null;
}

interface AuthContextType extends AuthState {
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  facilityId: string;
  tenantId: string;
  timezone: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

const FACILITY_ID = "LT_F21";
const TENANT_ID = "LT";
const TIMEZONE = "America/New_York";
const STORAGE_KEY = "cesanekSession";

function loadStored(): AuthState {
  if (typeof window === "undefined") return { token: null, username: null };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { token: null, username: null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ token: null, username: null });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(loadStored());
    setHydrated(true);
  }, []);

  const handleLogin = useCallback(async (username: string, password: string) => {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const json = await res.json();
    if (!res.ok || !json.token) {
      throw new Error(json.error || "Unable to sign in. Please check your credentials.");
    }
    const newState = { token: json.token, username };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
    setState(newState);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setState({ token: null, username: null });
  }, []);

  if (!hydrated) {
    return (
      <div className="login-shell" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div className="logo">C</div>
          <p style={{ color: "#9aa8c7", marginTop: 12 }}>Loading Cesanek WMS...</p>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        ...state,
        isAuthenticated: !!state.token,
        login: handleLogin,
        logout,
        facilityId: FACILITY_ID,
        tenantId: TENANT_ID,
        timezone: TIMEZONE,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
