import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AccountSessionManager, type AccountRecord, type CredentialProvider } from "@wardsen/core";
import type { WardSenRepository } from "@wardsen/database";
import { assertManagedProfileDirectoryTarget, assertManagedProfileRoot, managedProfileDirectory, pathExists, pathsEqual } from "./managedProfileDirectory";

const CLEANUP_TOMBSTONES_SETTING = "account_profile_cleanup_tombstones";
const QUARANTINE_DIRECTORY_NAME = ".wardsen-account-deletion-quarantine";
const DEFAULT_LOGOUT_TIMEOUT_MS = 2_000;

type CleanupTombstone = {
  accountId: string;
  quarantineName: string;
  createdAt: string;
};

export type AccountDeletionReason =
  | "account_deletion_in_progress"
  | "profile_path_invalid"
  | "profile_quarantine_failed"
  | "profile_tombstone_failed"
  | "database_delete_failed"
  | "profile_restore_failed";

export class AccountDeletionError extends Error {
  constructor(readonly reason: AccountDeletionReason) {
    super(accountDeletionMessage(reason));
    this.name = "AccountDeletionError";
  }
}

export interface AccountDeletionResult {
  profileCleanup: "missing" | "removed" | "pending";
  logout: "completed" | "failed" | "timed_out";
}

export interface AccountProfileCleanupRetryResult {
  accountId: string;
  outcome: "removed" | "restored" | "pending";
  reason?: "cleanup_failed" | "restore_failed" | "path_invalid";
}

export interface AccountDeletionServiceOptions {
  profileRoot: string;
  sessions: AccountSessionManager;
  repository: WardSenRepository;
  providerFor: (providerId: string) => CredentialProvider;
  clearSensitiveResultCache: (accountId: string) => Promise<void> | void;
  logoutTimeoutMs?: number;
  removeDirectory?: (directoryPath: string) => void;
}

export class AccountDeletionService {
  private readonly logoutTimeoutMs: number;
  private readonly removeDirectory: (directoryPath: string) => void;

  constructor(private readonly options: AccountDeletionServiceOptions) {
    this.logoutTimeoutMs = Math.max(100, options.logoutTimeoutMs ?? DEFAULT_LOGOUT_TIMEOUT_MS);
    this.removeDirectory = options.removeDirectory ?? removeDirectoryWithoutFollowingLinks;
  }

  async deleteAccount(account: AccountRecord): Promise<AccountDeletionResult> {
    try {
      return await this.options.sessions.withDeletionLock(account.id, account.providerId, async () => {
        const profileDirectory = this.validateProfileDirectory(account);
        this.options.sessions.clearAccount(account.id);
        await this.options.clearSensitiveResultCache(account.id);
        const logout = await this.tryProviderLogout(account);

        if (!pathExists(profileDirectory)) {
          await this.deleteAccountRecord(account.id);
          return { profileCleanup: "missing", logout };
        }

        const tombstone = this.quarantineProfile(account.id, profileDirectory);
        try {
          await this.addTombstone(tombstone);
        } catch {
          await this.restoreAfterFailedDelete(tombstone, profileDirectory);
          throw new AccountDeletionError("profile_tombstone_failed");
        }

        try {
          await this.options.repository.deleteAccount(account.id);
        } catch {
          await this.restoreAfterFailedDelete(tombstone, profileDirectory);
          throw new AccountDeletionError("database_delete_failed");
        }

        try {
          this.removeQuarantinedProfile(tombstone);
          await this.removeTombstone(tombstone);
          return { profileCleanup: "removed", logout };
        } catch {
          return { profileCleanup: "pending", logout };
        }
      });
    } catch (error) {
      if (error instanceof AccountDeletionError) throw error;
      if (isDeletionInProgressError(error)) throw new AccountDeletionError("account_deletion_in_progress");
      throw error;
    }
  }

