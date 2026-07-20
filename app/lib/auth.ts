export const DEFAULT_TENANT = process.env.NEXT_PUBLIC_DEFAULT_TENANT || "LT";
export const DEFAULT_FACILITY = process.env.NEXT_PUBLIC_DEFAULT_FACILITY || "LT_F21";
export const DEFAULT_TIMEZONE = process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || "America/New_York";

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

export interface JwtPayload {
  data?: {
    user_id?: string;
    tenant_id?: string;
    company_code?: string;
    username?: string;
    user_name?: string;
  };
  exp?: number;
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch {
    return null;
  }
}

export async function login(username: string, password: string): Promise<AuthTokens> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const json = await res.json();
  if (!json.success || !json.data?.access_token) {
    throw new Error(json.message || "Login failed");
  }

  return json.data;
}

export function getStoredTokens(): AuthTokens | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("wms_auth_tokens");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function storeTokens(tokens: AuthTokens): void {
  if (typeof window === "undefined") return;
  localStorage.setItem("wms_auth_tokens", JSON.stringify(tokens));
}

export function clearTokens(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("wms_auth_tokens");
}

export function getUserInfo(tokens: AuthTokens) {
  const payload = decodeJwtPayload(tokens.access_token);
  if (!payload?.data) return null;
  return {
    userId: payload.data.user_id || "",
    tenantId: payload.data.tenant_id || payload.data.company_code || DEFAULT_TENANT,
    username: payload.data.user_name || payload.data.username || "",
  };
}

export function isTokenExpired(tokens: AuthTokens): boolean {
  const payload = decodeJwtPayload(tokens.access_token);
  if (!payload?.exp) return false;
  return Date.now() / 1000 > payload.exp - 60;
}
