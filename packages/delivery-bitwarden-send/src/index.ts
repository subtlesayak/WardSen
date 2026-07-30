import type {
  ConnectionResult,
  CreateDeliveryInput,
  DeliveryProvider,
  DeliveryProviderCapabilities,
  DeliveryResult,
  DeliveryStatus
} from "@wardsen/core";
import { runCliCommand, type CliCommandInput, type CliCommandResult } from "@wardsen/security";

export type BitwardenSendCommandRunner = (input: CliCommandInput) => Promise<CliCommandResult>;

export interface BitwardenSendDeliveryOptions {
  executable?: string;
  getSessionToken(accountId: string): string;
  runCommand?: BitwardenSendCommandRunner;
}

export class BitwardenSendDeliveryProvider implements DeliveryProvider {
  readonly id = "bitwarden-send";
  readonly displayName = "Bitwarden Send";
  private readonly executable: string;
  private readonly runCommand: BitwardenSendCommandRunner;

  constructor(private readonly options: BitwardenSendDeliveryOptions) {
    this.executable = options.executable ?? "bw";
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
    const args = [
      "send",
      "text",
      input.sourceCredential.title,
      "--notes",
      "Created by WardSen",
      "--expirationDate",
      input.expiresAt.toISOString()
    ];
    if (input.viewLimit !== undefined) args.push("--maxAccessCount", String(input.viewLimit));
    if (input.hideText) args.push("--hidden");
    if (input.accessPassword) args.push("--password", input.accessPassword);
    const result = await this.run(accountId, args, text, [text, input.accessPassword ?? ""]);
    const parsed = safeJsonObject(result.stdout, "Bitwarden Send create response");
    const id = optionalString(parsed.id);
    const url = optionalString(parsed.accessUrl) ?? optionalString(parsed.url);
    if (!id) throw new Error("Bitwarden Send did not return a delivery id");
    if (!url) throw new Error("Bitwarden Send did not return an access URL");
    return { deliveryId: id, url, expiresAt: input.expiresAt, viewLimit: input.viewLimit };
  }

  async revoke(accountId: string, deliveryId: string): Promise<void> {
    await this.run(accountId, ["send", "remove", deliveryId]);
  }

  async getStatus(accountId: string, deliveryId: string): Promise<DeliveryStatus> {
    const result = await this.run(accountId, ["send", "get", deliveryId]);
    const parsed = safeJsonObject(result.stdout, "Bitwarden Send status response");
    const id = optionalString(parsed.id);
    if (!id) throw new Error("Bitwarden Send status response is missing a delivery id");
    const expiresAt = optionalDate(parsed.expirationDate);
    return {
      deliveryId: id,
      status: parsed.disabled === true ? "revoked" : expiresAt && expiresAt.getTime() <= Date.now() ? "expired" : "active",
      accessCount: optionalNumber(parsed.accessCount),
      expiresAt
    };
  }

  private async run(accountId: string, args: string[], stdin?: string | string[], redact: string[] = []) {
    const sessionToken = this.options.getSessionToken(accountId);
    const stdinValue = Array.isArray(stdin) ? undefined : stdin;
    return await this.runCommand({
      executable: this.executable,
      args,
      stdin: stdinValue,
      env: { BW_SESSION: sessionToken },
      redact: [sessionToken, ...redact],
      timeoutMs: 60_000
    });
  }
}

function formatCredentialText(credential: CreateDeliveryInput["sourceCredential"]): string {
  const lines = [`Title: ${credential.title}`];
  if (credential.username) lines.push(`Username: ${credential.username}`);
  if (credential.password) lines.push(`Password: ${credential.password}`);
  if (credential.urls.length) lines.push(`URLs: ${credential.urls.join(", ")}`);
  if (credential.notes) lines.push(`Notes: ${credential.notes}`);
  if (credential.totp) lines.push(`TOTP: ${credential.totp}`);
  return lines.join("\n");
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
