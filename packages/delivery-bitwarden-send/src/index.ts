import path from "node:path";
import type {
  ConnectionResult,
  CreateDeliveryInput,
  DeliveryProvider,
  DeliveryProviderCapabilities,
  DeliveryResult,
  DeliveryStatus
} from "@wardsen/core";
import { resolveProviderExecutable, runCliCommand, type CliCommandInput, type CliCommandResult } from "@wardsen/security";

export type BitwardenSendCommandRunner = (input: CliCommandInput) => Promise<CliCommandResult>;

export interface BitwardenSendDeliveryOptions {
  executable?: string;
  getSessionToken(accountId: string): string;
  profileDirectoryFor?: (accountId: string) => string | undefined;
  runCommand?: BitwardenSendCommandRunner;
}

export class BitwardenSendDeliveryProvider implements DeliveryProvider {
  readonly id = "bitwarden-send";
  readonly displayName = "Bitwarden Send";
  private readonly executable: string;
  private readonly runCommand: BitwardenSendCommandRunner;

  constructor(private readonly options: BitwardenSendDeliveryOptions) {
    this.executable = options.executable ?? resolveBitwardenExecutable();
    this.runCommand = options.runCommand ?? runCliCommand;
  }

  async getCapabilities(): Promise<DeliveryProviderCapabilities> {
    return {
      externalLinks: true,
      recipientEmailRestriction: false,
      arbitraryViewLimit: true,
      viewOnce: false,
      customExpiry: true,
      accessPassword: true,
      hideText: true,
      revokeLink: true,
      accessCount: true
    };
  }

  async testConnection(accountId: string): Promise<ConnectionResult> {
    await this.run(accountId, ["send", "list"]);
    return { ok: true, status: "unlocked" };
  }

  async createDelivery(input: CreateDeliveryInput): Promise<DeliveryResult> {
    const accountId = input.deliveryAccountId;
    if (!accountId) throw new Error("Bitwarden Send delivery account is required");
    const text = formatCredentialText(input.sourceCredential);
    const sendJson = JSON.stringify(buildTextSendObject(input, text));
    const encoded = (await this.run(accountId, ["encode"], sendJson, sensitiveValues(input, sendJson, text))).stdout.trim();
    if (!encoded) throw new Error("Bitwarden CLI did not encode the Send payload");
    const result = await this.run(accountId, ["send", "--fullObject", "create"], encoded, sensitiveValues(input, sendJson, text, encoded));
    const parsed = safeJsonObject(result.stdout, "Bitwarden Send create response");
    const id = optionalString(parsed.id);
    const url = optionalString(parsed.accessUrl) ?? optionalString(parsed.url);
    if (!id) throw new Error("Bitwarden Send did not return a delivery id");
    if (!url) throw new Error("Bitwarden Send did not return an access URL");
    return { deliveryId: id, url, expiresAt: input.expiresAt, viewLimit: input.viewLimit };
  }

  async revoke(accountId: string, deliveryId: string): Promise<void> {
    await this.run(accountId, ["send", "delete", deliveryId]);
  }

  async getStatus(accountId: string, deliveryId: string): Promise<DeliveryStatus> {
    const result = await this.run(accountId, ["send", "get", deliveryId]);
    const parsed = safeJsonObject(result.stdout, "Bitwarden Send status response");
    const id = optionalString(parsed.id);
    if (!id) throw new Error("Bitwarden Send status response is missing a delivery id");
    const expirationDate = optionalDate(parsed.expirationDate);
    const deletionDate = optionalDate(parsed.deletionDate);
    const accessCount = optionalNumber(parsed.accessCount);
    const maxAccessCount = optionalNumber(parsed.maxAccessCount);
    return {
      deliveryId: id,
      status: deliveryStatus(parsed.disabled === true, deletionDate, expirationDate, accessCount, maxAccessCount),
      accessCount,
      expiresAt: expirationDate ?? deletionDate
    };
  }

  private async run(accountId: string, args: string[], stdin?: string | string[], redact: string[] = []) {
    const sessionToken = this.options.getSessionToken(accountId);
    const stdinValue = Array.isArray(stdin) ? undefined : stdin;
    return await this.runCommand({
      executable: this.executable,
      args,
      stdin: stdinValue,
      env: {
        BW_SESSION: sessionToken,
        ...this.profileEnvironment(accountId)
      },
      redact: [sessionToken, ...redact],
      timeoutMs: 60_000
    });
  }

  private profileEnvironment(accountId: string): Record<string, string> {
    const profileDirectory = this.options.profileDirectoryFor?.(accountId);
    return profileDirectory ? { BITWARDENCLI_APPDATA_DIR: profileDirectory } : {};
  }
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

  return candidates;
}

function formatCredentialText(credential: CreateDeliveryInput["sourceCredential"]): string {
  const lines = [`Title: ${credential.title}`];
  if (credential.username) lines.push(`Username: ${credential.username}`);
  if (credential.password) lines.push(`Password: ${credential.password}`);
  return lines.join("\n");
}

function buildTextSendObject(input: CreateDeliveryInput, text: string): Record<string, unknown> {
  return {
    object: "send",
    name: input.sourceCredential.title,
    notes: input.operationId ? `Created by WardSen\nWardSen operation: ${input.operationId}` : "Created by WardSen",
    type: 0,
    text: {
      text,
      hidden: input.hideText === true
    },
    file: null,
    maxAccessCount: input.viewLimit ?? null,
    deletionDate: input.expiresAt.toISOString(),
    expirationDate: null,
    password: input.accessPassword ?? null,
    emails: null,
    disabled: false,
    hideEmail: false
  };
}

function sensitiveValues(input: CreateDeliveryInput, ...values: Array<string | undefined>): string[] {
  return [
    ...values.filter((value): value is string => Boolean(value)),
    input.sourceCredential.password,
    input.accessPassword
  ].filter((value): value is string => Boolean(value));
}

function deliveryStatus(
  disabled: boolean,
  deletionDate?: Date,
  expirationDate?: Date,
  accessCount?: number,
  maxAccessCount?: number
): DeliveryStatus["status"] {
  const now = Date.now();
  if (disabled) return "revoked";
  if ((deletionDate && deletionDate.getTime() <= now) || (expirationDate && expirationDate.getTime() <= now)) return "expired";
  if (maxAccessCount !== undefined && accessCount !== undefined && accessCount >= maxAccessCount) return "limit_reached";
  if ((accessCount ?? 0) > 0) return "viewed";
  return "active";
}

function safeJson(value: string, label: string): unknown {
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function safeJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = safeJson(value, label);
  if (isRecord(parsed)) return parsed;
  throw new Error(`${label} did not return a JSON object`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalDate(value: unknown): Date | undefined {
  const raw = optionalString(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
