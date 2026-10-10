// Клиент к нашему API: подставляет адрес кошелька и разворачивает ошибки.
let currentWallet = "";

export function setApiWallet(w: string) {
  currentWallet = w;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(currentWallet ? { "x-wallet": currentWallet } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const post = <T,>(path: string, payload?: unknown) =>
  api<T>(path, { method: "POST", body: payload === undefined ? undefined : JSON.stringify(payload) });
export const patch = <T,>(path: string, payload: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(payload) });
export const del = <T,>(path: string) => api<T>(path, { method: "DELETE" });
