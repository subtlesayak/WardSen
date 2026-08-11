import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("release checksum generation", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("uses WARDSEN_BUNDLE_ROOT for targeted macOS bundle folders", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-checksums-"));
    tempDirs.push(tempDir);

    const bundleRoot = path.join(tempDir, "target", "aarch64-apple-darwin", "release", "bundle");
    const dmgDir = path.join(bundleRoot, "dmg");
    const dmgPath = path.join(dmgDir, "WardSen_0.1.0_aarch64.dmg");
    mkdirSync(dmgDir, { recursive: true });
    writeFileSync(dmgPath, "fake dmg content", "utf8");

    execFileSync(process.execPath, ["scripts/release-checksums.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, RELEASE_TAG: "v0.1.0-test", WARDSEN_BUNDLE_ROOT: bundleRoot },
      stdio: "pipe"
    });

    const expectedHash = createHash("sha256").update("fake dmg content").digest("hex").toUpperCase();
    const checksum = readFileSync(path.join(bundleRoot, "SHA256SUMS.txt"), "utf8");
    const manifest = JSON.parse(readFileSync(path.join(bundleRoot, "RELEASE-MANIFEST.json"), "utf8"));
    expect(checksum).toBe(`${expectedHash}  dmg/WardSen_0.1.0_aarch64.dmg\n`);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      product: "WardSen",
      releaseTag: "v0.1.0-test",
      artifacts: [{
        path: "dmg/WardSen_0.1.0_aarch64.dmg",
        sha256: expectedHash,
        sizeBytes: "fake dmg content".length
      }]
    });
  });
});
