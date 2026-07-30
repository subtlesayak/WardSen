export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path));
  if (!response.ok) throw new Error(await errorText(response));
  return response.json() as Promise<T>;
}

export async function apiSend<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });
  if (!response.ok) throw new Error(await errorText(response));
  return response.json() as Promise<T>;
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (isTauriOrigin()) return `http://127.0.0.1:4777${path}`;
  return path;
}

function isTauriOrigin(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "tauri:" || window.location.hostname === "tauri.localhost";
}

async function errorText(response: Response): Promise<string> {
  const text = await response.text();
  if (!text.trim()) return `Request failed with HTTP ${response.status}`;
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    return text;
  }
  return text;
}
