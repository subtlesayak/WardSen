import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type {
  ConnectionResult,
  CreateDeliveryInput,
  DeliveryProvider,
  DeliveryProviderCapabilities,
  DeliveryResult,
  DeliveryStatus,
  SensitiveCredential
} from "@wardsen/core";
import { formatDeliveryCredentialText } from "@wardsen/core";

export type ClipboardWriter = (text: string) => Promise<void>;

export interface EntePasteDeliveryOptions {
  writeClipboard?: ClipboardWriter;
  now?: () => Date;
}

const ENTE_PASTE_CHARACTER_LIMIT = 4000;
const ENTE_PASTE_TTL_MS = 24 * 60 * 60 * 1000;
const ENTE_PASTE_URL = "https://paste.ente.com/";

export class EntePasteManualDeliveryProvider implements DeliveryProvider {
  readonly id = "ente-paste";
  readonly displayName = "Ente Paste (experimental manual)";
  private readonly writeClipboard: ClipboardWriter;
  private readonly now: () => Date;

  constructor(options: EntePasteDeliveryOptions = {}) {
    this.writeClipboard = options.writeClipboard ?? writeSystemClipboard;
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
    return {
      ok: true,
      status: "unlocked",
      safeMessage: "Ente Paste is a manual browser handoff. WardSen does not sign in to Ente or receive sender-visible status telemetry."
    };
  }

  async createDelivery(input: CreateDeliveryInput): Promise<DeliveryResult> {
    if (input.viewLimit !== undefined && input.viewLimit !== 1) {
      throw new Error("Ente Paste supports one open per link; leave view limit blank or use 1.");
    }
    if (input.accessPassword) {
      throw new Error("Ente Paste passwords must be configured in the Ente Paste browser flow and sent over a separate channel.");
    }
    if (input.hideText) {
      throw new Error("Ente Paste manual handoff cannot apply WardSen hidden-text settings.");
    }

    const text = formatCredentialText(input.sourceCredential);
    if (text.length > ENTE_PASTE_CHARACTER_LIMIT) {
      throw new Error(`Ente Paste accepts up to ${ENTE_PASTE_CHARACTER_LIMIT} characters. This credential handoff is ${text.length} characters.`);
    }

    await this.writeClipboard(text);
    const expiresAt = new Date(Math.min(input.expiresAt.getTime(), this.now().getTime() + ENTE_PASTE_TTL_MS));
    return {
      // Keep persisted delivery metadata independent from the credential handoff text.
      deliveryId: `ente-manual-${input.operationId ?? randomUUID()}`,
      url: ENTE_PASTE_URL,
      expiresAt,
      viewLimit: 1,
      status: "handoff_pending"
    };
  }

  async revoke(_accountId: string, _deliveryId: string): Promise<void> {
    throw new Error("Ente Paste manual handoff does not expose sender-side revoke through WardSen.");
  }

  async clearHandoffClipboard(): Promise<void> {
    await this.writeClipboard("");
  }

  async getStatus(_accountId: string, deliveryId: string): Promise<DeliveryStatus> {
    return { deliveryId, status: "handoff_pending" };
  }
}

export function formatCredentialText(credential: SensitiveCredential): string {
  return formatDeliveryCredentialText(credential);
}

async function writeSystemClipboard(text: string): Promise<void> {
  const commands = clipboardCommands();
  const errors: string[] = [];
  for (const command of commands) {
    try {
      await pipeToCommand(command.executable, command.args, text);
      return;
    } catch (error) {
      errors.push(`${command.executable}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Could not copy Ente Paste handoff text to the system clipboard. Tried: ${errors.join("; ")}`);
}

function clipboardCommands(): Array<{ executable: string; args: string[] }> {
  if (process.platform === "win32") return [{ executable: "clip.exe", args: [] }];
  if (process.platform === "darwin") return [{ executable: "pbcopy", args: [] }];
  return [
    { executable: "wl-copy", args: [] },
    { executable: "xclip", args: ["-selection", "clipboard"] },
    { executable: "xsel", args: ["--clipboard", "--input"] }
  ];
}

function pipeToCommand(executable: string, args: string[], text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `clipboard command exited with ${code}`));
      }
    });
    child.stdin.end(text);
  });
}
