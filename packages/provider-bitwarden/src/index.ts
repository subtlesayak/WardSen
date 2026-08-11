import fs from "node:fs";
import { createHash } from "node:crypto";
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
import { resolveProviderExecutable, runCliCommand, type CliCommandInput, type CliCommandResult } from "@wardsen/security";

const TERMINAL_HANDOFF_TTL_MS = 5 * 60 * 1000;

export type BitwardenCommandRunner = (input: CliCommandInput) => Promise<CliCommandResult>;

export interface BitwardenProviderOptions {
  executable?: string;
  profileRoot: string;
  profileDirectoryFor?: (accountId: string) => string | undefined;
  sessions?: AccountSessionManager;
  runCommand?: BitwardenCommandRunner;
  platform?: NodeJS.Platform;
}

export class BitwardenCredentialProvider implements CredentialProvider {
  readonly id = "bitwarden";
  readonly displayName = "Bitwarden";
  private readonly executable: string;
  private readonly sessions: AccountSessionManager;
  private readonly runCommand: BitwardenCommandRunner;
  private readonly platform: NodeJS.Platform;

  constructor(private readonly options: BitwardenProviderOptions) {
    this.executable = options.executable ?? resolveBitwardenExecutable();
    this.sessions = options.sessions ?? new AccountSessionManager();
    this.runCommand = options.runCommand ?? runCliCommand;
    this.platform = options.platform ?? process.platform;
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
    const result = await this.runWithSession(accountId, ["get", "item", itemId], undefined, 30_000, true);
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

  private async runWithSession(accountId: string, args: string[], stdin?: string, timeoutMs?: number, rawOutput = false) {
    const token = this.sessions.getSessionToken(accountId, this.id);
    return await this.sessions.withOperation(accountId, this.id, () =>
      this.run(accountId, args, stdin, timeoutMs, [token, stdin ?? ""], { BW_SESSION: token }, rawOutput)
    );
  }

  private async run(accountId: string, args: string[], stdin?: string, timeoutMs?: number, redact: string[] = [], env?: Record<string, string>, rawOutput = false) {
    return await this.runCommand({
      executable: this.executable,
      args,
      stdin,
      timeoutMs,
      redact,
      rawOutput,
      env: {
        ...env,
        BITWARDENCLI_APPDATA_DIR: this.profileDirectory(accountId)
      }
    });
  }

  private manualTerminalLoginMessage(accountId: string, input: ProviderLoginInput) {
    return `Bitwarden terminal login is required. WardSen does not ask for your Bitwarden password or verification code inside the app for first login, because Bitwarden new-device verification is more reliable in a real terminal. Run the same-profile terminal login command, enter your Bitwarden password and verification code in Terminal or PowerShell, then return to WardSen and select Unlock. Manual same-profile terminal login command: ${this.terminalLoginCommand(accountId, input)}`;
  }

  private missingTerminalSessionMessage(accountId: string) {
    return `Bitwarden is not unlocked in WardSen yet. Run the same-profile terminal login command first, then return to WardSen and select Unlock. Manual same-profile terminal login command: ${this.terminalLoginCommand(accountId, {})}`;
  }

  private terminalLoginCommand(accountId: string, input: ProviderLoginInput) {
    if (this.platform !== "win32") return this.posixTerminalLoginCommand(accountId, input);
    return this.powerShellTerminalLoginCommand(accountId, input);
  }

  private powerShellTerminalLoginCommand(accountId: string, input: ProviderLoginInput) {
    const profileDirectory = this.profileDirectory(accountId);
    const profilePath = bitwardenPowerShellProfileExpression(profileDirectory);
    const handoffPath = bitwardenPowerShellSessionHandoffExpression(profileDirectory, accountId);
    const username = input.username ? ` ${powershellSingleQuote(input.username)}` : "";
    const server = input.serverUrl ? `bw config server ${powershellSingleQuote(input.serverUrl)}; ` : "";
    return `$env:BITWARDENCLI_APPDATA_DIR=${profilePath}; ${server}$bwResult=bw login${username} --raw 2>&1; if ($LASTEXITCODE -ne 0 -and "$bwResult" -match "already logged in") { $bwResult=bw unlock --raw }; if ($LASTEXITCODE -eq 0 -and $bwResult) { Set-Content -LiteralPath ${handoffPath} -Value $bwResult.Trim() -NoNewline }; Remove-Item Env:\\BITWARDENCLI_APPDATA_DIR`;
  }

  private posixTerminalLoginCommand(accountId: string, input: ProviderLoginInput) {
    const profilePath = bitwardenPosixProfileExpression(this.profileDirectory(accountId));
    const username = input.username ? ` ${posixSingleQuote(input.username)}` : "";
    const server = input.serverUrl ? `bw config server ${posixSingleQuote(input.serverUrl)}; ` : "";
    const handoffFile = bitwardenSessionHandoffFile(accountId, this.profileDirectory(accountId));
    const handoffPath = `"$BITWARDENCLI_APPDATA_DIR/${posixDoubleQuoteLiteral(handoffFile)}"`;
    return `export BITWARDENCLI_APPDATA_DIR=${profilePath}; mkdir -p "$BITWARDENCLI_APPDATA_DIR"; ${server}bw login${username}; printf '\\nWardSen will now unlock this Bitwarden profile. Type your Bitwarden master password here: '; stty -echo; IFS= read -r bwPassword; stty echo; printf '\\n'; umask 077; printf '%s\\n' "$bwPassword" | bw unlock --raw > ${handoffPath}; bwExitCode=$?; unset bwPassword; if [ "$bwExitCode" -eq 0 ] && [ -s ${handoffPath} ]; then chmod 600 ${handoffPath}; printf '\\nWardSen saved this Bitwarden session. Return to WardSen and select Unlock from terminal session.\\n'; else rm -f ${handoffPath}; printf '\\nWardSen could not save a Bitwarden session. Finish Bitwarden login, then run this command again.\\n' >&2; fi; unset BITWARDENCLI_APPDATA_DIR bwExitCode`;
  }

  private consumeTerminalSessionHandoff(accountId: string): string | undefined {
    const profileDirectory = this.profileDirectory(accountId);
    cleanupLegacySessionHandoff(profileDirectory);
    const handoffPath = bitwardenSessionHandoffPath(profileDirectory, accountId);
    if (!fs.existsSync(handoffPath)) return undefined;
    try {
      const stats = fs.statSync(handoffPath);
      if (Date.now() - stats.mtimeMs > TERMINAL_HANDOFF_TTL_MS) {
        fs.rmSync(handoffPath, { force: true });
        return undefined;
      }
      const token = fs.readFileSync(handoffPath, "utf8").trim();
      fs.rmSync(handoffPath, { force: true });
      return token || undefined;
    } catch {
      fs.rmSync(handoffPath, { force: true });
      return undefined;
    }
  }

  private profileDirectory(accountId: string): string {
    return this.options.profileDirectoryFor?.(accountId) ?? path.join(this.options.profileRoot, accountId);
  }
}

function powershellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function posixSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function posixDoubleQuoteLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("`", "\\`").replaceAll("$", "\\$");
}

