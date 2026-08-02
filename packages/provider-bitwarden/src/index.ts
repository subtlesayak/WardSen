import fs from "node:fs";
import path from "node:path";
import type {
  ConnectionResult,
  CredentialProvider,
  CredentialProviderCapabilities,
  CredentialSummary,
  PaginationInput,
  ProviderLoginInput,
  ProviderUnlockInput,
  SensitiveCredential
} from "@wardsen/core";
import { AccountSessionManager } from "@wardsen/core";
import { runCliCommand, type CliCommandInput, type CliCommandResult } from "@wardsen/security";

export type BitwardenCommandRunner = (input: CliCommandInput) => Promise<CliCommandResult>;

export interface BitwardenProviderOptions {
  executable?: string;
  profileRoot: string;
  sessions?: AccountSessionManager;
  runCommand?: BitwardenCommandRunner;
}

export class BitwardenCredentialProvider implements CredentialProvider {
  readonly id = "bitwarden";
  readonly displayName = "Bitwarden";
  private readonly executable: string;
  private readonly sessions: AccountSessionManager;
  private readonly runCommand: BitwardenCommandRunner;

  constructor(private readonly options: BitwardenProviderOptions) {
    this.executable = options.executable ?? resolveBitwardenExecutable();
    this.sessions = options.sessions ?? new AccountSessionManager();
    this.runCommand = options.runCommand ?? runCliCommand;
  }

  async getCapabilities(): Promise<CredentialProviderCapabilities> {
    return {
      searchItems: true,
      multipleAccounts: true,
      customServers: true,
      localVaults: false,
      synchronization: true,
      locking: true
    };
  }

  async testConnection(accountId: string): Promise<ConnectionResult> {
    const result = await this.run(accountId, ["status"], undefined, 10_000);
    const parsed = safeJsonObject(result.stdout, "Bitwarden status");
    const status = typeof parsed?.status === "string" ? parsed.status : undefined;
    return { ok: true, status: mapBwStatus(status), safeMessage: status };
  }

  async login(accountId: string, input: ProviderLoginInput): Promise<void> {
    const args = ["login"];
    if (input.username) args.push(input.username);
    if (input.sso) args.push("--sso");
    const env: Record<string, string> = {};
    if (input.password) {
      env.WARDSEN_BW_PASSWORD = input.password;
      args.push("--passwordenv", "WARDSEN_BW_PASSWORD");
    }
    const verificationStdin = bitwardenVerificationStdin(input);
    if (input.verificationCode && !verificationStdin) {
      args.push("--method", bitwardenVerificationMethod(input.verificationMethod), "--code", input.verificationCode);
    }
    if (input.serverUrl) await this.run(accountId, ["config", "server", input.serverUrl]);
    await this.run(accountId, args, verificationStdin, 45_000, [input.password ?? "", input.verificationCode ?? ""], env);
  }

  async unlock(accountId: string, input: ProviderUnlockInput): Promise<void> {
    const result = await this.run(accountId, ["unlock", "--raw"], input.password, 60_000, [input.password ?? ""]);
    const token = result.stdout.trim();
    if (!token) throw new Error("Bitwarden unlock did not return a session token");
    this.sessions.markUnlocked(accountId, this.id, token);
  }

  async lock(accountId: string): Promise<void> {
    await this.run(accountId, ["lock"]);
    this.sessions.markLocked(accountId);
  }

  async logout(accountId: string): Promise<void> {
    await this.run(accountId, ["logout"]);
    this.sessions.markLoggedOut(accountId);
  }

  async sync(accountId: string): Promise<void> {
    await this.runWithSession(accountId, ["sync"]);
  }

  async search(accountId: string, query: string, pagination: PaginationInput): Promise<CredentialSummary[]> {
    const args = query.trim() ? ["list", "items", "--search", query] : ["list", "items"];
    const result = await this.runWithSession(accountId, args);
    const rows = safeJsonArray(result.stdout, "Bitwarden item list").filter(isBitwardenItem);
    const start = (Math.max(1, pagination.page) - 1) * pagination.pageSize;
    return rows.slice(start, start + pagination.pageSize).map((item) => normalizeSummary(accountId, item));
  }

