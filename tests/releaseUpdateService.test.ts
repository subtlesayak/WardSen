import { describe, expect, it, vi } from "vitest";
import { GithubReleaseUpdateService } from "../apps/server/src/releaseUpdateService";

function githubReleasesResponse(releases: unknown) {
  return new Response(JSON.stringify(releases), { status: 200, headers: { "content-type": "application/json" } });
}

describe("GitHub release update service", () => {
  it("selects a newer release candidate and returns a canonical GitHub release page", async () => {
    const fetch = vi.fn(async () => githubReleasesResponse([
      { tag_name: "v0.1.0-rc.68", draft: false, prerelease: true, published_at: "2026-08-27T09:00:00Z" },
      { tag_name: "v0.1.0-rc.67", draft: false, prerelease: true, published_at: "2026-08-26T09:00:00Z" }
    ]));
    const service = new GithubReleaseUpdateService({ fetch: fetch as typeof globalThis.fetch, now: () => Date.parse("2026-08-27T10:00:00Z") });

    await expect(service.check("v0.1.0-rc.67")).resolves.toEqual({
      currentVersion: "v0.1.0-rc.67",
      checkedAt: "2026-08-27T10:00:00.000Z",
      updateAvailable: true,
      release: {
        tag: "v0.1.0-rc.68",
        pageUrl: "https://github.com/subtlesayak/WardSen/releases/tag/v0.1.0-rc.68",
        publishedAt: "2026-08-27T09:00:00Z",
        prerelease: true
      }
    });
    expect(fetch).toHaveBeenCalledWith("https://api.github.com/repos/subtlesayak/WardSen/releases?per_page=30", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("does not offer a downgrade and treats a final release as newer than its release candidates", async () => {
    const service = new GithubReleaseUpdateService({
      fetch: vi.fn(async () => githubReleasesResponse([
        { tag_name: "v0.1.0", draft: false, prerelease: false, published_at: "2026-08-27T09:00:00Z" },
        { tag_name: "v0.1.0-rc.99", draft: false, prerelease: true, published_at: "2026-08-27T08:00:00Z" }
      ])) as typeof globalThis.fetch,
      now: () => Date.parse("2026-08-27T10:00:00Z")
    });

    await expect(service.check("v0.1.0")).resolves.toMatchObject({ updateAvailable: false });
    await expect(service.check("v0.1.0-rc.67")).resolves.toMatchObject({ updateAvailable: true, release: { tag: "v0.1.0" } });
  });

  it("keeps stable installations on stable releases instead of offering newer release candidates", async () => {
    const service = new GithubReleaseUpdateService({
      fetch: vi.fn(async () => githubReleasesResponse([
        { tag_name: "v0.12.0-rc.1", draft: false, prerelease: true, published_at: "2026-08-29T09:00:00Z" },
        { tag_name: "v0.11.0", draft: false, prerelease: false, published_at: "2026-08-29T08:00:00Z" }
      ])) as typeof globalThis.fetch,
      now: () => Date.parse("2026-08-29T10:00:00Z")
    });

    await expect(service.check("v0.11.0")).resolves.toMatchObject({ updateAvailable: false });
  });

  it("ignores drafts and malformed release records", async () => {
    const service = new GithubReleaseUpdateService({
      fetch: vi.fn(async () => githubReleasesResponse([
        { tag_name: "v9.9.9", draft: true, prerelease: false, published_at: "2026-08-27T09:00:00Z" },
        { tag_name: "not-a-version", draft: false, prerelease: false, published_at: "2026-08-27T09:00:00Z" },
        { tag_name: "v0.1.0-rc.67", draft: false, prerelease: true, published_at: "invalid" }
      ])) as typeof globalThis.fetch
    });

    await expect(service.check("v0.1.0-rc.67")).resolves.toMatchObject({ updateAvailable: false });
  });

  it("caches successful release metadata", async () => {
    let now = Date.parse("2026-08-27T10:00:00Z");
    const fetch = vi.fn(async () => githubReleasesResponse([
      { tag_name: "v0.1.0-rc.68", draft: false, prerelease: true, published_at: "2026-08-27T09:00:00Z" }
    ]));
    const service = new GithubReleaseUpdateService({ fetch: fetch as typeof globalThis.fetch, now: () => now, cacheTtlMs: 60_000 });

    await service.check("v0.1.0-rc.67");
    now += 30_000;
    await service.check("v0.1.0-rc.67");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("returns a safe failure when GitHub cannot be reached and retries on the next check", async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new Error("network detail"))
      .mockResolvedValueOnce(githubReleasesResponse([
        { tag_name: "v0.1.0-rc.68", draft: false, prerelease: true, published_at: "2026-08-27T09:00:00Z" }
      ]));
    const service = new GithubReleaseUpdateService({ fetch: fetch as typeof globalThis.fetch });
    await expect(service.check("v0.1.0-rc.67")).rejects.toThrow("WardSen could not contact GitHub Releases");
    await expect(service.check("v0.1.0-rc.67")).resolves.toMatchObject({ updateAvailable: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
