import { randomUUID } from "node:crypto";
import path from "node:path";
import type {
  ConnectionResult,
  CreateDeliveryInput,
  DeliveryProvider,
  DeliveryProviderCapabilities,
  DeliveryResult,
  DeliveryStatus
} from "@wardsen/core";
import { formatDeliveryCredentialText } from "@wardsen/core";
import { resolveProviderExecutable, runCliCommand, type CliCommandInput, type CliCommandResult } from "@wardsen/security";

export type DeliveryFetch = (input: string, init?: RequestInit) => Promise<Response>;
export type ExternalDeliveryCommandRunner = (input: CliCommandInput) => Promise<CliCommandResult>;

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export interface PasswordPusherDeliveryOptions {
  baseUrl?: string;
  apiToken?: string;
  fetch?: DeliveryFetch;
  now?: () => Date;
}

/** Password Pusher v1 JSON API adapter with authenticated creation, status and expiry. */
export class PasswordPusherDeliveryProvider implements DeliveryProvider {
  readonly id = "password-pusher";
  readonly displayName = "Password Pusher";
  private readonly fetch: DeliveryFetch;
  private readonly now: () => Date;

  constructor(private readonly options: PasswordPusherDeliveryOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? (() => new Date());
  }

  async getCapabilities(): Promise<DeliveryProviderCapabilities> {
    return {
      externalLinks: true,
      recipientEmailRestriction: false,
      arbitraryViewLimit: true,
      viewOnce: true,
      customExpiry: false,
      accessPassword: false,
      hideText: false,
      revokeLink: true,
      accessCount: false,
      statusLookup: true
    };
  }

  async testConnection(_accountId: string): Promise<ConnectionResult> {
    this.configuration();
    return {
      ok: true,
      status: "unlocked",
      safeMessage: "Password Pusher is configured with a local API token. WardSen will use its configured HTTPS endpoint for this delivery."
    };
  }

  async createDelivery(input: CreateDeliveryInput): Promise<DeliveryResult> {
    const config = this.configuration();
    const now = this.now();
    const expiryDays = wholeDayExpiry(input.expiresAt, now, "Password Pusher");
    const viewLimit = input.viewLimit ?? (input.viewOnce ? 1 : undefined);
    const form = new URLSearchParams({
      "password[payload]": formatDeliveryCredentialText(input.sourceCredential),
      "password[expire_after_days]": String(expiryDays),
      "password[deletable_by_viewer]": "false"
    });
    if (viewLimit !== undefined) form.set("password[expire_after_views]", String(viewLimit));

    const record = await this.requestJson(config, "/p.json", {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form.toString()
    }, "create a Password Pusher link");
    const deliveryId = requiredString(record, ["url_token", "id"], "Password Pusher create response is missing a delivery id");
    const url = optionalString(record, ["html_url", "url"]) ?? `${config.baseUrl}/p/${encodeURIComponent(deliveryId)}/r`;
    return {
      deliveryId,
      url,
      expiresAt: new Date(now.getTime() + expiryDays * DAY_MS),
      viewLimit,
      status: "active"
    };
  }

  async revoke(_accountId: string, deliveryId: string): Promise<void> {
    const config = this.configuration();
    await this.requestJson(config, `/p/${encodeURIComponent(deliveryId)}.json`, {
      method: "DELETE",
      headers: { Accept: "application/json", Authorization: `Bearer ${config.apiToken}` }
    }, "expire the Password Pusher link", [204]);
  }

