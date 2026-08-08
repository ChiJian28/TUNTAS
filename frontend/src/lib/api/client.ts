import axios, { type AxiosInstance, type AxiosRequestConfig } from "axios";
import {
  getApiBaseUrl,
  getBearerToken,
  getDemoAuthHeaders,
  isDemoAuthEnabled,
} from "./auth";
import { normalizeApiError } from "./errors";

export const LONG_TIMEOUT_MS = 300_000;
export const DEFAULT_TIMEOUT_MS = 30_000;

function buildClient(): AxiosInstance {
  const instance = axios.create({
    timeout: DEFAULT_TIMEOUT_MS,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });

  instance.interceptors.request.use((config) => {
    config.baseURL = getApiBaseUrl();
    const token = getBearerToken();
    if (token) {
      config.headers.set("Authorization", `Bearer ${token}`);
    } else if (isDemoAuthEnabled()) {
      const demo = getDemoAuthHeaders();
      Object.entries(demo).forEach(([k, v]) => config.headers.set(k, v));
    }
    return config;
  });

  instance.interceptors.response.use(
    (res) => res,
    (error) => {
      const endpoint =
        error?.config?.url != null
          ? `${error.config.method?.toUpperCase() ?? "?"} ${error.config.baseURL ?? ""}${error.config.url}`
          : undefined;
      return Promise.reject(normalizeApiError(error, endpoint));
    },
  );

  return instance;
}

export const api: AxiosInstance = buildClient();

export async function apiGet<T>(
  path: string,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await api.get<T>(path, config);
  return res.data;
}

export async function apiPost<T>(
  path: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = await api.post<T>(path, body, {
    timeout: LONG_TIMEOUT_MS,
    ...config,
  });
  return res.data;
}

export type ApiTraceEntry = {
  id: string;
  method: string;
  path: string;
  status?: number;
  ms: number;
  at: string;
  error?: string;
};

type TraceListener = (entry: ApiTraceEntry) => void;
const listeners = new Set<TraceListener>();

export function subscribeApiTrace(listener: TraceListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitApiTrace(entry: ApiTraceEntry) {
  listeners.forEach((l) => l(entry));
}

api.interceptors.request.use((config) => {
  (config as AxiosRequestConfig & { __startedAt?: number }).__startedAt = Date.now();
  return config;
});

api.interceptors.response.use(
  (res) => {
    const started =
      (res.config as AxiosRequestConfig & { __startedAt?: number }).__startedAt ??
      Date.now();
    emitApiTrace({
      id: `${started}-${res.config.url}`,
      method: (res.config.method ?? "get").toUpperCase(),
      path: res.config.url ?? "",
      status: res.status,
      ms: Date.now() - started,
      at: new Date().toISOString(),
    });
    return res;
  },
  (error) => {
    const cfg = error?.config as (AxiosRequestConfig & { __startedAt?: number }) | undefined;
    const started = cfg?.__startedAt ?? Date.now();
    emitApiTrace({
      id: `${started}-${cfg?.url ?? "err"}`,
      method: (cfg?.method ?? "?").toUpperCase(),
      path: cfg?.url ?? "",
      status: error?.status ?? error?.response?.status,
      ms: Date.now() - started,
      at: new Date().toISOString(),
      error: error?.message,
    });
    return Promise.reject(error);
  },
);
