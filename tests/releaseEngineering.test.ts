import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("derives an MSI-compatible Tauri package version from the release tag", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-tauri-version-"));
    tempDirs.push(tempDir);
    const configPath = path.join(tempDir, "tauri.conf.json");
    writeFileSync(configPath, JSON.stringify({ productName: "WardSen", version: "0.0.0" }), "utf8");

    execFileSync(process.execPath, ["scripts/set-tauri-version.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, RELEASE_TAG: "v1.2.3-rc.1", WARDSEN_TAURI_CONFIG: configPath },
      stdio: "pipe"
    });

    expect(JSON.parse(readFileSync(configPath, "utf8")).version).toBe("1.2.3");
  });

  it("requires a clean checkout at the exact release tag", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-release-ref-"));
    tempDirs.push(tempDir);
    const scriptPath = path.join(process.cwd(), "scripts", "verify-release-ref.mjs");
    writeFileSync(path.join(tempDir, "release.txt"), "release", "utf8");
    execFileSync("git", ["init"], { cwd: tempDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.email", "release-test@example.test"], { cwd: tempDir, stdio: "pipe" });
    execFileSync("git", ["config", "user.name", "WardSen Release Test"], { cwd: tempDir, stdio: "pipe" });
    execFileSync("git", ["add", "release.txt"], { cwd: tempDir, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", "release"], { cwd: tempDir, stdio: "pipe" });
    execFileSync("git", ["tag", "v1.2.3"], { cwd: tempDir, stdio: "pipe" });

    expect(() => execFileSync(process.execPath, [scriptPath], {
      cwd: tempDir,
      env: { ...process.env, RELEASE_TAG: "v1.2.3" },
      stdio: "pipe"
    })).not.toThrow();

    writeFileSync(path.join(tempDir, "release.txt"), "dirty", "utf8");
    expect(() => execFileSync(process.execPath, [scriptPath], {
      cwd: tempDir,
      env: { ...process.env, RELEASE_TAG: "v1.2.3" },
      stdio: "pipe"
    })).toThrow();
  });

  it("keeps the installer workflow fail-closed", () => {
    const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "release-installers.yml"), "utf8");

    expect(workflow).toContain("npm run release:verify-ref");
    expect(workflow).toContain("npm run release:set-tauri-version");
    expect(workflow).toContain("npm run release:sbom");
    expect(workflow).toContain("npm run release:provenance-subjects");
    expect(workflow).toContain("actions/attest@508db95dd578ae2727ebd6217d5ba78e4fbda05d");
    expect(workflow).toContain("npm run release:write-provenance-evidence");
    expect(workflow).toContain("npm run release:verify-evidence");
    expect(workflow).toContain("RELEASE-MANIFEST-*.json");
    expect(workflow).toContain("WARDSEN-SBOM-*.json");
    expect(workflow).toContain("SIGNING-EVIDENCE-*.json");
    expect(workflow).toContain("ATTESTATION-SUBJECTS-*.txt");
    expect(workflow).toContain("PROVENANCE-EVIDENCE-*.json");
    expect(workflow).not.toContain("-sval");
    expect(workflow).not.toContain("validation suppression");
  });

  it("builds macOS Intel release assets from the release tag with manifest and SBOM evidence", () => {
    const workflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "build-macos-intel.yml"), "utf8");

    expect(workflow).toContain("ref: ${{ inputs.release_tag }}");
    expect(workflow).toContain("npm run release:verify-ref");
    expect(workflow).toContain("npm run release:set-tauri-version");
    expect(workflow).toContain("npm run release:sbom");
    expect(workflow).toContain("npm run release:provenance-subjects");
    expect(workflow).toContain("actions/attest@508db95dd578ae2727ebd6217d5ba78e4fbda05d");
    expect(workflow).toContain("npm run release:write-provenance-evidence");
    expect(workflow).toContain("npm run release:verify-evidence");
    expect(workflow).toContain("WARDSEN-SBOM-macos-x64.json");
    expect(workflow).toContain("RELEASE-MANIFEST-macos-x64.json");
    expect(workflow).toContain("SIGNING-EVIDENCE-macos-x64.json");
    expect(workflow).toContain("ATTESTATION-SUBJECTS-macos-x64.txt");
    expect(workflow).toContain("PROVENANCE-EVIDENCE-macos-x64.json");
    expect(workflow).not.toContain("inputs.ref");
  });

  it("fails public release evidence verification when signing evidence is missing", () => {
    const bundleRoot = createReleaseEvidenceBundle(tempDirs, false);

    expect(() => execFileSync(process.execPath, ["scripts/verify-release-evidence.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, WARDSEN_BUNDLE_ROOT: bundleRoot, WARDSEN_PUBLIC_RELEASE: "true" },
      stdio: "pipe"
    })).toThrow();
  });

  it("passes public release evidence verification when signing evidence matches the installer manifest", () => {
    const bundleRoot = createReleaseEvidenceBundle(tempDirs, true);

    expect(() => execFileSync(process.execPath, ["scripts/verify-release-evidence.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, WARDSEN_BUNDLE_ROOT: bundleRoot, WARDSEN_PUBLIC_RELEASE: "true" },
      stdio: "pipe"
    })).not.toThrow();
  });

  it("requires provenance evidence to cover every installer and SBOM subject", () => {
    const bundleRoot = createReleaseEvidenceBundle(tempDirs, true);
    execFileSync(process.execPath, ["scripts/release-provenance-subjects.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, WARDSEN_BUNDLE_ROOT: bundleRoot, WARDSEN_PROVENANCE_SUBJECTS_NAME: "ATTESTATION-SUBJECTS-windows-x64.txt" },
      stdio: "pipe"
    });
    execFileSync(process.execPath, ["scripts/write-provenance-evidence.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WARDSEN_BUNDLE_ROOT: bundleRoot,
        WARDSEN_PROVENANCE_PLATFORM: "windows-x64",
        WARDSEN_PROVENANCE_SUBJECTS_NAME: "ATTESTATION-SUBJECTS-windows-x64.txt",
        WARDSEN_PROVENANCE_EVIDENCE_NAME: "PROVENANCE-EVIDENCE-windows-x64.json",
        WARDSEN_PROVENANCE_ATTESTATION_ID: "12345",
        WARDSEN_PROVENANCE_ATTESTATION_URL: "https://github.com/example/wardsen/attestations/12345"
      },
      stdio: "pipe"
    });
    execFileSync(process.execPath, ["scripts/release-checksums.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, RELEASE_TAG: "v1.2.3", WARDSEN_BUNDLE_ROOT: bundleRoot },
      stdio: "pipe"
    });

    expect(() => execFileSync(process.execPath, ["scripts/verify-release-evidence.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, WARDSEN_BUNDLE_ROOT: bundleRoot, WARDSEN_PUBLIC_RELEASE: "true", WARDSEN_PROVENANCE_REQUIRED: "true" },
      stdio: "pipe"
    })).not.toThrow();
  });

  it("requires hash-matched install lifecycle evidence when explicitly gated", () => {
    const bundleRoot = createReleaseEvidenceBundle(tempDirs, true);

    expect(() => execFileSync(process.execPath, ["scripts/verify-release-evidence.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, WARDSEN_BUNDLE_ROOT: bundleRoot, WARDSEN_INSTALL_LIFECYCLE_REQUIRED: "true" },
      stdio: "pipe"
    })).toThrow();

    execFileSync(process.execPath, ["scripts/write-install-lifecycle-evidence.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WARDSEN_BUNDLE_ROOT: bundleRoot,
        WARDSEN_INSTALL_LIFECYCLE_PLATFORM: "windows-x64",
        WARDSEN_INSTALL_LIFECYCLE_ARTIFACT: path.join(bundleRoot, "msi", "WardSen_1.2.3_x64.msi"),
        WARDSEN_INSTALL_LIFECYCLE_TEST_ENV: "disposable Windows test account",
        WARDSEN_INSTALL_LIFECYCLE_STEPS: "fresh_install,launch,upgrade,vault_metadata_preserved,uninstall"
      },
      stdio: "pipe"
    });
    execFileSync(process.execPath, ["scripts/release-checksums.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, RELEASE_TAG: "v1.2.3", WARDSEN_BUNDLE_ROOT: bundleRoot },
      stdio: "pipe"
    });

    expect(() => execFileSync(process.execPath, ["scripts/verify-release-evidence.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, WARDSEN_BUNDLE_ROOT: bundleRoot, WARDSEN_INSTALL_LIFECYCLE_REQUIRED: "true" },
      stdio: "pipe"
    })).not.toThrow();
  });

  it("uses npm's script entrypoint when generating SBOM artifacts", () => {
    const sbomScript = readFileSync(path.join(process.cwd(), "scripts", "release-sbom.mjs"), "utf8");
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));

    expect(sbomScript).toContain("process.env.npm_execpath");
    expect(sbomScript).toContain("npm.cmd");
    expect(sbomScript).toContain("--sbom-format");
    expect(sbomScript).toContain("cyclonedx");
    expect(packageJson.scripts.sbom).toContain("--sbom-format cyclonedx");
  });

  it("keeps web smoke testing as a repeatable desktop and mobile release check", () => {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    const smokeScript = readFileSync(path.join(process.cwd(), "scripts", "web-smoke.mjs"), "utf8");

    expect(packageJson.scripts["smoke:web"]).toBe("node scripts/web-smoke.mjs --http-only");
    expect(packageJson.scripts["smoke:web:visual"]).toBe("node scripts/web-smoke.mjs");
    expect(smokeScript).toContain("desktop-1280x720.png");
    expect(smokeScript).toContain("mobile-390x844.png");
    expect(smokeScript).toContain("WARDSEN_WEB_SMOKE_CHROME");
    expect(smokeScript).toContain("process.argv.includes(\"--http-only\")");
    expect(smokeScript).toContain("10_000");
    expect(smokeScript).toContain("Asha");
    expect(smokeScript).toContain("viewed");
  });

  it("keeps packaged server smoke testing bounded and uploaded as release evidence", () => {
    const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    const smokeScript = readFileSync(path.join(process.cwd(), "scripts", "packaged-smoke.mjs"), "utf8");
    const releaseWorkflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "release-installers.yml"), "utf8");
    const macosIntelWorkflow = readFileSync(path.join(process.cwd(), ".github", "workflows", "build-macos-intel.yml"), "utf8");

    expect(packageJson.scripts["smoke:packaged"]).toBe("node scripts/packaged-smoke.mjs");
    expect(smokeScript).toContain("WARDSEN_PACKAGED_SMOKE_STARTUP_TIMEOUT_MS");
    expect(smokeScript).toContain("WARDSEN_PACKAGED_SMOKE_REQUEST_TIMEOUT_MS");
    expect(smokeScript).toContain("killServerProcess");
    expect(smokeScript).toContain("crashServerProcess");
    expect(smokeScript).toContain("WARDSEN_DATA_DIR_STRICT");
    expect(smokeScript).toContain("accountCountAfterRestart");
    expect(smokeScript).toContain("PACKAGED-SMOKE");
    expect(releaseWorkflow).toContain("npm run smoke:packaged");
    expect(releaseWorkflow).toContain("PACKAGED-SMOKE-*.json");
    expect(macosIntelWorkflow).toContain("npm run smoke:packaged");
    expect(macosIntelWorkflow).toContain("PACKAGED-SMOKE-macos-x64.json");
    expect(macosIntelWorkflow).toContain('-name "PACKAGED-SMOKE-macos-x64.json"');
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
    expect(releaseWorkflow).toMatch(/build:\n[\s\S]*permissions:\n      attestations: write\n      contents: read\n      id-token: write/);
    expect(macosIntelWorkflow).toMatch(/build:\n[\s\S]*permissions:\n      attestations: write\n      contents: read\n      id-token: write/);
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

