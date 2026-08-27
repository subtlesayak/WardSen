import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSessionManager, type AccountRecord, type CredentialProvider } from "@wardsen/core";
import { InMemoryWardSenRepository } from "@wardsen/database";
import { AccountDeletionService } from "../apps/server/src/accountDeletionService";

const CLEANUP_TOMBSTONES_SETTING = "account_profile_cleanup_tombstones";
const workingDirectories: string[] = [];

describe("AccountDeletionService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of workingDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("removes an account with no local profile after clearing its in-memory session", async () => {
    const setup = await createSetup();
    const account = await createAccount(setup.repository, setup.profileRoot, "missing");
    setup.sessions.markUnlocked(account.id, account.providerId, "in-memory-session");

    const result = await setup.service.deleteAccount(account);

    expect(result).toEqual({ profileCleanup: "missing", logout: "completed" });
    expect(await setup.repository.listAccounts()).toEqual([]);
    expect(setup.sessions.snapshot()).toEqual([]);
    expect(setup.provider.logout).toHaveBeenCalledWith(account.id, { timeoutMs: 2_000 });
    expect(setup.clearedAccountIds).toEqual([account.id]);
  });

  it("quarantines and removes only the deterministic profile for the deleted account", async () => {
    const setup = await createSetup();
    const first = await createAccount(setup.repository, setup.profileRoot, "first");
    const second = await createAccount(setup.repository, setup.profileRoot, "second");
    fs.mkdirSync(first.profileDirectory, { recursive: true });
    fs.writeFileSync(path.join(first.profileDirectory, "provider-state.json"), "state");
    fs.mkdirSync(second.profileDirectory, { recursive: true });
    fs.writeFileSync(path.join(second.profileDirectory, "provider-state.json"), "other-state");

    const result = await setup.service.deleteAccount(first);

    expect(result.profileCleanup).toBe("removed");
    expect(fs.existsSync(first.profileDirectory)).toBe(false);
    expect(fs.readFileSync(path.join(second.profileDirectory, "provider-state.json"), "utf8")).toBe("other-state");
    expect((await setup.repository.listAccounts()).map((account) => account.id)).toEqual([second.id]);
  });

  it("continues local profile cleanup when provider logout fails", async () => {
    const setup = await createSetup({ logout: async () => { throw new Error("provider unavailable"); } });
    const account = await createAccount(setup.repository, setup.profileRoot, "logout-failure");
    fs.mkdirSync(account.profileDirectory, { recursive: true });

    const result = await setup.service.deleteAccount(account);

    expect(result).toEqual({ profileCleanup: "removed", logout: "failed" });
    expect(fs.existsSync(account.profileDirectory)).toBe(false);
    expect(await setup.repository.listAccounts()).toEqual([]);
  });

  it("restores the profile when deleting the SQLite account record fails", async () => {
    const setup = await createSetup();
    const account = await createAccount(setup.repository, setup.profileRoot, "database-failure");
    fs.mkdirSync(account.profileDirectory, { recursive: true });
    fs.writeFileSync(path.join(account.profileDirectory, "provider-state.json"), "restore-me");
    vi.spyOn(setup.repository, "deleteAccount").mockRejectedValueOnce(new Error("database busy"));

    await expect(setup.service.deleteAccount(account)).rejects.toMatchObject({ reason: "database_delete_failed" });

    expect(fs.readFileSync(path.join(account.profileDirectory, "provider-state.json"), "utf8")).toBe("restore-me");
    expect((await setup.repository.listAccounts()).map((record) => record.id)).toEqual([account.id]);
    expect(await setup.repository.getLocalSetting(CLEANUP_TOMBSTONES_SETTING)).toBe("[]");
  });

  it("stores a metadata-only tombstone and retries cleanup after a locked-file failure", async () => {
    const setup = await createSetup({
      removeDirectory: () => {
        const error = new Error("directory is busy") as NodeJS.ErrnoException;
        error.code = "EBUSY";
        throw error;
      }
    });
    const account = await createAccount(setup.repository, setup.profileRoot, "locked-directory");
    fs.mkdirSync(account.profileDirectory, { recursive: true });
    fs.writeFileSync(path.join(account.profileDirectory, "provider-state.json"), "retry-me");

    const result = await setup.service.deleteAccount(account);

    expect(result.profileCleanup).toBe("pending");
    expect(await setup.repository.listAccounts()).toEqual([]);
    const tombstones = JSON.parse((await setup.repository.getLocalSetting(CLEANUP_TOMBSTONES_SETTING)) ?? "[]") as Array<{ accountId: string; quarantineName: string }>;
    expect(tombstones).toEqual([expect.objectContaining({ accountId: account.id, quarantineName: expect.stringMatching(/^account-[0-9a-f-]{36}$/) })]);

    const retryService = createService(setup.profileRoot, setup.repository, setup.sessions, setup.provider, setup.clearedAccountIds);
    await expect(retryService.retryPendingProfileCleanup()).resolves.toEqual([{ accountId: account.id, outcome: "removed" }]);
    expect(await setup.repository.getLocalSetting(CLEANUP_TOMBSTONES_SETTING)).toBe("[]");
  });

  it("rejects an altered stored path without touching files outside the managed profile root", async () => {
    const setup = await createSetup();
    const outsideDirectory = path.join(path.dirname(setup.profileRoot), "outside");
    fs.mkdirSync(outsideDirectory, { recursive: true });
    fs.writeFileSync(path.join(outsideDirectory, "keep.txt"), "do not remove");
    const account = await createAccount(setup.repository, setup.profileRoot, "altered-path", outsideDirectory);

    await expect(setup.service.deleteAccount(account)).rejects.toMatchObject({ reason: "profile_path_invalid" });

    expect(fs.readFileSync(path.join(outsideDirectory, "keep.txt"), "utf8")).toBe("do not remove");
    expect((await setup.repository.listAccounts()).map((record) => record.id)).toEqual([account.id]);
  });

  it("rejects a profile path substituted from another WardSen account", async () => {
    const setup = await createSetup();
    const first = await createAccount(setup.repository, setup.profileRoot, "first");
    const second = await createAccount(setup.repository, setup.profileRoot, "second");
    fs.mkdirSync(second.profileDirectory, { recursive: true });
    fs.writeFileSync(path.join(second.profileDirectory, "keep.txt"), "do not remove");
    const alteredFirst: AccountRecord = { ...first, profileDirectory: second.profileDirectory };

    await expect(setup.service.deleteAccount(alteredFirst)).rejects.toMatchObject({ reason: "profile_path_invalid" });

    expect(fs.readFileSync(path.join(second.profileDirectory, "keep.txt"), "utf8")).toBe("do not remove");
    expect((await setup.repository.listAccounts()).map((record) => record.id).sort()).toEqual([first.id, second.id]);
  });

  it("rejects a symlink or junction attack and never follows it", async () => {
    const setup = await createSetup();
    const account = await createAccount(setup.repository, setup.profileRoot, "linked-profile");
    const outsideDirectory = path.join(path.dirname(setup.profileRoot), "outside");
    fs.mkdirSync(outsideDirectory, { recursive: true });
    fs.writeFileSync(path.join(outsideDirectory, "keep.txt"), "do not remove");
    fs.mkdirSync(setup.profileRoot, { recursive: true });
    fs.symlinkSync(outsideDirectory, account.profileDirectory, process.platform === "win32" ? "junction" : "dir");

    await expect(setup.service.deleteAccount(account)).rejects.toMatchObject({ reason: "profile_path_invalid" });

    expect(fs.readFileSync(path.join(outsideDirectory, "keep.txt"), "utf8")).toBe("do not remove");
    expect((await setup.repository.listAccounts()).map((record) => record.id)).toEqual([account.id]);
  });

  it("rejects a managed profile root canonical redirect before touching its children", async () => {
    const setup = await createSetup();
    const account = await createAccount(setup.repository, setup.profileRoot, "redirected-root");
    const outsideRoot = path.join(path.dirname(setup.profileRoot), "outside-root");
    const redirectedProfile = path.join(outsideRoot, account.id);
    fs.mkdirSync(redirectedProfile, { recursive: true });
    fs.writeFileSync(path.join(redirectedProfile, "keep.txt"), "do not remove");
    fs.symlinkSync(outsideRoot, setup.profileRoot, process.platform === "win32" ? "junction" : "dir");

    await expect(setup.service.deleteAccount(account)).rejects.toMatchObject({ reason: "profile_path_invalid" });

    expect(fs.readFileSync(path.join(redirectedProfile, "keep.txt"), "utf8")).toBe("do not remove");
    expect((await setup.repository.listAccounts()).map((record) => record.id)).toEqual([account.id]);
  });

  it("unlinks linked children without following them during a valid profile removal", async () => {
    const setup = await createSetup();
    const account = await createAccount(setup.repository, setup.profileRoot, "linked-child");
    const outsideDirectory = path.join(path.dirname(setup.profileRoot), "outside");
    fs.mkdirSync(account.profileDirectory, { recursive: true });
    fs.mkdirSync(outsideDirectory, { recursive: true });
    fs.writeFileSync(path.join(outsideDirectory, "keep.txt"), "do not remove");
    fs.symlinkSync(outsideDirectory, path.join(account.profileDirectory, "provider-link"), process.platform === "win32" ? "junction" : "dir");

    await expect(setup.service.deleteAccount(account)).resolves.toMatchObject({ profileCleanup: "removed" });

    expect(fs.readFileSync(path.join(outsideDirectory, "keep.txt"), "utf8")).toBe("do not remove");
  });

  it("waits for an existing account operation and rejects later operations while deletion is in progress", async () => {
    const setup = await createSetup();
    const account = await createAccount(setup.repository, setup.profileRoot, "operation-lock");
    setup.sessions.markUnlocked(account.id, account.providerId, "in-memory-session");
    let releaseOperation!: () => void;
    const existingOperation = setup.sessions.withOperation(account.id, account.providerId, async () => {
      await new Promise<void>((resolve) => {
        releaseOperation = resolve;
      });
    });

    const deleting = setup.service.deleteAccount(account);
    expect(setup.sessions.isDeletionInProgress(account.id)).toBe(true);
    await expect(setup.sessions.withOperation(account.id, account.providerId, async () => undefined)).rejects.toThrow("Account deletion is already in progress");
    releaseOperation();
    await existingOperation;
    await expect(deleting).resolves.toMatchObject({ profileCleanup: "missing" });
  });
});

