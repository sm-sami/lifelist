import { supabase } from "@/lib/supabase";
import Constants from "expo-constants";

const configuredBase = (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)
  ?.apiBaseUrl;

if (!configuredBase) {
  throw new Error("Missing Expo extra.apiBaseUrl");
}

const API_BASE = configuredBase.replace(/\/+$/, "");
const DEFAULT_TIMEOUT_MS = 15_000;
const GET_RETRIES = 2;
const RETRY_BACKOFF_MS = 400;

export interface ApiFetchInit extends RequestInit {
  timeoutMs?: number;
  signal?: AbortSignal | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
    public authInvalid = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NetworkError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "NetworkError";
  }
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function isAuthInvalid(status: number, body: unknown): boolean {
  if (status !== 401) return false;
  const payload = body as { error?: string; code?: string } | null;
  const code = payload?.code ?? payload?.error;
  return code === "token_invalid" || code === "token_expired";
}

function withTimeout(
  external: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(external?.reason);

  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }

  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (external) external.removeEventListener("abort", onExternalAbort);
    },
  };
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function apiFetch(path: string, init: ApiFetchInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const isIdempotent = method === "GET" || method === "HEAD";
  const maxAttempts = isIdempotent ? GET_RETRIES + 1 : 1;
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const token = await getAccessToken();
    const headers = new Headers(init.headers);

    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const { signal, cleanup } = withTimeout(init.signal, timeoutMs);

    try {
      const res = await fetch(`${API_BASE}${normalizePath(path)}`, {
        ...init,
        headers,
        signal,
      });

      if (res.status === 401) {
        const body = await res
          .clone()
          .json()
          .catch(() => null);
        const authInvalid = isAuthInvalid(res.status, body);
        if (authInvalid) await supabase.auth.signOut({ scope: "local" });
        throw new ApiError(
          401,
          (body as { error?: string } | null)?.error ?? "Unauthorized",
          body,
          authInvalid,
        );
      }

      return res;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (init.signal?.aborted) throw new NetworkError("Request cancelled", err);
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await sleep(RETRY_BACKOFF_MS * (attempt + 1));
        continue;
      }
      throw new NetworkError(method === "GET" ? "Network request failed" : "Request failed", err);
    } finally {
      cleanup();
    }
  }

  throw new NetworkError("Network request failed", lastErr);
}

export async function apiJson<T>(path: string, init?: ApiFetchInit): Promise<T> {
  const res = await apiFetch(path, init);
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ApiError(
      res.status,
      (body as { error?: string } | null)?.error ?? res.statusText,
      body,
      isAuthInvalid(res.status, body),
    );
  }

  return body as T;
}
