import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("release engineering guardrails", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("derives the Tauri installer version from the release tag", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-tauri-version-"));
    tempDirs.push(tempDir);
    const configPath = path.join(tempDir, "tauri.conf.json");
    writeFileSync(configPath, JSON.stringify({ productName: "WardSen", version: "0.0.0" }), "utf8");

    execFileSync(process.execPath, ["scripts/set-tauri-version.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, RELEASE_TAG: "v1.2.3-rc.1", WARDSEN_TAURI_CONFIG: configPath },
      stdio: "pipe"
    });

    expect(JSON.parse(readFileSync(configPath, "utf8")).version).toBe("1.2.3-rc.1");
  });

  it("keeps the installer workflow fail-closed", () => {
    const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "release-installers.yml"), "utf8");

    expect(workflow).toContain("npm run release:verify-ref");
    expect(workflow).toContain("npm run release:set-tauri-version");
    expect(workflow).toContain("RELEASE-MANIFEST-*.json");
    expect(workflow).not.toContain("-sval");
    expect(workflow).not.toContain("validation suppression");
  });

  it("pins third-party workflow actions to full SHAs", () => {
    const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "release-installers.yml"), "utf8");
    const usesLines = workflow.split("\n").filter((line) => line.trim().startsWith("uses:"));

    expect(usesLines.length).toBeGreaterThan(0);
    for (const line of usesLines) {
      expect(line).toMatch(/@[0-9a-f]{40}$/);
      expect(line).not.toMatch(/@(v\d+|stable)$/);
    }
  });

  it("fails public release readiness when signing configuration is missing", () => {
    expect(() => execFileSync(process.execPath, ["scripts/verify-public-release-readiness.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WARDSEN_PUBLIC_RELEASE: "true",
        WARDSEN_RELEASE_PLATFORM: "windows",
        RELEASE_TAG: "v1.2.3",
        WINDOWS_CERTIFICATE_BASE64: ""
      },
      stdio: "pipe"
    })).toThrow();
  });

  it("passes public release readiness for signed final Windows releases", () => {
    expect(() => execFileSync(process.execPath, ["scripts/verify-public-release-readiness.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WARDSEN_PUBLIC_RELEASE: "true",
        WARDSEN_RELEASE_PLATFORM: "windows",
        RELEASE_TAG: "v1.2.3",
        WINDOWS_CERTIFICATE_BASE64: "base64-cert"
      },
      stdio: "pipe"
    })).not.toThrow();
  });

  it("allows public prerelease MSI validation while gating final signed releases", () => {
    const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "release-installers.yml"), "utf8");

    expect(workflow).toContain("npm run release:verify-public-readiness");
    expect(workflow).toContain("inputs.publish == true && inputs.prerelease == false");
    expect(workflow).not.toContain("Refusing publish=true while prerelease=true");
    expect(workflow).toContain("WINDOWS_CERTIFICATE_BASE64");
    expect(workflow).toContain("MACOS_SIGNING_ENABLED");
  });

  it("does not present macOS quarantine bypass as a normal install path", () => {
    const macosReadme = readFileSync(path.join(process.cwd(), "installers", "macos", "README.md"), "utf8");

    expect(macosReadme).not.toContain("xattr -dr com.apple.quarantine");
    expect(macosReadme).toContain("Do not use quarantine removal as a normal installation path");
  });
});
