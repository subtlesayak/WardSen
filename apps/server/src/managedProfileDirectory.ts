import fs from "node:fs";
import path from "node:path";

export function managedProfileDirectory(profileRoot: string, accountId: string): string {
  if (accountId.includes("/") || accountId.includes("\\") || accountId === "." || accountId === "..") {
    throw new Error("Account id cannot contain path separators because WardSen manages provider profile directories.");
  }
  const resolved = path.resolve(profileRoot, accountId);
  assertPathInside(profileRoot, resolved, "Managed provider profile directory must stay inside the WardSen profile root.");
  return resolved;
}

export function assertManagedProfileDirectoryTarget(profileRoot: string, profileDirectory: string): void {
  const resolvedProfileRoot = path.resolve(profileRoot);
  const resolvedProfileDirectory = path.resolve(profileDirectory);
  const relative = assertPathInside(resolvedProfileRoot, resolvedProfileDirectory, "Managed provider profile directory must stay inside the WardSen profile root.");
  const rootExists = assertManagedProfileRoot(resolvedProfileRoot);
  const directoryExists = assertExistingDirectoryIsNotLinked(resolvedProfileDirectory, "Managed provider profile directory");
  if (!rootExists && directoryExists) {
    throw new Error("Managed provider profile directory must stay inside the WardSen profile root.");
  }
  if (!directoryExists) return;

  const canonicalRoot = fs.realpathSync.native(resolvedProfileRoot);
  const canonicalDirectory = fs.realpathSync.native(resolvedProfileDirectory);
  const expectedCanonicalDirectory = path.resolve(canonicalRoot, relative);
  if (!pathsEqual(canonicalDirectory, expectedCanonicalDirectory)) {
    throw new Error("Managed provider profile directory must not be a symlink or reparse point.");
  }
}

export function assertManagedProfileRoot(profileRoot: string): boolean {
  const resolvedProfileRoot = path.resolve(profileRoot);
  const rootExists = assertExistingDirectoryIsNotLinked(resolvedProfileRoot, "Managed provider profile root");
  return rootExists;
}

export function pathsEqual(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

export function pathExists(targetPath: string): boolean {
  try {
    fs.lstatSync(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function assertPathInside(root: string, candidate: string, message: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(message);
  }
  return relative;
}

function assertExistingDirectoryIsNotLinked(targetPath: string, label: string): boolean {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (stats.isSymbolicLink()) {
    throw new Error(`${label} must not be a symlink or reparse point.`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`${label} must be a directory.`);
  }
  return true;
}
