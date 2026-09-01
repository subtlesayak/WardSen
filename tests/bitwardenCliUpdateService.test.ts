import { describe, expect, it, vi } from "vitest";
import { NpmBitwardenCliUpdateService } from "../apps/server/src/bitwardenCliUpdateService";

describe("NpmBitwardenCliUpdateService", () => {
  it("compares the installed CLI with npm metadata without downloading an update", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ version: "2026.7.0" }), { status: 200 }));
    const service = new NpmBitwardenCliUpdateService({ fetch: fetch as typeof globalThis.fetch, now: () => Date.parse("2026-08-29T10:00:00Z") });

    await expect(service.check("2026.6.0")).resolves.toEqual({
      currentVersion: "2026.6.0",
      latestVersion: "2026.7.0",
      checkedAt: "2026-08-29T10:00:00.000Z",
      updateAvailable: true
    });
    await expect(service.check("2026.7.0")).resolves.toMatchObject({ updateAvailable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("https://registry.npmjs.org/@bitwarden%2fcli/latest", expect.objectContaining({
      headers: { accept: "application/json" },
      signal: expect.any(AbortSignal)
    }));
  });

  it("refuses malformed installed versions without contacting the registry", async () => {
    const fetch = vi.fn();
    const service = new NpmBitwardenCliUpdateService({ fetch: fetch as typeof globalThis.fetch });

    await expect(service.check("Bitwarden CLI ready")).rejects.toThrow("could not read the installed Bitwarden CLI version");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns a safe registry error when latest metadata is unavailable", async () => {
    const service = new NpmBitwardenCliUpdateService({ fetch: vi.fn(async () => new Response("unavailable", { status: 503 })) as typeof globalThis.fetch });

    await expect(service.check("2026.6.0")).rejects.toThrow("could not contact the npm registry");
  });
});
