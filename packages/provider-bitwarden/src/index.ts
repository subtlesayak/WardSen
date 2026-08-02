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
    if (input.serverUrl) await this.run(accountId, ["config", "server", input.serverUrl]);
    throw new Error(this.manualTerminalLoginMessage(accountId, input));
  }

  async unlock(accountId: string, input: ProviderUnlockInput): Promise<void> {
    const handoffToken = this.consumeTerminalSessionHandoff(accountId);
    if (handoffToken) {
      this.sessions.markUnlocked(accountId, this.id, handoffToken);
      return;
    }
    if (!input.password) throw new Error(this.missingTerminalSessionMessage(accountId));
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

  private manualTerminalLoginMessage(accountId: string, input: ProviderLoginInput) {
    return `Bitwarden terminal login is required. WardSen does not ask for your Bitwarden password or verification code inside the app for first login, because Bitwarden new-device verification is more reliable in a real terminal. Run the same-profile terminal login command, enter your Bitwarden password and verification code in PowerShell, then return to WardSen and select Unlock. Manual same-profile terminal login command: ${this.terminalLoginCommand(accountId, input)}`;
  }

  private missingTerminalSessionMessage(accountId: string) {
    return `Bitwarden is not unlocked in WardSen yet. Run the same-profile terminal login command first, then return to WardSen and select Unlock. Manual same-profile terminal login command: ${this.terminalLoginCommand(accountId, {})}`;
  }

  private terminalLoginCommand(accountId: string, input: ProviderLoginInput) {
    const profilePath = bitwardenPowerShellProfileExpression(accountId, this.options.profileRoot);
    const handoffPath = bitwardenPowerShellSessionHandoffExpression(accountId, this.options.profileRoot);
    const username = input.username ? ` ${powershellSingleQuote(input.username)}` : "";
    const server = input.serverUrl ? `bw config server ${powershellSingleQuote(input.serverUrl)}; ` : "";
    return `$env:BITWARDENCLI_APPDATA_DIR=${profilePath}; ${server}$session=bw login${username} --raw; if ($LASTEXITCODE -eq 0 -and $session) { Set-Content -LiteralPath ${handoffPath} -Value $session.Trim() -NoNewline }; Remove-Item Env:\\BITWARDENCLI_APPDATA_DIR`;
  }

  private consumeTerminalSessionHandoff(accountId: string): string | undefined {
    const handoffPath = bitwardenSessionHandoffPath(accountId, this.options.profileRoot);
    if (!fs.existsSync(handoffPath)) return undefined;
    try {
      const token = fs.readFileSync(handoffPath, "utf8").trim();
      fs.rmSync(handoffPath, { force: true });
      return token || undefined;
    } catch {
      fs.rmSync(handoffPath, { force: true });
      return undefined;
    }
  }
}

function powershellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function bitwardenPowerShellProfileExpression(accountId: string, profileRoot: string): string {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData && path.resolve(profileRoot).toLowerCase().startsWith(path.resolve(localAppData).toLowerCase())) {
    const relative = path.relative(localAppData, path.join(profileRoot, accountId));
    return `$(Join-Path $env:LOCALAPPDATA ${powershellSingleQuote(relative)})`;
  }
  return powershellSingleQuote(path.join(profileRoot, accountId));
}

function bitwardenPowerShellSessionHandoffExpression(accountId: string, profileRoot: string): string {
  return `$(Join-Path ${bitwardenPowerShellProfileExpression(accountId, profileRoot)} ${powershellSingleQuote(".wardsen-session")})`;
}

function bitwardenSessionHandoffPath(accountId: string, profileRoot: string): string {
  return path.join(profileRoot, accountId, ".wardsen-session");
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