function bitwardenPosixProfileExpression(profilePath: string): string {
  const home = process.env.HOME;
  if (home && isPathInside(profilePath, home)) {
    const relative = path.relative(home, profilePath).split(path.sep).join("/");
    return `"$HOME/${posixDoubleQuoteLiteral(relative)}"`;
  }
  return `"${posixDoubleQuoteLiteral(profilePath)}"`;
}

function bitwardenPowerShellProfileExpression(profilePath: string): string {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData && isPathInside(profilePath, localAppData)) {
    const relative = path.relative(localAppData, profilePath);
    return `$(Join-Path $env:LOCALAPPDATA ${powershellSingleQuote(relative)})`;
  }
  return powershellSingleQuote(profilePath);
}

function isPathInside(targetPath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(targetPath));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function bitwardenPowerShellSessionHandoffExpression(profilePath: string, accountId: string): string {
  return `$(Join-Path ${bitwardenPowerShellProfileExpression(profilePath)} ${powershellSingleQuote(bitwardenSessionHandoffFile(accountId, profilePath))})`;
}

function bitwardenSessionHandoffPath(profilePath: string, accountId: string): string {
  return path.join(profilePath, bitwardenSessionHandoffFile(accountId, profilePath));
}

function bitwardenSessionHandoffFile(accountId: string, profilePath: string): string {
  const entropy = createHash("sha256").update(`${accountId}\0${path.resolve(profilePath)}`).digest("hex").slice(0, 16);
  return `.wardsen-session-${entropy}`;
}

function cleanupLegacySessionHandoff(profilePath: string): void {
  fs.rmSync(path.join(profilePath, ".wardsen-session"), { force: true });
}

function resolveBitwardenExecutable(): string {
  return resolveProviderExecutable({
    toolName: "bw",
    envPathKey: "WARDSEN_BITWARDEN_CLI_PATH",
    trustedCandidates: bitwardenExecutableCandidates()
  });
}

function bitwardenExecutableCandidates(): string[] {
  const candidates: string[] = [];

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
  candidates.push("/opt/homebrew/bin/bw");
  candidates.push("/usr/local/bin/bw");
  candidates.push("/opt/local/bin/bw");

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
