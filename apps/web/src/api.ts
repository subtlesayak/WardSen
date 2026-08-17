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

interface LocalServiceProxyResponse {
  statusCode: number;
  body: string;
  contentType: string;
}

export async function apiGet<T>(path: string): Promise<T> {
  const url = await apiUrl(path);
  if (isTauriOrigin()) return tauriJson<T>(url, "GET");
  const response = await fetchLocal(url);
  if (!response.ok) throw new Error(await errorText(response));
  return response.json() as Promise<T>;
}

export async function apiSend<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const url = await apiUrl(path);
  const method = init.method ?? "POST";
  const body = requestBodyText(init.body ?? "{}");
  if (isTauriOrigin()) return tauriJson<T>(url, method, body, init.headers);
  const response = await fetchLocal(url, {
    ...init,
    method,
    body,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) }
  });
  if (!response.ok) throw new Error(await errorText(response));
  return response.json() as Promise<T>;
}

export async function apiDownload(path: string, filename: string): Promise<void> {
  const url = await apiUrl(path);
  const blob = isTauriOrigin()
    ? await tauriDownload(url)
    : await browserDownload(url);
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

async function tauriJson<T>(path: string, method: string, body?: string, headers?: HeadersInit): Promise<T> {
  const response = await proxyLocalService(path, method, body, headers);
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(errorTextValue(response.body, response.statusCode));
  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new Error("WardSen local service returned an invalid JSON response.");
  }
}

async function tauriDownload(path: string): Promise<Blob> {
  const response = await proxyLocalService(path, "GET");
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(errorTextValue(response.body, response.statusCode));
  return new Blob([response.body], { type: response.contentType });
}

async function browserDownload(url: string): Promise<Blob> {
  const response = await fetchLocal(url);
  if (!response.ok) throw new Error(await errorText(response));
  return response.blob();
}

async function proxyLocalService(path: string, method: string, body?: string, headers?: HeadersInit): Promise<LocalServiceProxyResponse> {
  const employeeSession = employeeSessionHeader(headers);
  try {
    return await invoke<LocalServiceProxyResponse>("proxy_local_service_request", {
      request: { path, method, body, employeeSession }
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not connect to WardSen local service. Use Restart service and retry in the desktop app, or close and reopen WardSen. Desktop detail: ${detail}`);
  }
}

function employeeSessionHeader(headers: HeadersInit | undefined): string | undefined {
  if (!headers) return undefined;
  const normalized = new Headers(headers);
  return normalized.get("x-wardsen-employee-session") ?? undefined;
}

function requestBodyText(body: BodyInit): string {
  if (typeof body === "string") return body;
  throw new Error("WardSen local API requests must use a JSON string body.");
}

async function errorText(response: Response): Promise<string> {
  return errorTextValue(await response.text(), response.status);
}

function errorTextValue(text: string, status: number): string {
  if (!text.trim()) return `Request failed with HTTP ${status}`;
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