  async retryPendingProfileCleanup(): Promise<AccountProfileCleanupRetryResult[]> {
    const tombstones = await this.readTombstones();
    if (!tombstones.length) return [];
    const accountsById = new Map((await this.options.repository.listAccounts()).map((account) => [account.id, account]));
    const remaining: CleanupTombstone[] = [];
    const results: AccountProfileCleanupRetryResult[] = [];

    for (const tombstone of tombstones) {
      try {
        const account = accountsById.get(tombstone.accountId);
        if (account) {
          this.restoreQuarantinedProfile(tombstone, this.validateProfileDirectory(account));
          results.push({ accountId: tombstone.accountId, outcome: "restored" });
        } else {
          this.removeQuarantinedProfile(tombstone);
          results.push({ accountId: tombstone.accountId, outcome: "removed" });
        }
      } catch (error) {
        remaining.push(tombstone);
        results.push({
          accountId: tombstone.accountId,
          outcome: "pending",
          reason: error instanceof AccountDeletionError ? "path_invalid" : accountsById.has(tombstone.accountId) ? "restore_failed" : "cleanup_failed"
        });
      }
    }
    await this.writeTombstones(remaining);
    return results;
  }

  private validateProfileDirectory(account: AccountRecord): string {
    const expected = managedProfileDirectory(this.options.profileRoot, account.id);
    if (!pathsEqual(account.profileDirectory, expected)) {
      throw new AccountDeletionError("profile_path_invalid");
    }
    if (pathsEqual(expected, this.quarantineDirectory())) {
      throw new AccountDeletionError("profile_path_invalid");
    }
    try {
      assertManagedProfileDirectoryTarget(this.options.profileRoot, expected);
    } catch {
      throw new AccountDeletionError("profile_path_invalid");
    }
    return expected;
  }

  private async tryProviderLogout(account: AccountRecord): Promise<AccountDeletionResult["logout"]> {
    const provider = this.options.providerFor(account.providerId);
    const result = await Promise.race([
      Promise.resolve().then(() => provider.logout(account.id, { timeoutMs: this.logoutTimeoutMs })).then(
        () => "completed" as const,
        () => "failed" as const
      ),
      timeoutResult(this.logoutTimeoutMs)
    ]);
    return result;
  }

  private quarantineProfile(accountId: string, profileDirectory: string): CleanupTombstone {
    const quarantineDirectory = this.ensureQuarantineDirectory();
    try {
      assertManagedProfileDirectoryTarget(this.options.profileRoot, profileDirectory);
      const quarantineName = `account-${crypto.randomUUID()}`;
      const quarantinePath = path.resolve(quarantineDirectory, quarantineName);
      assertDirectChild(quarantineDirectory, quarantinePath);
      fs.renameSync(profileDirectory, quarantinePath);
      return { accountId, quarantineName, createdAt: new Date().toISOString() };
    } catch (error) {
      if (error instanceof AccountDeletionError) throw error;
      throw new AccountDeletionError("profile_quarantine_failed");
    }
  }

  private restoreQuarantinedProfile(tombstone: CleanupTombstone, profileDirectory: string): void {
    this.ensureQuarantineDirectory();
    const quarantinedDirectory = this.quarantinedDirectory(tombstone);
    if (!pathExists(quarantinedDirectory)) return;
    if (pathExists(profileDirectory)) throw new AccountDeletionError("profile_restore_failed");
    fs.renameSync(quarantinedDirectory, profileDirectory);
    try {
      assertManagedProfileDirectoryTarget(this.options.profileRoot, profileDirectory);
    } catch {
      throw new AccountDeletionError("profile_restore_failed");
    }
  }

  private async restoreAfterFailedDelete(tombstone: CleanupTombstone, profileDirectory: string): Promise<void> {
    try {
      this.restoreQuarantinedProfile(tombstone, profileDirectory);
    } catch {
      throw new AccountDeletionError("profile_restore_failed");
    }
    // A stale tombstone is harmless: startup observes the restored profile and drops it.
    await this.removeTombstone(tombstone).catch(() => undefined);
  }

  private removeQuarantinedProfile(tombstone: CleanupTombstone): void {
    this.ensureQuarantineDirectory();
    const quarantinedDirectory = this.quarantinedDirectory(tombstone);
    if (!pathExists(quarantinedDirectory)) return;
    this.removeDirectory(quarantinedDirectory);
  }

  private quarantineDirectory(): string {
    return path.resolve(this.options.profileRoot, QUARANTINE_DIRECTORY_NAME);
  }

