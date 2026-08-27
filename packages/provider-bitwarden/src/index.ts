import fs from "node:fs";
import path from "node:path";
import type {
  ConnectionResult,
  CredentialProvider,
  CredentialProviderCapabilities,
  CredentialSummary,
  PaginationInput,
  ProviderLoginInput,
  TerminalSessionHandoff,
  TerminalSessionHandoffAcceptance,
  TerminalSessionHandoffIdentity,
  TerminalSessionHandoffRejectionReason,
  ProviderUnlockInput,
  SensitiveCredential
} from "@wardsen/core";
import { AccountSessionManager, TerminalSessionHandoffIdentityError } from "@wardsen/core";
import { resolveProviderExecutable, runCliCommand, type CliCommandInput, type CliCommandResult } from "@wardsen/security";

export type BitwardenCommandRunner = (input: CliCommandInput) => Promise<CliCommandResult>;

export interface BitwardenProviderOptions {
  executable?: string;
  getExecutable?: () => string | undefined;
  profileRoot: string;
  profileDirectoryFor?: (accountId: string) => string | undefined;
  sessions?: AccountSessionManager;
  runCommand?: BitwardenCommandRunner;
  platform?: NodeJS.Platform;
}

export class BitwardenCredentialProvider implements CredentialProvider {
  readonly id = "bitwarden";
  readonly displayName = "Bitwarden";
  private readonly sessions: AccountSessionManager;
  private readonly runCommand: BitwardenCommandRunner;
  private readonly platform: NodeJS.Platform;

  constructor(private readonly options: BitwardenProviderOptions) {
    if (!options.executable && options.getExecutable?.() === undefined) resolveBitwardenExecutable();
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
    const activeSession = this.sessions.snapshot().find(
      (session) => session.accountId === accountId && session.providerId === this.id && session.status === "unlocked"
    );
    if (activeSession) {
      return { ok: true, status: "unlocked", safeMessage: "WardSen session active" };
    }
    const result = await this.run(accountId, ["status"], undefined, 10_000);
    const parsed = safeJsonObject(result.stdout, "Bitwarden status");
    const status = typeof parsed?.status === "string" ? parsed.status : undefined;
    return { ok: true, status: mapBwStatus(status), safeMessage: status };
  }

  async login(accountId: string, input: ProviderLoginInput): Promise<void> {
    if (input.serverUrl) await this.run(accountId, ["config", "server", input.serverUrl]);
    throw new Error("Bitwarden terminal login must be started from WardSen so it can create a one-time local session handoff.");
  }

  async unlock(accountId: string, input: ProviderUnlockInput): Promise<void> {
    if (!input.password) throw new Error("Bitwarden is not unlocked in WardSen yet. Select Terminal login / unlock in WardSen, run the copied command, and WardSen will update the account automatically.");
    const result = await this.run(accountId, ["unlock", "--raw"], input.password, 60_000, [input.password ?? ""]);
    const token = result.stdout.trim();
    if (!token) throw new Error("Bitwarden unlock did not return a session token");
    this.sessions.markUnlocked(accountId, this.id, token);
  }

  createTerminalSessionHandoffCommand(accountId: string, input: ProviderLoginInput, handoff: TerminalSessionHandoff): string {
    this.cleanupLegacyTerminalSessionHandoffs(accountId);
    if (this.platform !== "win32") return this.posixTerminalLoginCommand(accountId, input, handoff);
    return this.powerShellTerminalLoginCommand(accountId, input, handoff);
  }

  async acceptTerminalSessionHandoff(accountId: string, sessionToken: string, expectedIdentity: TerminalSessionHandoffIdentity): Promise<TerminalSessionHandoffAcceptance> {
    const token = sessionToken.trim();
    if (!token) return await this.rejectTerminalSessionHandoff(accountId, token, "not_unlocked");

    const expectedEmail = normalizeBitwardenEmail(expectedIdentity.username);
    if (!expectedEmail) return await this.rejectTerminalSessionHandoff(accountId, token, "account_identity_missing");

    let status: Record<string, unknown> | undefined;
    try {
      const result = await this.run(accountId, ["status", "--nointeraction"], undefined, 10_000, [token], { BW_SESSION: token });
      status = safeJsonObject(result.stdout, "Bitwarden terminal session status");
    } catch {
      return await this.rejectTerminalSessionHandoff(accountId, token, "status_invalid");
    }

    if (status?.status !== "unlocked") return await this.rejectTerminalSessionHandoff(accountId, token, "not_unlocked");

    const userEmail = normalizeBitwardenEmail(status.userEmail);
    if (!userEmail || userEmail !== expectedEmail) return await this.rejectTerminalSessionHandoff(accountId, token, "email_mismatch");

    const expectedServerUrl = canonicalBitwardenServerUrl(expectedIdentity.serverUrl);
    const observedServerUrl = canonicalBitwardenServerUrl(typeof status.serverUrl === "string" ? status.serverUrl : undefined);
    if (!observedServerUrl || observedServerUrl !== expectedServerUrl) return await this.rejectTerminalSessionHandoff(accountId, token, "server_mismatch");

    const providerPrincipalId = typeof status.userId === "string" ? status.userId.trim() : "";
    if (!providerPrincipalId || (expectedIdentity.providerPrincipalId && providerPrincipalId !== expectedIdentity.providerPrincipalId)) {
      return await this.rejectTerminalSessionHandoff(accountId, token, "user_id_mismatch");
    }

    return { providerPrincipalId };
  }

