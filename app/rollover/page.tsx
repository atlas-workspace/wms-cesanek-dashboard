'use client';

import { useState, useEffect } from "react";
import { getStoredTokens } from "../lib/auth";
import LoginForm from "../components/LoginForm";
import ControlCenter from "../components/ControlCenter";

export default function RolloverPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const tokens = getStoredTokens();
    setAuthenticated(!!tokens);
  }, []);

  if (authenticated === null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted text-sm">Loading...</p>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginForm onLoginSuccess={() => setAuthenticated(true)} />;
  }

  return <ControlCenter onLogout={() => setAuthenticated(false)} />;
}