function createReleaseEvidenceBundle(tempDirs: string[], withSigningEvidence: boolean): string {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-release-evidence-"));
  tempDirs.push(tempDir);
  const bundleRoot = path.join(tempDir, "bundle");
  const installerDir = path.join(bundleRoot, "msi");
  const installerPath = path.join(installerDir, "WardSen_1.2.3_x64.msi");
  const sbomPath = path.join(bundleRoot, "WARDSEN-SBOM-windows-x64.json");
  const smokePath = path.join(bundleRoot, "PACKAGED-SMOKE-windows-x64.json");
  mkdirSync(installerDir, { recursive: true });
  writeFileSync(installerPath, "signed installer", "utf8");
  writeFileSync(sbomPath, JSON.stringify({ name: "wardsen", version: "1.2.3" }), "utf8");
  writeFileSync(smokePath, JSON.stringify({ ok: true }), "utf8");

  if (withSigningEvidence) {
    writeFileSync(path.join(bundleRoot, "SIGNING-EVIDENCE-windows-x64.json"), JSON.stringify({
      schemaVersion: 1,
      product: "WardSen",
      platform: "windows-x64",
      status: "verified",
      artifacts: [{
        path: "msi/WardSen_1.2.3_x64.msi",
        sha256: createHash("sha256").update("signed installer").digest("hex").toUpperCase(),
        sizeBytes: "signed installer".length
      }]
    }), "utf8");
  }

  execFileSync(process.execPath, ["scripts/release-checksums.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, RELEASE_TAG: "v1.2.3", WARDSEN_BUNDLE_ROOT: bundleRoot },
    stdio: "pipe"
  });

  return bundleRoot;
}