  async lock(accountId: string): Promise<void> {
    try {
      await this.runWithSession(accountId, ["lock"]);
    } finally {
      // Local access must end even when the external CLI cannot report its lock result.
      this.sessions.markLocked(accountId);
    }
  }

  async logout(accountId: string, options?: { timeoutMs?: number }): Promise<void> {
    try {
      await this.run(accountId, ["logout"], undefined, options?.timeoutMs ?? 2_000);
    } finally {
      this.sessions.markLoggedOut(accountId);
    }
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
      executable: this.executable(),
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

  private async rejectTerminalSessionHandoff(accountId: string, token: string, reason: TerminalSessionHandoffRejectionReason): Promise<never> {
    this.sessions.markLocked(accountId);
    if (token) {
      await this.run(accountId, ["lock"], undefined, 10_000, [token], { BW_SESSION: token }).catch(() => undefined);
    }
    throw new TerminalSessionHandoffIdentityError(reason);
  }

  private powerShellTerminalLoginCommand(accountId: string, input: ProviderLoginInput, handoff: TerminalSessionHandoff) {
    const profileDirectory = this.profileDirectory(accountId);
    const profilePath = bitwardenPowerShellProfileExpression(profileDirectory);
    const username = input.username ? ` ${powershellSingleQuote(input.username)}` : "";
    const server = input.serverUrl ? `& $bwCommand config server ${powershellSingleQuote(input.serverUrl)}; if ($LASTEXITCODE -ne 0) { throw "WardSen could not set the Bitwarden server." }; ` : "";
    const executable = this.executable();
    const command = path.isAbsolute(executable) ? powershellSingleQuote(executable) : "(Get-Command bw -ErrorAction SilentlyContinue).Source";
    const claimUrl = powershellSingleQuote(handoff.claimUrl);
    const token = powershellSingleQuote(handoff.token);
    return `$env:BITWARDENCLI_APPDATA_DIR=${profilePath}; $bwCommand=${command}; try { if (-not $bwCommand -or -not (Test-Path -LiteralPath $bwCommand -PathType Leaf)) { throw "WardSen could not find the Bitwarden CLI. Install bw, then retry Terminal login / unlock." }; ${server}& $bwCommand login${username}; $bwLoginExitCode=$LASTEXITCODE; if ($bwLoginExitCode -ne 0) { $bwStatus=& $bwCommand status 2>$null; if (-not ($bwStatus -match '"status"\\s*:\\s*"(locked|unlocked)"')) { throw "WardSen could not finish Bitwarden login. Fix the Bitwarden CLI message above, then retry." } }; Write-Host "WardSen will now unlock this Bitwarden profile. Type your Bitwarden master password in the Bitwarden prompt:"; $bwSession=& $bwCommand unlock --raw; $bwExitCode=$LASTEXITCODE; if ($bwExitCode -ne 0 -or -not $bwSession) { throw "WardSen could not unlock Bitwarden. Fix the Bitwarden CLI message above, then retry." }; Invoke-WebRequest -Uri ${claimUrl} -Method Post -ContentType 'text/plain; charset=utf-8' -Headers @{ 'X-WardSen-Terminal-Handoff' = ${token} } -Body $bwSession.Trim() | Out-Null; Write-Host "WardSen received the Bitwarden session. Return to WardSen; this account is unlocked." } finally { $bwSession=$null; Remove-Item Env:\\BITWARDENCLI_APPDATA_DIR -ErrorAction SilentlyContinue }`;
  }

  private posixTerminalLoginCommand(accountId: string, input: ProviderLoginInput, handoff: TerminalSessionHandoff) {
    const profilePath = bitwardenPosixProfileExpression(this.profileDirectory(accountId));
    const username = input.username ? ` ${posixSingleQuote(input.username)}` : "";
    const server = input.serverUrl ? `if [ "$bwCanUnlock" -eq 1 ]; then "$bwCommand" config server ${posixSingleQuote(input.serverUrl)} || bwCanUnlock=0; fi; ` : "";
    const claimUrl = posixSingleQuote(handoff.claimUrl);
    const claimHeader = posixSingleQuote(`X-WardSen-Terminal-Handoff: ${handoff.token}`);
    return `export BITWARDENCLI_APPDATA_DIR=${profilePath}; mkdir -p "$BITWARDENCLI_APPDATA_DIR"; ${bitwardenPosixCommandAssignment(this.executable())}; if [ -z "$bwCommand" ] || [ ! -x "$bwCommand" ]; then printf '\\nWardSen could not find the Bitwarden CLI. Install bw or put it at $HOME/.local/bin/bw, /opt/homebrew/bin/bw, /usr/local/bin/bw, /opt/local/bin/bw or $HOME/Library/Application Support/WardSen/tools/bw, then retry Terminal login / unlock.\\n' >&2; bwCanUnlock=0; else bwCanUnlock=1; fi; ${server}if [ "$bwCanUnlock" -eq 1 ]; then "$bwCommand" login${username}; bwLoginExitCode=$?; if [ "$bwLoginExitCode" -ne 0 ]; then bwStatus="$("$bwCommand" status 2>/dev/null || true)"; if printf '%s' "$bwStatus" | grep -Eq '"status"[[:space:]]*:[[:space:]]*"(locked|unlocked)"'; then bwLoginExitCode=0; else printf '\\nWardSen could not finish Bitwarden login. Fix the Bitwarden CLI message above, then retry.\\n' >&2; bwCanUnlock=0; fi; unset bwStatus; fi; fi; if [ "$bwCanUnlock" -eq 1 ]; then printf '\\nWardSen will now unlock this Bitwarden profile. Type your Bitwarden master password in the Bitwarden prompt:\\n'; bwSession="$("$bwCommand" unlock --raw)"; bwExitCode=$?; else bwExitCode=127; fi; if [ "$bwExitCode" -eq 0 ] && [ -n "$bwSession" ]; then if printf '%s' "$bwSession" | curl --fail --silent --show-error --request POST --header 'Content-Type: text/plain; charset=utf-8' --header ${claimHeader} --data-binary @- ${claimUrl}; then printf '\\nWardSen received the Bitwarden session. Return to WardSen; this account is unlocked.\\n'; else printf '\\nWardSen could not transfer the Bitwarden session. Start Terminal login / unlock again from WardSen before retrying.\\n' >&2; fi; else if [ "$bwCanUnlock" -eq 1 ]; then printf '\\nWardSen could not unlock Bitwarden. Fix the Bitwarden CLI message above, then retry.\\n' >&2; fi; fi; unset BITWARDENCLI_APPDATA_DIR bwSession bwExitCode bwLoginExitCode bwCanUnlock bwCommand bwCandidate bwStatus`;
  }

  private executable(): string {
    return this.options.executable ?? this.options.getExecutable?.() ?? resolveBitwardenExecutable();
  }

  private cleanupLegacyTerminalSessionHandoffs(accountId: string): void {
    const profileDirectory = this.profileDirectory(accountId);
    try {
      for (const entry of fs.readdirSync(profileDirectory, { withFileTypes: true })) {
        if (entry.isFile() && (entry.name === ".wardsen-session" || entry.name.startsWith(".wardsen-session-"))) {
          fs.rmSync(path.join(profileDirectory, entry.name), { force: true });
        }
      }
    } catch {
      // A first-login profile may not exist yet. Do not create it until Bitwarden does.
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

function normalizeBitwardenEmail(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const match = /^([^@\s]+)@([^@\s]+)$/.exec(trimmed);
  if (!match) return undefined;
  return `${match[1]!.toLocaleLowerCase()}@${match[2]!.toLocaleLowerCase()}`;
}

function canonicalBitwardenServerUrl(value?: string): string | undefined {
  const candidate = value?.trim() || "https://vault.bitwarden.com";
  try {
    const url = new URL(candidate);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) return undefined;
    const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return `${url.protocol.toLocaleLowerCase()}//${url.host.toLocaleLowerCase()}${pathname}`;
  } catch {
    return undefined;
  }
}

function bitwardenPosixCommandAssignment(executable: string): string {
  if (path.isAbsolute(executable)) return `bwCommand=${posixSingleQuote(executable)}`;
  return `bwCommand="$(command -v bw || true)"; if [ -z "$bwCommand" ]; then for bwCandidate in "$HOME/.local/bin/bw" "$HOME/Library/Application Support/WardSen/tools/bw" "$HOME/.wardsen/tools/bw" "/opt/homebrew/bin/bw" "/usr/local/bin/bw" "/opt/local/bin/bw"; do if [ -x "$bwCandidate" ]; then bwCommand="$bwCandidate"; break; fi; done; fi`;
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
    candidates.push(path.join(process.env.HOME, ".local", "bin", "bw"));
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
