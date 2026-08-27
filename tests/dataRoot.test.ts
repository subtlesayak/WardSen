import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteWardSenRepository } from "@wardsen/database";
import { dataRootCandidates, resolveWardSenDataRoot } from "../apps/server/src/dataRoot";

const tempRoots: string[] = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("WardSen data root resolution", () => {
  it("persists a non-secret Bitwarden provider principal ID", async () => {
    const root = tempDir();
    const databasePath = path.join(root, "wardsen.sqlite");
    const repository = new SqliteWardSenRepository(databasePath);
    await repository.upsertAccount({
      id: "work",
      providerId: "bitwarden",
      label: "Work",
      username: "work@example.test",
      providerPrincipalId: "bitwarden-user-id",
      profileDirectory: path.join(root, "profiles", "work"),
      autoLockMinutes: 10,
      status: "locked"
    });
    repository.close();

    const reopened = new SqliteWardSenRepository(databasePath);
    await expect(reopened.listAccounts()).resolves.toEqual([
      expect.objectContaining({ id: "work", providerPrincipalId: "bitwarden-user-id" })
    ]);
    reopened.close();
  });

  it("uses the configured data root when no previous database exists", () => {
    const root = tempDir();
    const selected = resolveWardSenDataRoot({
      cwd: root,
      env: { WARDSEN_DATA_DIR: path.join(root, "current") },
      homeDir: path.join(root, "home"),
      platform: "darwin"
    });

    expect(selected).toBe(path.join(root, "current"));
  });

  it("keeps a strict configured data root isolated from older data locations", async () => {
    const root = tempDir();
    const currentRoot = path.join(root, "current");
    const legacyRoot = path.join(root, "legacy");
    await writeAccountDatabase(legacyRoot, "legacy", "Legacy", path.join(legacyRoot, "profiles", "legacy"));

    const selected = resolveWardSenDataRoot({
      cwd: legacyRoot,
      env: { WARDSEN_DATA_DIR: currentRoot, WARDSEN_DATA_DIR_STRICT: "true" },
      homeDir: path.join(root, "home"),
      platform: "win32"
    });

    expect(selected).toBe(currentRoot);
    expect(fs.existsSync(path.join(currentRoot, "wardsen.sqlite"))).toBe(false);
  });

  it("migrates an older app-data database into an empty configured root", async () => {
    const root = tempDir();
    const currentRoot = path.join(root, "current");
    const homeDir = path.join(root, "home");
    const legacyRoot = path.join(homeDir, "Library", "Application Support", "dev.wardsen.desktop", "wardsen-data");
    const legacyProfile = path.join(legacyRoot, "profiles", "work");
    fs.mkdirSync(legacyProfile, { recursive: true });
    fs.writeFileSync(path.join(legacyProfile, "data.json"), "{}");
    await writeAccountDatabase(legacyRoot, "work", "Work", legacyProfile);
    await writeEmptyDatabase(currentRoot);

    const selected = resolveWardSenDataRoot({
      cwd: root,
      env: { WARDSEN_DATA_DIR: currentRoot },
      homeDir,
      platform: "darwin"
    });

    expect(selected).toBe(currentRoot);
    expect(fs.existsSync(path.join(currentRoot, "profiles", "work", "data.json"))).toBe(true);

    const database = new DatabaseSync(path.join(currentRoot, "wardsen.sqlite"));
    try {
      const row = database.prepare("SELECT id, label, profile_directory FROM accounts").get() as {
        id: string;
        label: string;
        profile_directory: string;
      };
      expect(row).toMatchObject({ id: "work", label: "Work" });
      expect(row.profile_directory).toBe(path.join(currentRoot, "profiles", "work"));
    } finally {
      database.close();
    }
  });

  it("keeps the fuller existing database when the configured root already has records", async () => {
    const root = tempDir();
    const currentRoot = path.join(root, "current");
    const homeDir = path.join(root, "home");
    const legacyRoot = path.join(homeDir, "Library", "Application Support", "dev.wardsen.desktop", "wardsen-data");
    await writeAccountDatabase(currentRoot, "new", "New", path.join(currentRoot, "profiles", "new"));
    await writeAccountDatabase(legacyRoot, "old-a", "Old A", path.join(legacyRoot, "profiles", "old-a"));
    await appendAccount(legacyRoot, "old-b", "Old B", path.join(legacyRoot, "profiles", "old-b"));

    const selected = resolveWardSenDataRoot({
      cwd: root,
      env: { WARDSEN_DATA_DIR: currentRoot },
      homeDir,
      platform: "darwin"
    });

    expect(selected).toBe(legacyRoot);
    expect(readAccountCount(currentRoot)).toBe(1);
    expect(readAccountCount(legacyRoot)).toBe(2);
  });

  it("checks legacy Windows app-data roots as update candidates", () => {
    const root = tempDir();
    const localAppData = path.join(root, "LocalAppData");
    const appData = path.join(root, "AppData");
    const candidates = dataRootCandidates({
      cwd: root,
      env: {
        WARDSEN_DATA_DIR: path.join(root, "current"),
        LOCALAPPDATA: localAppData,
        APPDATA: appData
      },
      platform: "win32"
    });

    expect(candidates).toContain(path.join(localAppData, "WardSen", "data"));
    expect(candidates).toContain(path.join(localAppData, "dev.wardsen.desktop", "wardsen-data"));
    expect(candidates).toContain(path.join(appData, "dev.wardsen.desktop", "wardsen-data"));
  });
});

function tempDir(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wardsen-data-root-"));
  tempRoots.push(root);
  return root;
}

async function writeEmptyDatabase(dataRoot: string): Promise<void> {
  const repository = new SqliteWardSenRepository(path.join(dataRoot, "wardsen.sqlite"));
  repository.close();
}

async function writeAccountDatabase(dataRoot: string, id: string, label: string, profileDirectory: string): Promise<void> {
  const repository = new SqliteWardSenRepository(path.join(dataRoot, "wardsen.sqlite"));
  await repository.upsertAccount({
    id,
    providerId: "bitwarden",
    label,
    profileDirectory,
    autoLockMinutes: 15,
    status: "locked"
  });
  repository.close();
}

async function appendAccount(dataRoot: string, id: string, label: string, profileDirectory: string): Promise<void> {
  await writeAccountDatabase(dataRoot, id, label, profileDirectory);
}

function readAccountCount(dataRoot: string): number {
  const database = new DatabaseSync(path.join(dataRoot, "wardsen.sqlite"));
  try {
    const row = database.prepare("SELECT COUNT(*) AS count FROM accounts").get() as { count: number };
    return row.count;
  } finally {
    database.close();
  }
}