  async getStatus(_accountId: string, deliveryId: string): Promise<DeliveryStatus> {
    const config = this.configuration();
    const response = await this.request(config, `/p/${encodeURIComponent(deliveryId)}.json`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${config.apiToken}` }
    }, "check Password Pusher link status", [200, 404]);
    if (response.status === 404) return { deliveryId, status: "expired" };
    const record = await responseJsonObject(response, "Password Pusher status response");
    return {
      deliveryId,
      status: passwordPusherStatus(record),
      expiresAt: optionalDate(record, ["expires_at", "expiration"])
    };
  }

  private configuration(): { baseUrl: string; apiToken: string } {
    const apiToken = this.options.apiToken ?? process.env.WARDSEN_PASSWORD_PUSHER_API_TOKEN;
    if (!apiToken?.trim()) {
      throw new Error("Password Pusher needs WARDSEN_PASSWORD_PUSHER_API_TOKEN in the local service environment before links can be created.");
    }
    return {
      baseUrl: secureProviderBaseUrl(this.options.baseUrl ?? process.env.WARDSEN_PASSWORD_PUSHER_BASE_URL ?? "https://pwpush.com", "Password Pusher"),
      apiToken
    };
  }

  private async requestJson(config: { baseUrl: string; apiToken: string }, pathname: string, init: RequestInit, action: string, acceptedStatuses: number[] = [200, 201]): Promise<Record<string, unknown>> {
    const response = await this.request(config, pathname, init, action, acceptedStatuses);
    if (response.status === 204) return {};
    return await responseJsonObject(response, "Password Pusher response");
  }

  private async request(config: { baseUrl: string; apiToken: string }, pathname: string, init: RequestInit, action: string, acceptedStatuses: number[]): Promise<Response> {
    try {
      const response = await this.fetch(`${config.baseUrl}${pathname}`, init);
      if (!acceptedStatuses.includes(response.status)) {
        throw new Error(`Password Pusher could not ${action} (HTTP ${response.status}). Check the configured endpoint and API token.`);
      }
      return response;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Password Pusher could not")) throw error;
      throw new Error(`Password Pusher could not ${action}. Check the configured HTTPS endpoint and local network connection.`);
    }
  }
}

export interface OnetimeSecretDeliveryOptions {
  baseUrl?: string;
  username?: string;
  apiToken?: string;
  fetch?: DeliveryFetch;
  now?: () => Date;
}

/** Onetime Secret v2 adapter using authenticated conceal, receipt lookup and burn endpoints. */
export class OnetimeSecretDeliveryProvider implements DeliveryProvider {
  readonly id = "onetime-secret";
  readonly displayName = "Onetime Secret";
  private readonly fetch: DeliveryFetch;
  private readonly now: () => Date;

  constructor(private readonly options: OnetimeSecretDeliveryOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = options.now ?? (() => new Date());
  }

  async getCapabilities(): Promise<DeliveryProviderCapabilities> {
    return {
      externalLinks: true,
      recipientEmailRestriction: false,
      arbitraryViewLimit: false,
      viewOnce: true,
      customExpiry: true,
      accessPassword: true,
      hideText: false,
      revokeLink: true,
      accessCount: false,
      statusLookup: true
    };
  }

  async testConnection(_accountId: string): Promise<ConnectionResult> {
    this.configuration();
    return {
      ok: true,
      status: "unlocked",
      safeMessage: "Onetime Secret is configured with local API credentials and a regional HTTPS endpoint."
    };
  }

  async createDelivery(input: CreateDeliveryInput): Promise<DeliveryResult> {
    const config = this.configuration();
    const now = this.now();
    const ttlSeconds = Math.max(1, Math.ceil((input.expiresAt.getTime() - now.getTime()) / 1000));
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new Error("Onetime Secret expiry must be in the future.");
    const record = await this.requestJson(config, "/api/v2/secret/conceal", {
      method: "POST",
      headers: { ...basicAuthHeaders(config), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        secret: {
          kind: "conceal",
          share_domain: new URL(config.baseUrl).hostname,
          recipient: input.recipient?.email,
          passphrase: input.accessPassword,
          ttl: String(ttlSeconds),
          secret: formatDeliveryCredentialText(input.sourceCredential)
        }
      })
    }, "create an Onetime Secret link");
    const receipt = receiptRecord(record);
    const deliveryId = requiredString(receipt, ["identifier"], "Onetime Secret create response is missing a receipt identifier");
    const url = optionalString(receipt, ["share_url", "url"]) ?? optionalString(record, ["share_url", "url"]);
    if (!url) throw new Error("Onetime Secret create response is missing a share URL");
    return {
      deliveryId,
      url,
      expiresAt: optionalDate(receipt, ["expiration", "expires_at"]) ?? input.expiresAt,
      viewLimit: 1,
      status: "active"
    };
  }

  async revoke(_accountId: string, deliveryId: string): Promise<void> {
    const config = this.configuration();
    await this.requestJson(config, `/api/v2/receipt/${encodeURIComponent(deliveryId)}/burn`, {
      method: "POST",
      headers: { ...basicAuthHeaders(config), "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ continue: "true" })
    }, "burn the Onetime Secret link");
  }

  async getStatus(_accountId: string, deliveryId: string): Promise<DeliveryStatus> {
    const config = this.configuration();
    const response = await this.request(config, `/api/v2/receipt/${encodeURIComponent(deliveryId)}`, {
      headers: { ...basicAuthHeaders(config), Accept: "application/json" }
    }, "check Onetime Secret link status", [200, 404]);
    if (response.status === 404) return { deliveryId, status: "expired" };
    const receipt = receiptRecord(await responseJsonObject(response, "Onetime Secret receipt response"));
    return {
      deliveryId,
      status: onetimeSecretStatus(receipt),
      expiresAt: optionalDate(receipt, ["expiration", "expires_at"]),
      revokedAt: isTruthy(receipt, ["is_burned", "burned"]) ? this.now() : undefined
    };
  }

  private configuration(): { baseUrl: string; username: string; apiToken: string } {
    const username = this.options.username ?? process.env.WARDSEN_ONETIME_SECRET_USERNAME;
    const apiToken = this.options.apiToken ?? process.env.WARDSEN_ONETIME_SECRET_API_TOKEN;
    if (!username?.trim() || !apiToken?.trim()) {
      throw new Error("Onetime Secret needs WARDSEN_ONETIME_SECRET_USERNAME and WARDSEN_ONETIME_SECRET_API_TOKEN in the local service environment.");
    }
    return {
      baseUrl: secureProviderBaseUrl(this.options.baseUrl ?? process.env.WARDSEN_ONETIME_SECRET_BASE_URL ?? "https://us.onetimesecret.com", "Onetime Secret"),
      username,
      apiToken
    };
  }

  private async requestJson(config: { baseUrl: string; username: string; apiToken: string }, pathname: string, init: RequestInit, action: string): Promise<Record<string, unknown>> {
    return await responseJsonObject(await this.request(config, pathname, init, action, [200, 201]), "Onetime Secret response");
  }

  private async request(config: { baseUrl: string; username: string; apiToken: string }, pathname: string, init: RequestInit, action: string, acceptedStatuses: number[]): Promise<Response> {
    try {
      const response = await this.fetch(`${config.baseUrl}${pathname}`, init);
      if (!acceptedStatuses.includes(response.status)) {
        throw new Error(`Onetime Secret could not ${action} (HTTP ${response.status}). Check the configured region and local API credentials.`);
      }
      return response;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Onetime Secret could not")) throw error;
      throw new Error(`Onetime Secret could not ${action}. Check the configured regional HTTPS endpoint and local network connection.`);
    }
  }
}

export interface YopassDeliveryOptions {
  executable?: string;
  apiUrl?: string;
  publicUrl?: string;
  runCommand?: ExternalDeliveryCommandRunner;
  now?: () => Date;
}

/** Yopass CLI adapter: its local CLI performs encryption before upload. */
export class YopassDeliveryProvider implements DeliveryProvider {
  readonly id = "yopass";
  readonly displayName = "Yopass";
  private readonly executable: string;
  private readonly runCommand: ExternalDeliveryCommandRunner;
  private readonly now: () => Date;

  constructor(private readonly options: YopassDeliveryOptions = {}) {
    this.executable = options.executable ?? resolveYopassExecutable();
    this.runCommand = options.runCommand ?? runCliCommand;
    this.now = options.now ?? (() => new Date());
  }

  async getCapabilities(): Promise<DeliveryProviderCapabilities> {
    return {
      externalLinks: true,
      recipientEmailRestriction: false,
      arbitraryViewLimit: false,
      viewOnce: true,
      customExpiry: false,
      accessPassword: false,
      hideText: false,
      revokeLink: false,
      accessCount: false,
      statusLookup: false
    };
  }

  async testConnection(_accountId: string): Promise<ConnectionResult> {
    await this.runCommand({ executable: this.executable, args: ["--version"], timeoutMs: 15_000 });
    return {
      ok: true,
      status: "unlocked",
      safeMessage: "The local Yopass CLI is available. WardSen will let it encrypt the delivery payload before upload."
    };
  }

  async createDelivery(input: CreateDeliveryInput): Promise<DeliveryResult> {
    const now = this.now();
    const expiration = yopassExpiry(input.expiresAt, now);
    const apiUrl = secureProviderBaseUrl(this.options.apiUrl ?? process.env.WARDSEN_YOPASS_API_URL ?? "https://api.yopass.se", "Yopass API");
    const publicUrl = secureProviderBaseUrl(this.options.publicUrl ?? process.env.WARDSEN_YOPASS_PUBLIC_URL ?? "https://yopass.se", "Yopass public link");
    const text = formatDeliveryCredentialText(input.sourceCredential);
    let result: CliCommandResult;
    try {
      result = await this.runCommand({
        executable: this.executable,
        args: ["--api", apiUrl, "--url", publicUrl, "--expiration", expiration, "--one-time"],
        stdin: text,
        redact: [input.sourceCredential.password ?? ""].filter(Boolean),
        rawOutput: true,
        timeoutMs: 30_000
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("was not found")) throw error;
      throw new Error("Yopass could not create a link. Check the local CLI, configured endpoints and network connection.");
    }
    const url = firstHttpsUrl(result.stdout);
    if (!url) throw new Error("Yopass did not return a delivery link.");
    return {
      // A Yopass URL contains a decryption fragment; never derive persisted metadata from it.
      deliveryId: `yopass-${input.operationId ?? randomUUID()}`,
      url,
      expiresAt: new Date(now.getTime() + yopassDurationMs(expiration)),
      viewLimit: 1,
      status: "active"
    };
  }

  async revoke(_accountId: string, _deliveryId: string): Promise<void> {
    throw new Error("Yopass does not expose sender-side revoke through the configured CLI contract.");
  }

  async getStatus(_accountId: string, deliveryId: string): Promise<DeliveryStatus> {
    return { deliveryId, status: "active" };
  }
}

function basicAuthHeaders(config: { username: string; apiToken: string }): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`${config.username}:${config.apiToken}`, "utf8").toString("base64")}` };
}

function wholeDayExpiry(expiresAt: Date, now: Date, provider: string): number {
  const durationMs = expiresAt.getTime() - now.getTime();
  const roundedDays = Math.round(durationMs / DAY_MS);
  if (roundedDays < 1 || Math.abs(durationMs - roundedDays * DAY_MS) > 2 * MINUTE_MS) {
    throw new Error(`${provider} currently supports whole-day expiry. Use the 24-hour default or another whole-day duration.`);
  }
  return roundedDays;
}

function yopassExpiry(expiresAt: Date, now: Date): "1h" | "1d" | "1w" {
  const durationMs = expiresAt.getTime() - now.getTime();
  const candidates: Array<["1h" | "1d" | "1w", number]> = [["1h", 60 * MINUTE_MS], ["1d", DAY_MS], ["1w", 7 * DAY_MS]];
  const matched = candidates.find(([, candidateMs]) => Math.abs(durationMs - candidateMs) <= 2 * MINUTE_MS);
  if (!matched) throw new Error("Yopass supports 1-hour, 1-day or 1-week expiry. Use the 24-hour default or configure one of those durations.");
  return matched[0];
}

function yopassDurationMs(expiration: "1h" | "1d" | "1w"): number {
  return expiration === "1h" ? 60 * MINUTE_MS : expiration === "1w" ? 7 * DAY_MS : DAY_MS;
}

function resolveYopassExecutable(): string {
  return resolveProviderExecutable({
    toolName: "yopass",
    envPathKey: "WARDSEN_YOPASS_CLI_PATH",
    trustedCandidates: yopassExecutableCandidates()
  });
}

function yopassExecutableCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, "WardSen", "tools", "yopass.exe"));
  if (process.env.HOME) {
    candidates.push(path.join(process.env.HOME, ".local", "bin", "yopass"));
    candidates.push(path.join(process.env.HOME, "Library", "Application Support", "WardSen", "tools", "yopass"));
  }
  candidates.push("/opt/homebrew/bin/yopass", "/usr/local/bin/yopass", "/opt/local/bin/yopass");
  return candidates;
}

function secureProviderBaseUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} endpoint must be an absolute HTTPS URL.`);
  }
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error(`${label} endpoint must use HTTPS unless it is a local development endpoint.`);
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

async function responseJsonObject(response: Response, label: string): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON.`);
  }
  if (!isRecord(parsed)) throw new Error(`${label} did not return a JSON object.`);
  return parsed;
}

function receiptRecord(record: Record<string, unknown>): Record<string, unknown> {
  const parent = isRecord(record.record) ? record.record : record;
  if (isRecord(parent.receipt)) return parent.receipt;
  return parent;
}

function passwordPusherStatus(record: Record<string, unknown>): DeliveryStatus["status"] {
  if (isTruthy(record, ["expired", "is_expired"])) return "expired";
  const viewLimit = optionalNumber(record, ["expire_after_views", "max_views"]);
  const views = optionalNumber(record, ["views", "view_count"]);
  if (viewLimit !== undefined && views !== undefined && views >= viewLimit) return "limit_reached";
  return "active";
}

function onetimeSecretStatus(record: Record<string, unknown>): DeliveryStatus["status"] {
  const state = optionalString(record, ["state"]);
  if (state === "burned" || isTruthy(record, ["is_burned", "burned"])) return "revoked";
  if (state === "unknown" || isTruthy(record, ["is_expired", "expired", "is_destroyed"])) return "expired";
  if (state === "revealed" || isTruthy(record, ["is_revealed", "revealed", "is_viewed", "viewed"])) return "viewed";
  return "active";
}

function firstHttpsUrl(output: string): string | undefined {
  return output.match(/https:\/\/[^\s"']+/)?.[0];
}

function requiredString(record: Record<string, unknown>, keys: string[], message: string): string {
  const value = optionalString(record, keys);
  if (!value) throw new Error(message);
  return value;
}

function optionalString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function optionalNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  }
  return undefined;
}

function optionalDate(record: Record<string, unknown>, keys: string[]): Date | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      const milliseconds = value > 10_000_000_000 ? value : value * 1000;
      return new Date(milliseconds);
    }
    if (typeof value === "string" && value.trim()) {
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  return undefined;
}

function isTruthy(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => record[key] === true || record[key] === "true" || record[key] === "1" || record[key] === 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
