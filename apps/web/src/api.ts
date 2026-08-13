import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export interface LocalServiceStatus {
  running: boolean;
  port: number;
  portOpen: boolean;
  nodeRuntimeFound: boolean;
  serverBundleFound: boolean;
  lastError?: string;
  lastExit?: string;
  lastOutput?: string;
}

export async function apiGet<T>(path: string): Promise<T> {
  const url = await apiUrl(path);
  const response = await fetchLocal(url, { headers: await apiHeaders() });
  if (!response.ok) throw new Error(await errorText(response));
  return response.json() as Promise<T>;
}

export async function apiSend<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const url = await apiUrl(path);
  const response = await fetchLocal(url, {
    ...init,
    method: init.method ?? "POST",
    body: init.body ?? "{}",
    headers: await apiHeaders({ "content-type": "application/json", ...(init.headers ?? {}) })
  });
  if (!response.ok) throw new Error(await errorText(response));
  return response.json() as Promise<T>;
}

export async function apiDownload(path: string, filename: string): Promise<void> {
  const url = await apiUrl(path);
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

export async function apiUrl(path: string): Promise<string> {
  if (/^https?:\/\//.test(path)) throw new Error("WardSen API paths must be local application paths, not absolute URLs.");
  if (isTauriOrigin()) return `${await localServiceBaseUrl()}${path}`;
  return path;
}

export function canRestartLocalService(): boolean {
  return isTauriOrigin();
}

export function canLaunchTerminalSession(): boolean {
  return isTauriOrigin();
}

export async function restartLocalService(): Promise<void> {
  if (!canRestartLocalService()) return;
  await invoke("restart_local_service");
}

export async function openTerminalSession(accountId: string, launchId: string): Promise<void> {
  if (!accountId.trim() || !launchId.trim()) throw new Error("WardSen did not receive a terminal launch reference.");
  if (!canLaunchTerminalSession()) throw new Error("Automatic terminal launch is available only from the WardSen desktop app.");
  await invoke("open_terminal_session", { accountId, launchId });
}

export async function getLocalServiceStatus(): Promise<LocalServiceStatus | undefined> {
  if (!canRestartLocalService()) return undefined;
  return invoke<LocalServiceStatus>("local_service_status");
}

export async function openExternalUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("WardSen can only open HTTP or HTTPS help links.");
  }

  if (isTauriOrigin()) {
    await openUrl(parsed.toString());
    return;
  }

  const opened = window.open(parsed.toString(), "_blank", "noopener,noreferrer");
  if (!opened) {
    window.location.assign(parsed.toString());
  }
}

export async function openMailDraft(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "mailto:") {
    throw new Error("WardSen can only open mail draft links with the mailto protocol.");
  }

  if (isTauriOrigin()) {
    await openUrl(parsed.toString());
    return;
  }

  window.location.href = parsed.toString();
}

export async function copyExternalUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("WardSen can only copy HTTP or HTTPS help links.");
  }

  await copyTextToClipboard(parsed.toString());
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (!text.trim()) throw new Error("Nothing was available to copy.");

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const input = document.createElement("input");
  input.value = text;
  input.readOnly = true;
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard copy was blocked by the browser.");
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

async function localServiceBaseUrl(): Promise<string> {
  const value = await invoke<string>("get_local_service_url");
  const parsed = new URL(value);
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    !parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("WardSen desktop returned an invalid local service address.");
  }
  return parsed.origin;
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
    throw new Error(`Could not connect to WardSen local service at ${url}. Use Restart service and retry in the desktop app, or close and reopen WardSen. Browser detail: ${detail}`);
  }
}
