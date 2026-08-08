export function getApiBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_TUNTAS_API_BASE_URL;
  if (!base) {
    throw new Error(
      "NEXT_PUBLIC_TUNTAS_API_BASE_URL is required. Set it in .env.local (e.g. http://localhost:8001).",
    );
  }
  return base.replace(/\/$/, "");
}

export function isDemoAuthEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TUNTAS_DEMO_AUTH === "true";
}

export function getDemoAuthHeaders(): Record<string, string> {
  if (!isDemoAuthEnabled()) return {};
  // Only allow demo headers when explicitly enabled via env (dev).
  // Production builds should set NEXT_PUBLIC_TUNTAS_DEMO_AUTH=false.
  return {
    "X-Demo-Role": process.env.NEXT_PUBLIC_TUNTAS_DEMO_ROLE || "manager",
    "X-Demo-Actor": process.env.NEXT_PUBLIC_TUNTAS_DEMO_ACTOR || "demo-manager",
  };
}

export function getDemoSseQuery(): Record<string, string> {
  if (!isDemoAuthEnabled()) return {};
  return {
    demo_role: process.env.NEXT_PUBLIC_TUNTAS_DEMO_ROLE || "manager",
    demo_actor: process.env.NEXT_PUBLIC_TUNTAS_DEMO_ACTOR || "demo-manager",
  };
}

let bearerToken: string | null = null;

export function setBearerToken(token: string | null) {
  bearerToken = token;
}

export function getBearerToken(): string | null {
  return bearerToken;
}
