const WARDSEN_RELEASES_URL = "https://api.github.com/repos/subtlesayak/WardSen/releases?per_page=30";
const WARDSEN_RELEASE_PAGE_BASE = "https://github.com/subtlesayak/WardSen/releases/tag/";

export interface PublishedWardSenRelease {
  tag: string;
  pageUrl: string;
  publishedAt: string;
  prerelease: boolean;
}

export interface ReleaseUpdateCheck {
  currentVersion: string;
  checkedAt: string;
  updateAvailable: boolean;
  release?: PublishedWardSenRelease;
}

export interface ReleaseUpdateService {
  check(currentVersion: string): Promise<ReleaseUpdateCheck>;
}

export interface GithubReleaseUpdateServiceOptions {
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

interface CachedReleases {
  expiresAt: number;
  releases: PublishedWardSenRelease[];
}

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const SEMVER_TAG = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Performs an operator-initiated, metadata-only GitHub release check. It never
 * downloads, verifies, or executes release assets.
 */
export class GithubReleaseUpdateService implements ReleaseUpdateService {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly requestTimeoutMs: number;
  private cached?: CachedReleases;

  constructor(options: GithubReleaseUpdateServiceOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.cacheTtlMs = Math.max(0, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
    this.requestTimeoutMs = Math.max(1, options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  }

  async check(currentVersion: string): Promise<ReleaseUpdateCheck> {
    const current = parseSemVer(currentVersion);
    if (!current) throw new Error("WardSen could not check updates because its installed version is invalid.");

    const includePrereleases = current.prerelease.length > 0;
    const releases = (await this.loadReleases()).filter((release) => includePrereleases || parseSemVer(release.tag)?.prerelease.length === 0);
    const latest = releases.reduce<PublishedWardSenRelease | undefined>((candidate, release) => {
      if (!candidate) return release;
      return compareSemVer(parseSemVer(release.tag)!, parseSemVer(candidate.tag)!) > 0 ? release : candidate;
    }, undefined);
    const checkedAt = new Date(this.now()).toISOString();
    if (!latest || compareSemVer(parseSemVer(latest.tag)!, current) <= 0) {
      return { currentVersion, checkedAt, updateAvailable: false };
    }
    return { currentVersion, checkedAt, updateAvailable: true, release: latest };
  }

  private async loadReleases(): Promise<PublishedWardSenRelease[]> {
    if (this.cached && this.cached.expiresAt > this.now()) return this.cached.releases;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(WARDSEN_RELEASES_URL, {
        headers: { accept: "application/vnd.github+json" },
        signal: controller.signal
      });
      if (!response.ok) throw new Error("WardSen could not contact GitHub Releases. Check your internet connection and try again.");
      const releases = parseGithubReleases(await response.json());
      this.cached = { releases, expiresAt: this.now() + this.cacheTtlMs };
      return releases;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("WardSen could not contact")) throw error;
      throw new Error("WardSen could not contact GitHub Releases. Check your internet connection and try again.");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseGithubReleases(value: unknown): PublishedWardSenRelease[] {
  if (!Array.isArray(value)) throw new Error("WardSen could not read the GitHub Releases response.");
  return value.flatMap((candidate) => {
    if (!isRecord(candidate) || candidate.draft === true || typeof candidate.tag_name !== "string" || !parseSemVer(candidate.tag_name)) return [];
    if (typeof candidate.published_at !== "string" || Number.isNaN(Date.parse(candidate.published_at))) return [];
    return [{
      tag: candidate.tag_name,
      pageUrl: `${WARDSEN_RELEASE_PAGE_BASE}${encodeURIComponent(candidate.tag_name)}`,
      publishedAt: candidate.published_at,
      prerelease: candidate.prerelease === true
    }];
  });
}

function parseSemVer(value: string): SemVer | undefined {
  const match = SEMVER_TAG.exec(value.trim());
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
