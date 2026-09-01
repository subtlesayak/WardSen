const BITWARDEN_CLI_NPM_LATEST_URL = "https://registry.npmjs.org/@bitwarden%2fcli/latest";

export interface BitwardenCliUpdateCheck {
  currentVersion: string;
  latestVersion: string;
  checkedAt: string;
  updateAvailable: boolean;
}

export interface BitwardenCliUpdateService {
  check(currentVersion: string): Promise<BitwardenCliUpdateCheck>;
}

export interface NpmBitwardenCliUpdateServiceOptions {
  fetch?: typeof fetch;
  now?: () => number;
  cacheTtlMs?: number;
  requestTimeoutMs?: number;
}

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Performs an operator-initiated, metadata-only npm registry check. It never
 * downloads, installs, or executes a Bitwarden CLI update.
 */
export class NpmBitwardenCliUpdateService implements BitwardenCliUpdateService {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly requestTimeoutMs: number;
  private cached?: { expiresAt: number; latestVersion: string };

  constructor(options: NpmBitwardenCliUpdateServiceOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.cacheTtlMs = Math.max(0, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
    this.requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  }

  async check(currentVersion: string): Promise<BitwardenCliUpdateCheck> {
    const current = parseSemVer(currentVersion);
    if (!current) throw new Error("WardSen could not read the installed Bitwarden CLI version.");

    const latestVersion = await this.loadLatestVersion();
    const latest = parseSemVer(latestVersion);
    if (!latest) throw new Error("WardSen could not read the Bitwarden CLI version from npm.");

    return {
      currentVersion,
      latestVersion,
      checkedAt: new Date(this.now()).toISOString(),
      updateAvailable: compareSemVer(latest, current) > 0
    };
  }

  private async loadLatestVersion(): Promise<string> {
    if (this.cached && this.cached.expiresAt > this.now()) return this.cached.latestVersion;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(BITWARDEN_CLI_NPM_LATEST_URL, {
        headers: { accept: "application/json" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error("registry unavailable");
      const latestVersion = npmLatestVersion(await response.json());
      this.cached = { latestVersion, expiresAt: this.now() + this.cacheTtlMs };
      return latestVersion;
    } catch {
      throw new Error("WardSen could not contact the npm registry. Check your internet connection and try again.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function npmLatestVersion(value: unknown): string {
  if (typeof value !== "object" || value === null || typeof (value as { version?: unknown }).version !== "string") {
    throw new Error("invalid registry response");
  }
  const version = (value as { version: string }).version.trim();
  if (!parseSemVer(version)) throw new Error("invalid registry version");
  return version;
}

function parseSemVer(value: string): SemVer | undefined {
  const match = SEMVER.exec(value.trim());
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? []
  };
}

function compareSemVer(left: SemVer, right: SemVer): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0;
    return left.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}
