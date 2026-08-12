import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DATABASE_FILE = "wardsen.sqlite";
const PERSISTENCE_TABLES = [
  "accounts",
  "people",
  "deliveries",
  "delivery_batches",
  "employees",
  "employee_sign_in_codes",
  "employee_sessions",
  "credential_catalog",
  "credential_access_requests",
  "audit_log"
];

export interface DataRootResolutionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
}

interface DataRootInfo {
  path: string;
  hasDatabase: boolean;
  accountCount: number;
  recordCount: number;
  databaseSize: number;
}

export function resolveWardSenDataRoot(options: DataRootResolutionOptions = {}): string {
  const candidates = dataRootCandidates(options);
  const primary = candidates[0];
  const env = options.env ?? process.env;
  if (env.WARDSEN_DATA_DIR_STRICT === "true") return primary;
  const candidateInfo = candidates.map((candidate) => inspectDataRoot(candidate));
  const bestExisting = chooseMostCompleteDataRoot(candidateInfo);

  if (!bestExisting || sameResolvedPath(bestExisting.path, primary)) return primary;

  const primaryInfo = candidateInfo.find((candidate) => sameResolvedPath(candidate.path, primary)) ?? inspectDataRoot(primary);
  if (primaryInfo.recordCount === 0) {
    try {
      migrateDataRoot(bestExisting.path, primary);
      return primary;
    } catch {
      return bestExisting.path;
    }
  }

  return bestExisting.path;
}

export function dataRootCandidates(options: DataRootResolutionOptions = {}): string[] {
  const env = options.env ?? process.env;
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? env.HOME ?? env.USERPROFILE ?? os.homedir();
  const candidates: string[] = [];

  pushCandidate(candidates, env.WARDSEN_DATA_DIR ? path.resolve(env.WARDSEN_DATA_DIR) : path.join(cwd, ".wardsen-data"));
  pushCandidate(candidates, path.join(cwd, ".wardsen-data"));

  if (platform === "win32") {
    if (env.LOCALAPPDATA) {
      pushCandidate(candidates, path.join(env.LOCALAPPDATA, "WardSen", "data"));
      pushCandidate(candidates, path.join(env.LOCALAPPDATA, "dev.wardsen.desktop", "wardsen-data"));
    }
    if (env.APPDATA) {
      pushCandidate(candidates, path.join(env.APPDATA, "WardSen", "data"));
      pushCandidate(candidates, path.join(env.APPDATA, "dev.wardsen.desktop", "wardsen-data"));
    }
  } else if (platform === "darwin" && homeDir) {
    const applicationSupport = path.join(homeDir, "Library", "Application Support");
    pushCandidate(candidates, path.join(applicationSupport, "dev.wardsen.desktop", "wardsen-data"));
    pushCandidate(candidates, path.join(applicationSupport, "WardSen", "data"));
  } else {
    const xdgDataHome = env.XDG_DATA_HOME ?? (homeDir ? path.join(homeDir, ".local", "share") : undefined);
    if (xdgDataHome) {
      pushCandidate(candidates, path.join(xdgDataHome, "dev.wardsen.desktop", "wardsen-data"));
      pushCandidate(candidates, path.join(xdgDataHome, "WardSen", "data"));
    }
    if (homeDir) pushCandidate(candidates, path.join(homeDir, ".wardsen", "data"));
  }

  return candidates;
}

function inspectDataRoot(dataRoot: string): DataRootInfo {
  const databasePath = path.join(dataRoot, DATABASE_FILE);
  const base: DataRootInfo = {
    path: dataRoot,
    hasDatabase: false,
    accountCount: 0,
    recordCount: 0,
    databaseSize: 0
  };

  let stats: fs.Stats;
  try {
    stats = fs.statSync(databasePath);
  } catch {
    return base;
  }
  if (!stats.isFile()) return base;

  const counts = countPersistentRows(databasePath);
  return {
    path: dataRoot,
    hasDatabase: true,
    accountCount: counts.accountCount,
    recordCount: counts.recordCount,
    databaseSize: stats.size
  };
}

function chooseMostCompleteDataRoot(candidates: DataRootInfo[]): DataRootInfo | undefined {
  return candidates
    .filter((candidate) => candidate.hasDatabase)
    .sort((left, right) =>
      right.accountCount - left.accountCount ||
      right.recordCount - left.recordCount ||
      right.databaseSize - left.databaseSize ||
      candidates.indexOf(left) - candidates.indexOf(right)
    )[0];
}

function countPersistentRows(databasePath: string): { accountCount: number; recordCount: number } {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const counts = Object.fromEntries(PERSISTENCE_TABLES.map((table) => [table, countRows(database!, table)]));
    return {
      accountCount: counts.accounts ?? 0,
      recordCount: Object.values(counts).reduce((sum, count) => sum + count, 0)
    };
  } catch {
    return { accountCount: 0, recordCount: 0 };
  } finally {
    database?.close();
  }
}

function countRows(database: DatabaseSync, table: string): number {
  const tableRow = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { name: string } | undefined;
  if (!tableRow) return 0;
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number } | undefined;
  return Number(row?.count ?? 0);
}

function migrateDataRoot(sourceRoot: string, targetRoot: string): void {
  fs.mkdirSync(targetRoot, { recursive: true });
  backupExistingDatabaseFiles(targetRoot);
  copyDataRootContents(sourceRoot, targetRoot);
  rewriteProfileDirectories(path.join(targetRoot, DATABASE_FILE), sourceRoot, targetRoot);
}

function backupExistingDatabaseFiles(dataRoot: string): void {
  const suffix = `.pre-migration-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  for (const name of [DATABASE_FILE, `${DATABASE_FILE}-wal`, `${DATABASE_FILE}-shm`]) {
    const target = path.join(dataRoot, name);
    if (fs.existsSync(target)) fs.renameSync(target, `${target}${suffix}.bak`);
  }
}

function copyDataRootContents(sourceRoot: string, targetRoot: string): void {
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    const source = path.join(sourceRoot, entry.name);
    const target = path.join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copyDataRootContents(source, target);
    } else if (entry.isFile()) {
      fs.copyFileSync(source, target);
    }
  }
}

function rewriteProfileDirectories(databasePath: string, sourceRoot: string, targetRoot: string): void {
  if (!fs.existsSync(databasePath)) return;

  const sourceProfiles = path.join(sourceRoot, "profiles");
  const targetProfiles = path.join(targetRoot, "profiles");
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath);
    const tableRow = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'accounts'")
      .get() as { name: string } | undefined;
    if (!tableRow) return;

    const rows = database.prepare("SELECT id, profile_directory FROM accounts").all() as Array<{ id: string; profile_directory: string }>;
    const update = database.prepare("UPDATE accounts SET profile_directory = ? WHERE id = ?");
    for (const row of rows) {
      if (!isPathInside(row.profile_directory, sourceProfiles)) continue;
      const relative = path.relative(sourceProfiles, row.profile_directory);
      update.run(path.join(targetProfiles, relative), row.id);
    }
  } finally {
    database?.close();
  }
}

function isPathInside(candidatePath: string, parentPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function pushCandidate(candidates: string[], candidate: string | undefined): void {
  if (!candidate) return;
  const resolved = path.resolve(candidate);
  if (candidates.some((existing) => sameResolvedPath(existing, resolved))) return;
  candidates.push(resolved);
}

function sameResolvedPath(left: string, right: string): boolean {
  const normalize = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(left) === normalize(right);
}