async function createSetup(input: { logout?: CredentialProvider["logout"]; removeDirectory?: (directoryPath: string) => void } = {}) {
  const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "wardsen-account-delete-"));
  workingDirectories.push(workingDirectory);
  const profileRoot = path.join(workingDirectory, "profiles");
  const repository = new InMemoryWardSenRepository();
  const sessions = new AccountSessionManager();
  const provider = createProvider(input.logout);
  const clearedAccountIds: string[] = [];
  const service = createService(profileRoot, repository, sessions, provider, clearedAccountIds, input.removeDirectory);
  return { profileRoot, repository, sessions, provider, clearedAccountIds, service, workingDirectory };
}

function createService(
  profileRoot: string,
  repository: InMemoryWardSenRepository,
  sessions: AccountSessionManager,
  provider: CredentialProvider & { logout: ReturnType<typeof vi.fn> },
  clearedAccountIds: string[],
  removeDirectory?: (directoryPath: string) => void
) {
  return new AccountDeletionService({
    profileRoot,
    repository,
    sessions,
    providerFor: () => provider,
    clearSensitiveResultCache: (accountId) => {
      clearedAccountIds.push(accountId);
    },
    removeDirectory
  });
}

async function createAccount(repository: InMemoryWardSenRepository, profileRoot: string, id: string, profileDirectory = path.join(profileRoot, id)): Promise<AccountRecord> {
  return await repository.upsertAccount({
    id,
    providerId: "test-provider",
    label: id,
    profileDirectory,
    autoLockMinutes: 10
  });
}

function createProvider(logoutImplementation?: CredentialProvider["logout"]): CredentialProvider & { logout: ReturnType<typeof vi.fn> } {
  return {
    id: "test-provider",
    displayName: "Test provider",
    getCapabilities: async () => ({ searchItems: true, multipleAccounts: true, customServers: false, localVaults: false, synchronization: false, locking: true }),
    testConnection: async () => ({ ok: true, status: "locked" }),
    login: async () => undefined,
    unlock: async () => undefined,
    lock: async () => undefined,
    logout: vi.fn(logoutImplementation ?? (async () => undefined)),
    sync: async () => undefined,
    search: async () => [],
    getCredential: async () => ({ title: "unused", urls: [] })
  };
}
