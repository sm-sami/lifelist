import Constants from "expo-constants";

const BASE = (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? "";

// Stub: integration/001 will replace this with a JWT-injecting version.
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}
