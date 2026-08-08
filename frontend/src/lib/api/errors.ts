import axios from "axios";

export type ApiErrorDetail =
  | string
  | { message?: string; flags?: unknown[]; [key: string]: unknown }
  | Array<{ loc?: Array<string | number>; msg?: string; type?: string }>;

export class TuntasApiError extends Error {
  status: number;
  detail: ApiErrorDetail;
  endpoint?: string;
  code?: string;

  constructor(opts: {
    message: string;
    status: number;
    detail: ApiErrorDetail;
    endpoint?: string;
    code?: string;
  }) {
    super(opts.message);
    this.name = "TuntasApiError";
    this.status = opts.status;
    this.detail = opts.detail;
    this.endpoint = opts.endpoint;
    this.code = opts.code;
  }
}

function detailToMessage(detail: ApiErrorDetail, fallback: string): string {
  if (typeof detail === "string") return detail || fallback;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        const loc = item.loc?.join(".") ?? "";
        return loc ? `${loc}: ${item.msg ?? "invalid"}` : (item.msg ?? "invalid");
      })
      .filter(Boolean);
    return parts.length ? parts.join("; ") : fallback;
  }
  if (detail && typeof detail === "object") {
    if (typeof detail.message === "string" && detail.message) return detail.message;
    try {
      return JSON.stringify(detail);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function normalizeApiError(error: unknown, endpoint?: string): TuntasApiError {
  if (error instanceof TuntasApiError) return error;

  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? 0;
    const raw = error.response?.data as { detail?: ApiErrorDetail } | undefined;
    const detail: ApiErrorDetail = raw?.detail ?? error.message ?? "Request failed";
    const message = userFacingMessage(status, detailToMessage(detail, error.message));
    return new TuntasApiError({ message, status, detail, endpoint });
  }

  if (error instanceof Error) {
    return new TuntasApiError({
      message: error.message,
      status: 0,
      detail: error.message,
      endpoint,
    });
  }

  return new TuntasApiError({
    message: "Unknown error",
    status: 0,
    detail: String(error),
    endpoint,
  });
}

export function userFacingMessage(status: number, detail: string): string {
  switch (status) {
    case 401:
      return `Unauthorized — ${detail}`;
    case 403:
      return `Forbidden — ${detail}`;
    case 404:
      return `Not found — ${detail}`;
    case 409:
      return `Conflict — ${detail}`;
    case 422:
      return `Validation error — ${detail}`;
    case 500:
      return `Server error — ${detail}`;
    case 0:
      return `Network / timeout — ${detail}`;
    default:
      return detail || `HTTP ${status}`;
  }
}

export function extractCriticalFlags(error: TuntasApiError): unknown[] {
  if (error.detail && typeof error.detail === "object" && !Array.isArray(error.detail)) {
    const flags = error.detail.flags;
    return Array.isArray(flags) ? flags : [];
  }
  return [];
}
