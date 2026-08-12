import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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

  it("includes release SBOM, packaged smoke, signing and lifecycle evidence files in checksums and the release manifest", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-checksums-sbom-"));
    tempDirs.push(tempDir);

    const bundleRoot = path.join(tempDir, "target", "aarch64-apple-darwin", "release", "bundle");
    const dmgDir = path.join(bundleRoot, "dmg");
    const dmgPath = path.join(dmgDir, "WardSen_0.1.0_aarch64.dmg");
    const sbomPath = path.join(bundleRoot, "WARDSEN-SBOM-macos-arm64.json");
    const smokePath = path.join(bundleRoot, "PACKAGED-SMOKE-macos-arm64.json");
    const signingPath = path.join(bundleRoot, "SIGNING-EVIDENCE-macos-arm64.json");
    const lifecyclePath = path.join(bundleRoot, "INSTALL-LIFECYCLE-EVIDENCE-macos-arm64.json");
    mkdirSync(dmgDir, { recursive: true });
    writeFileSync(dmgPath, "fake dmg content", "utf8");
    writeFileSync(sbomPath, JSON.stringify({ name: "wardsen", version: "0.1.0" }), "utf8");
    writeFileSync(smokePath, JSON.stringify({ ok: true, platform: "darwin", arch: "arm64" }), "utf8");
    writeFileSync(signingPath, JSON.stringify({ status: "verified", artifacts: [{ path: "dmg/WardSen_0.1.0_aarch64.dmg" }] }), "utf8");
    writeFileSync(lifecyclePath, JSON.stringify({ status: "verified", installer: { path: "dmg/WardSen_0.1.0_aarch64.dmg" } }), "utf8");

    execFileSync(process.execPath, ["scripts/release-checksums.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, RELEASE_TAG: "v0.1.0-test", WARDSEN_BUNDLE_ROOT: bundleRoot },
      stdio: "pipe"
    });

    const dmgHash = createHash("sha256").update("fake dmg content").digest("hex").toUpperCase();
    const sbomHash = createHash("sha256").update(JSON.stringify({ name: "wardsen", version: "0.1.0" })).digest("hex").toUpperCase();
    const smokeHash = createHash("sha256").update(JSON.stringify({ ok: true, platform: "darwin", arch: "arm64" })).digest("hex").toUpperCase();
    const signingHash = createHash("sha256").update(JSON.stringify({ status: "verified", artifacts: [{ path: "dmg/WardSen_0.1.0_aarch64.dmg" }] })).digest("hex").toUpperCase();
    const lifecycleHash = createHash("sha256").update(JSON.stringify({ status: "verified", installer: { path: "dmg/WardSen_0.1.0_aarch64.dmg" } })).digest("hex").toUpperCase();
    const checksum = readFileSync(path.join(bundleRoot, "SHA256SUMS.txt"), "utf8");
    const manifest = JSON.parse(readFileSync(path.join(bundleRoot, "RELEASE-MANIFEST.json"), "utf8"));

    expect(checksum).toContain(`${dmgHash}  dmg/WardSen_0.1.0_aarch64.dmg`);
    expect(checksum).toContain(`${sbomHash}  WARDSEN-SBOM-macos-arm64.json`);
    expect(checksum).toContain(`${smokeHash}  PACKAGED-SMOKE-macos-arm64.json`);
    expect(checksum).toContain(`${signingHash}  SIGNING-EVIDENCE-macos-arm64.json`);
    expect(checksum).toContain(`${lifecycleHash}  INSTALL-LIFECYCLE-EVIDENCE-macos-arm64.json`);
    expect(manifest.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "dmg/WardSen_0.1.0_aarch64.dmg", sha256: dmgHash, kind: "installer" }),
      expect.objectContaining({ path: "WARDSEN-SBOM-macos-arm64.json", sha256: sbomHash, kind: "sbom" }),
      expect.objectContaining({ path: "PACKAGED-SMOKE-macos-arm64.json", sha256: smokeHash, kind: "smoke" }),
      expect.objectContaining({ path: "SIGNING-EVIDENCE-macos-arm64.json", sha256: signingHash, kind: "signing-evidence" }),
      expect.objectContaining({ path: "INSTALL-LIFECYCLE-EVIDENCE-macos-arm64.json", sha256: lifecycleHash, kind: "install-lifecycle-evidence" })
    ]));
  });

  it("fails closed when only an SBOM file exists without an installer", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-checksums-sbom-only-"));
    tempDirs.push(tempDir);

    const bundleRoot = path.join(tempDir, "target", "release", "bundle");
    mkdirSync(bundleRoot, { recursive: true });
    writeFileSync(path.join(bundleRoot, "WARDSEN-SBOM-windows-x64.json"), JSON.stringify({ name: "wardsen" }), "utf8");

    expect(() => execFileSync(process.execPath, ["scripts/release-checksums.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, RELEASE_TAG: "v0.1.0-test", WARDSEN_BUNDLE_ROOT: bundleRoot },
      stdio: "pipe"
    })).toThrow();
  });

  it("fails closed when default bundle checksums would mix stale and fresh installers", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-checksums-stale-"));
    tempDirs.push(tempDir);

    const bundleRoot = path.join(tempDir, "apps", "desktop", "src-tauri", "target", "release", "bundle");
    const msiDir = path.join(bundleRoot, "msi");
    const nsisDir = path.join(bundleRoot, "nsis");
    const staleMsi = path.join(msiDir, "WardSen_0.1.0_x64_en-US.msi");
    const freshNsis = path.join(nsisDir, "WardSen_0.1.0_x64-setup.exe");
    mkdirSync(msiDir, { recursive: true });
    mkdirSync(nsisDir, { recursive: true });
    writeFileSync(staleMsi, "old msi content", "utf8");
    writeFileSync(freshNsis, "fresh nsis content", "utf8");
    const staleDate = new Date("2026-08-01T00:00:00.000Z");
    const freshDate = new Date("2026-08-10T00:00:00.000Z");
    utimesSync(staleMsi, staleDate, staleDate);
    utimesSync(freshNsis, freshDate, freshDate);

    expect(() => execFileSync(process.execPath, [path.join(process.cwd(), "scripts", "release-checksums.mjs")], {
      cwd: tempDir,
      env: {
        ...process.env,
        WARDSEN_BUNDLE_ROOT: "",
        WARDSEN_MAX_ARTIFACT_TIME_SPAN_MS: "1000"
      },
      stdio: "pipe"
    })).toThrow();
  });
});