  private ensureQuarantineDirectory(): string {
    const profileRoot = path.resolve(this.options.profileRoot);
    if (!pathExists(profileRoot)) fs.mkdirSync(profileRoot, { recursive: true });
    assertManagedProfileRoot(profileRoot);
    const quarantineDirectory = this.quarantineDirectory();
    assertDirectChild(profileRoot, quarantineDirectory);
    fs.mkdirSync(quarantineDirectory, { recursive: true });
    try {
      assertManagedProfileDirectoryTarget(profileRoot, quarantineDirectory);
    } catch {
      throw new AccountDeletionError("profile_path_invalid");
    }
    return quarantineDirectory;
  }

  private quarantinedDirectory(tombstone: CleanupTombstone): string {
    if (!isValidTombstone(tombstone)) throw new AccountDeletionError("profile_path_invalid");
    const quarantineDirectory = this.quarantineDirectory();
    const target = path.resolve(quarantineDirectory, tombstone.quarantineName);
    assertDirectChild(quarantineDirectory, target);
    return target;
  }

  private async deleteAccountRecord(accountId: string): Promise<void> {
    try {
      await this.options.repository.deleteAccount(accountId);
    } catch {
      throw new AccountDeletionError("database_delete_failed");
    }
  }

  private async addTombstone(tombstone: CleanupTombstone): Promise<void> {
    const tombstones = await this.readTombstones();
    await this.writeTombstones([...tombstones.filter((entry) => entry.quarantineName !== tombstone.quarantineName), tombstone]);
  }

  private async removeTombstone(tombstone: CleanupTombstone): Promise<void> {
    const tombstones = await this.readTombstones();
    await this.writeTombstones(tombstones.filter((entry) => entry.quarantineName !== tombstone.quarantineName));
  }

  private async readTombstones(): Promise<CleanupTombstone[]> {
    const raw = await this.options.repository.getLocalSetting(CLEANUP_TOMBSTONES_SETTING);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isValidTombstone) : [];
    } catch {
      return [];
    }
  }

  private async writeTombstones(tombstones: CleanupTombstone[]): Promise<void> {
    await this.options.repository.setLocalSetting(CLEANUP_TOMBSTONES_SETTING, JSON.stringify(tombstones));
  }
}

function removeDirectoryWithoutFollowingLinks(directoryPath: string): void {
  const stats = fs.lstatSync(directoryPath);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    fs.unlinkSync(directoryPath);
    return;
  }
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const child = path.join(directoryPath, entry.name);
    const childStats = fs.lstatSync(child);
    if (childStats.isSymbolicLink() || !childStats.isDirectory()) {
      fs.unlinkSync(child);
    } else {
      removeDirectoryWithoutFollowingLinks(child);
    }
  }
  fs.rmdirSync(directoryPath);
}

function timeoutResult(timeoutMs: number): Promise<"timed_out"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timed_out"), timeoutMs);
    timer.unref?.();
  });
}

function isValidTombstone(value: unknown): value is CleanupTombstone {
  return typeof value === "object"
    && value !== null
    && typeof (value as CleanupTombstone).accountId === "string"
    && typeof (value as CleanupTombstone).createdAt === "string"
    && /^account-[0-9a-f-]{36}$/.test((value as CleanupTombstone).quarantineName);
}

function assertDirectChild(parentPath: string, childPath: string): void {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  if (!relative || relative.includes(path.sep) || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AccountDeletionError("profile_path_invalid");
  }
}

function isDeletionInProgressError(error: unknown): boolean {
  return error instanceof Error && error.message === "Account deletion is already in progress";
}

function accountDeletionMessage(reason: AccountDeletionReason): string {
  switch (reason) {
    case "account_deletion_in_progress":
      return "WardSen is already deleting this account. Wait for the current operation to finish.";
    case "profile_path_invalid":
      return "WardSen cannot delete this account because its provider profile is not the managed directory. Reconnect the account before retrying.";
    case "database_delete_failed":
      return "WardSen could not delete the account record. The managed provider profile was restored.";
    case "profile_restore_failed":
      return "WardSen could not restore the managed provider profile after the account deletion failed. Restart WardSen before retrying.";
    case "profile_tombstone_failed":
      return "WardSen could not record the managed profile cleanup state. The account was not deleted.";
    case "profile_quarantine_failed":
      return "WardSen could not prepare the managed provider profile for deletion. Close programs using it and retry.";
  }
}
