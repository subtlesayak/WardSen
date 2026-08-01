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

export type KeePassXCCommandRunner = (input: CliCommandInput) => Promise<CliCommandResult>;

export interface KeePassXCProviderOptions {
  executable?: string;
  runCommand?: KeePassXCCommandRunner;
  sessions?: AccountSessionManager;
}

export class KeePassXCCredentialProvider implements CredentialProvider {
  readonly id = "keepassxc";
  readonly displayName = "KeePassXC";
  private readonly databases = new Map<string, { databasePath: string; password?: string; keyFilePath?: string }>();
  private readonly executable: string;
  private readonly runCommand: KeePassXCCommandRunner;
  private readonly sessions: AccountSessionManager;

  constructor(options: KeePassXCProviderOptions | string = {}) {
    if (typeof options === "string") {
      this.executable = options;
      this.runCommand = runCliCommand;
      this.sessions = new AccountSessionManager();
    } else {
      this.executable = options.executable ?? "keepassxc-cli";
      this.runCommand = options.runCommand ?? runCliCommand;
      this.sessions = options.sessions ?? new AccountSessionManager();
    }
  }

  async getCapabilities(): Promise<CredentialProviderCapabilities> {
    return {
      searchItems: true,
      multipleAccounts: true,
      customServers: false,
      localVaults: true,
      synchronization: false,
      locking: true
    };
  }

  async testConnection(accountId: string): Promise<ConnectionResult> {
    return { ok: this.databases.has(accountId), status: this.databases.has(accountId) ? "unlocked" : "locked" };
  }

  async login(_accountId: string, _input: ProviderLoginInput): Promise<void> {
    throw new Error("KeePassXC uses local database unlock rather than login");
  }

  async unlock(accountId: string, input: ProviderUnlockInput): Promise<void> {
    if (!input.databasePath) throw new Error("KeePassXC database path is required");
    await this.run(buildDatabaseArgs("db-info", input.databasePath, input.keyFilePath), input.password, [input.password ?? ""]);
    this.databases.set(accountId, {
      databasePath: input.databasePath,
      password: input.password,
      keyFilePath: input.keyFilePath
    });
    this.sessions.markUnlocked(accountId, this.id);
  }

  async lock(accountId: string): Promise<void> {
    this.databases.delete(accountId);
    this.sessions.markLocked(accountId);
  }

  async logout(accountId: string): Promise<void> {
    this.databases.delete(accountId);
    this.sessions.markLoggedOut(accountId);
  }

  async sync(_accountId: string): Promise<void> {
    throw new Error("KeePassXC local vaults do not support synchronization");
  }

  async search(accountId: string, query: string, pagination: PaginationInput): Promise<CredentialSummary[]> {
    this.requireDb(accountId);
    return await this.sessions.withOperation(accountId, this.id, async () => {
      const db = this.requireDb(accountId);
      const result = await this.run([...buildDatabaseArgs("search", db.databasePath, db.keyFilePath), query], db.password, [db.password ?? ""]);
      const rows = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const start = (Math.max(1, pagination.page) - 1) * pagination.pageSize;
      return rows.slice(start, start + pagination.pageSize).map((entryPath) => ({
        id: entryPath,
        accountId,
        providerId: this.id,
        title: entryPath.split("/").pop() ?? entryPath,
        itemType: "login" as const
      }));
    });
  }

  async getCredential(accountId: string, itemId: string): Promise<SensitiveCredential> {
    this.requireDb(accountId);
    return await this.sessions.withOperation(accountId, this.id, async () => {
      const db = this.requireDb(accountId);
      const result = await this.run(["show", "--show-protected", ...databasePathArgs(db.databasePath, db.keyFilePath), itemId], db.password, [db.password ?? ""]);
      return parseKeePassShow(itemId, result.stdout);
    });
  }

  private requireDb(accountId: string) {
    const db = this.databases.get(accountId);
    if (!db) throw new Error("KeePassXC account is locked");
    return db;
  }

  private async run(args: string[], stdin?: string, redact: string[] = []) {
    return await this.runCommand({ executable: this.executable, args, stdin, redact, timeoutMs: 60_000 });
  }
}

function buildDatabaseArgs(command: string, databasePath: string, keyFilePath?: string): string[] {
  return [command, ...databasePathArgs(databasePath, keyFilePath)];
}

function databasePathArgs(databasePath: string, keyFilePath?: string): string[] {
  return keyFilePath ? ["--key-file", keyFilePath, databasePath] : [databasePath];
}

function parseKeePassShow(itemId: string, stdout: string): SensitiveCredential {
  const fields = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    fields.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
  }
  return {
    title: fields.get("title") ?? itemId.split("/").pop() ?? itemId,
    username: fields.get("username"),
    password: fields.get("password"),
    urls: collectKeePassUrls(fields),
    notes: fields.get("notes"),
    totp: fields.get("totp")
  };
}

function collectKeePassUrls(fields: Map<string, string>): string[] {
  const values = [fields.get("url"), fields.get("urls")].filter((value): value is string => Boolean(value));
  return values.flatMap((value) => value.split(",").map((url) => url.trim()).filter(Boolean));
}
