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