  async getCredential(accountId: string, itemId: string): Promise<SensitiveCredential> {
    const result = await this.runWithSession(accountId, ["get", "item", itemId], undefined, 30_000);
    const item = safeJsonObject(result.stdout, "Bitwarden item");
    if (!isBitwardenItem(item)) throw new Error("Bitwarden item response is missing required fields");
    return {
      title: item.name,
      username: item.login?.username,
      password: item.login?.password,
      urls: item.login?.uris?.flatMap((uri) => (uri.uri ? [uri.uri] : [])) ?? [],
      notes: item.notes,
      totp: item.login?.totp
    };
  }

  private async runWithSession(accountId: string, args: string[], stdin?: string, timeoutMs?: number) {
    const token = this.sessions.getSessionToken(accountId, this.id);
    return await this.sessions.withOperation(accountId, this.id, () =>
      this.run(accountId, args, stdin, timeoutMs, [token, stdin ?? ""], { BW_SESSION: token })
    );
  }

  private async run(accountId: string, args: string[], stdin?: string, timeoutMs?: number, redact: string[] = [], env?: Record<string, string>) {
    return await this.runCommand({
      executable: this.executable,
      args,
      stdin,
      timeoutMs,
      redact,
      env: {
        ...env,
        BITWARDENCLI_APPDATA_DIR: path.join(this.options.profileRoot, accountId)
      }
    });
  }
}

function bitwardenVerificationMethod(method: ProviderLoginInput["verificationMethod"]): string {
  if (method === "authenticator") return "0";
  if (method === "yubikey") return "3";
  return "1";
}

function bitwardenVerificationStdin(input: ProviderLoginInput): string | undefined {
  if (!input.verificationCode) return undefined;
  if (input.verificationMethod === "authenticator" || input.verificationMethod === "yubikey") return undefined;
  return `${input.verificationCode}\n`;
}

function resolveBitwardenExecutable(): string {
  const candidates = bitwardenExecutableCandidates();
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? "bw";
}

function bitwardenExecutableCandidates(): string[] {
  const explicit = process.env.WARDSEN_BITWARDEN_CLI_PATH;
  const candidates: string[] = [];
  if (explicit && path.isAbsolute(explicit)) candidates.push(explicit);

  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "WardSen", "tools", "bw.exe"));
  }
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, "WardSen", "tools", "bw.exe"));
  }
  if (process.env.HOME) {
    candidates.push(path.join(process.env.HOME, "Library", "Application Support", "WardSen", "tools", "bw"));
    candidates.push(path.join(process.env.HOME, ".wardsen", "tools", "bw"));
  }

  return candidates;
}

interface BitwardenItem {
  id: string;
  name: string;
  notes?: string;
  login?: {
    username?: string;
    password?: string;
    totp?: string;
    uris?: Array<{ uri?: string }>;
  };
  type?: number;
}

function normalizeSummary(accountId: string, item: BitwardenItem): CredentialSummary {
  const firstUrl = item.login?.uris?.find((uri) => uri.uri)?.uri;
  const hostname = firstUrl ? safeHostname(firstUrl) : undefined;
  return {
    id: item.id,
    accountId,
    providerId: "bitwarden",
    title: item.name,
    username: item.login?.username,
    domain: hostname,
    uriPreview: hostname,
    itemType: item.type === 1 ? "login" : "other"
  };
}

function safeJson(value: string, label: string): unknown {
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function safeJsonObject(value: string, label: string): Record<string, unknown> | undefined {
  const parsed = safeJson(value, label);
  if (parsed === undefined) return undefined;
  if (isRecord(parsed)) return parsed;
  throw new Error(`${label} did not return a JSON object`);
}

function safeJsonArray(value: string, label: string): unknown[] {
  const parsed = safeJson(value, label);
  if (parsed === undefined) return [];
  if (Array.isArray(parsed)) return parsed;
  throw new Error(`${label} did not return a JSON array`);
}

function isBitwardenItem(value: unknown): value is BitwardenItem {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeHostname(value: string): string | undefined {
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function mapBwStatus(status?: string): ConnectionResult["status"] {
  if (status === "unlocked") return "unlocked";
  if (status === "locked") return "locked";
  return "logged_out";
}
