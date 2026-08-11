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

  it("keeps web smoke testing as a repeatable desktop and mobile release check", () => {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    const smokeScript = readFileSync(path.join(process.cwd(), "scripts", "web-smoke.mjs"), "utf8");

    expect(packageJson.scripts["smoke:web"]).toBe("node scripts/web-smoke.mjs");
    expect(smokeScript).toContain("desktop-1280x720.png");
    expect(smokeScript).toContain("mobile-390x844.png");
    expect(smokeScript).toContain("WARDSEN_WEB_SMOKE_CHROME");
    expect(smokeScript).toContain("Asha");
    expect(smokeScript).toContain("viewed");
  });

  it("pins third-party workflow actions to full SHAs", () => {
    const workflowPaths = [
      path.join(process.cwd(), ".github", "workflows", "release-installers.yml"),
      path.join(process.cwd(), ".github", "workflows", "build-macos-intel.yml")
    ];
    const usesLines = workflowPaths.flatMap((workflowPath) =>
      readFileSync(workflowPath, "utf8").split("\n").map((line) => line.trim()).filter((line) => line.startsWith("uses:"))
    );

    expect(usesLines.length).toBeGreaterThan(0);
    for (const line of usesLines) {
      expect(line).toMatch(/@[0-9a-f]{40}$/);
      expect(line).not.toMatch(/@(v\d+|stable)$/);
    }
  });

  it("keeps release workflow write permissions scoped to publishing jobs", () => {
    const releaseWorkflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "release-installers.yml"), "utf8").replace(/\r\n/g, "\n");
    const macosIntelWorkflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "build-macos-intel.yml"), "utf8").replace(/\r\n/g, "\n");

    expect(releaseWorkflow).toMatch(/permissions:\n  contents: read\n  actions: read/);
    expect(releaseWorkflow).toMatch(/publish:\n[\s\S]*permissions:\n      actions: read\n      contents: write/);
    expect(macosIntelWorkflow).toMatch(/permissions:\n  contents: read\n  actions: read/);
    expect(macosIntelWorkflow).toMatch(/build:\n[\s\S]*permissions:\n      contents: read/);
    expect(macosIntelWorkflow).toMatch(/attach:\n[\s\S]*permissions:\n      actions: read\n      contents: write/);
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
