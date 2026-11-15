const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(
  /\/+$/,
  "",
);

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(
    message: string,
    status: number,
    options?: { code?: string; requestId?: string },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = options?.code;
    this.requestId = options?.requestId;
  }
}

type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue | QueryValue[]>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: QueryParams;
  signal?: AbortSignal;
  /** 不触发自动刷新与未授权回调（登录/刷新自身使用）。 */
  skipAuthRefresh?: boolean;
}

let accessToken: string | null = null;
let refreshHandler: (() => Promise<boolean>) | null = null;
let unauthorizedHandler: (() => void) | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function configureAuth(options: {
  refresh: () => Promise<boolean>;
  onUnauthorized: () => void;
}) {
  refreshHandler = options.refresh;
  unauthorizedHandler = options.onUnauthorized;
}

function buildUrl(path: string, query?: QueryParams): string {
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null || item === "") continue;
        search.append(key, String(item));
      }
    } else {
      search.append(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `${url}?${qs}` : url;
}

function extractMessage(body: unknown, status: number): {
  message: string;
  code?: string;
  requestId?: string;
} {
  if (body && typeof body === "object") {
    const record = body as {
      detail?: unknown;
      message?: unknown;
      error?: unknown;
      code?: unknown;
      request_id?: unknown;
    };
    const detail = record.detail ?? record.message ?? record.error;
    let message: string | null = null;
    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: unknown } | undefined;
      if (first && typeof first === "object" && typeof first.msg === "string") {
        message = first.msg;
      } else if (typeof first === "string") {
        message = first;
      }
    }
    if (message) {
      return {
        message,
        code: typeof record.code === "string" ? record.code : undefined,
        requestId:
          typeof record.request_id === "string" ? record.request_id : undefined,
      };
    }
  }
  return { message: status === 0 ? "网络不可达" : `请求失败（HTTP ${status}）` };
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

async function refreshOnce(): Promise<boolean> {
  if (!refreshHandler) return false;
  if (!refreshInFlight) {
    refreshInFlight = refreshHandler()
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function send(
  path: string,
  options: RequestOptions,
  allowRetry: boolean,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;

  if (options.body !== undefined) {
    if (options.body instanceof FormData) {
      body = options.body;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
  }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      headers,
      body,
      credentials: "include",
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("网络不可达，检查服务端是否在线", 0);
  }

  if (response.status === 401 && allowRetry && !options.skipAuthRefresh) {
    const refreshed = await refreshOnce();
    if (refreshed) return send(path, options, false);
    unauthorizedHandler?.();
  }
  return response;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await send(path, options, true);
  const payload = await parseBody(response);
  if (!response.ok) {
    const { message, code, requestId } = extractMessage(
      payload,
      response.status,
    );
    throw new ApiError(message, response.status, { code, requestId });
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: QueryParams, signal?: AbortSignal) =>
    apiRequest<T>(path, { query, signal }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, { method: "POST", body, ...options }),
  put: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: unknown) =>
    apiRequest<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string, query?: QueryParams) =>
    apiRequest<T>(path, { method: "DELETE", query }),
  /** 原始 Response，用于登录/刷新这类需要自己处理 cookie 的调用。 */
  raw: (path: string, init?: RequestInit) =>
    fetch(`${API_BASE}${path}`, { credentials: "include", ...init }),
};

export { API_BASE };
