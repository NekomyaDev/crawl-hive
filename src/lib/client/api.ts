// Клиент к нашему API: подставляет токен сессии кошелька и разворачивает ошибки.
let session = "";

export function setApiSession(token: string) {
  session = token;
}

// Токен сессии как есть: для серверных функций (server actions), которые идут не через api().
export const apiSession = () => session;

// Заголовок сессии для запросов в обход api(), например потоковых (Ask CrawlHive).
export const sessionHeaders = (): Record<string, string> => (session ? { Authorization: `Bearer ${session}` } : {});

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session}` } : {}),
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
