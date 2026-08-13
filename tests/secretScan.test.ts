import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

describe("secret non-persistence scan", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("passes when configured runtime artifacts do not contain secret probes", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-secret-scan-"));
    tempDirs.push(tempDir);
    writeFileSync(path.join(tempDir, "metadata.json"), JSON.stringify({ status: "active" }), "utf8");

    expect(() => execFileSync(process.execPath, ["scripts/secret-non-persistence-scan.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, WARDSEN_SECRET_SCAN_ROOTS: tempDir, WARDSEN_SECRET_SCAN_VALUES: "credential-password;session-token" },
      stdio: "pipe"
    })).not.toThrow();
  });

  it("fails when configured runtime artifacts contain secret probes", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-secret-scan-"));
    tempDirs.push(tempDir);
    writeFileSync(path.join(tempDir, "metadata.json"), JSON.stringify({ password: "credential-password" }), "utf8");

    expect(() => execFileSync(process.execPath, ["scripts/secret-non-persistence-scan.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, WARDSEN_SECRET_SCAN_ROOTS: tempDir, WARDSEN_SECRET_SCAN_VALUES: "credential-password" },
      stdio: "pipe"
    })).toThrow();
  });

  it("treats WardSen canary prefixes as leaked secrets", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-secret-scan-"));
    tempDirs.push(tempDir);
    writeFileSync(path.join(tempDir, "audit.jsonl"), JSON.stringify({ detail: "WARD-SEN-CANARY-9Q7K-DO-NOT-PERSIST" }), "utf8");

    expect(() => execFileSync(process.execPath, ["scripts/secret-non-persistence-scan.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, WARDSEN_SECRET_SCAN_ROOTS: tempDir },
      stdio: "pipe"
    })).toThrow();
  });
});
