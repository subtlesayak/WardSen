import { invoke } from "@tauri-apps/api/core";

export async function apiGet<T>(path: string): Promise<T> {
  const url = apiUrl(path);
  const response = await fetchLocal(url, { headers: await apiHeaders() });
  if (!response.ok) throw new Error(await errorText(response));
  return response.json() as Promise<T>;
}

export async function apiSend<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const url = apiUrl(path);
  const response = await fetchLocal(url, {
    ...init,
    method: init.method ?? "POST",
    headers: await apiHeaders({ "content-type": "application/json", ...(init.headers ?? {}) })
  });
  if (!response.ok) throw new Error(await errorText(response));
  return response.json() as Promise<T>;
}

export async function apiDownload(path: string, filename: string): Promise<void> {
  const url = apiUrl(path);
  const response = await fetchLocal(url, { headers: await apiHeaders() });
  if (!response.ok) throw new Error(await errorText(response));
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) throw new Error("WardSen API paths must be local application paths, not absolute URLs.");
  if (isTauriOrigin()) return `http://127.0.0.1:4777${path}`;
  return path;
}

function isTauriOrigin(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.protocol === "tauri:" || window.location.hostname === "tauri.localhost";
}

let apiTokenPromise: Promise<string | undefined> | undefined;

async function apiHeaders(headers: HeadersInit = {}): Promise<HeadersInit> {
  const token = await apiToken();
  return token ? { ...headers, "x-wardsen-api-token": token } : headers;
}

async function apiToken(): Promise<string | undefined> {
  if (!isTauriOrigin()) return undefined;
  apiTokenPromise ??= readTauriApiToken();
  return apiTokenPromise;
}

async function readTauriApiToken(): Promise<string | undefined> {
  const token = await invoke<string>("get_api_token");
  return token.trim() || undefined;
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

async function fetchLocal(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not connect to WardSen local service at ${url}. Start or restart WardSen, then retry. Browser detail: ${detail}`);
  }
}
