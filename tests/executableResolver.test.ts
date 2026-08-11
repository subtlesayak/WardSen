import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { providerExecutableCandidates, resolveProviderExecutable } from "@wardsen/security";

describe("provider executable resolver", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    delete process.env.WARDSEN_TEST_TOOL_PATH;
  });

  it("prefers existing absolute trusted candidates", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-tool-"));
    tempDirs.push(tempDir);
    const toolPath = path.join(tempDir, process.platform === "win32" ? "tool.exe" : "tool");
    writeFileSync(toolPath, "", "utf8");

    expect(resolveProviderExecutable({
      toolName: "tool",
      trustedCandidates: [toolPath]
    })).toBe(toolPath);
  });

  it("rejects relative environment overrides", () => {
    process.env.WARDSEN_TEST_TOOL_PATH = "tools/tool";

    expect(() => providerExecutableCandidates({
      toolName: "tool",
      envPathKey: "WARDSEN_TEST_TOOL_PATH"
    })).toThrow("WARDSEN_TEST_TOOL_PATH must be an absolute executable path");
  });

  it("falls back to a command name when no trusted candidate exists", () => {
    expect(resolveProviderExecutable({
      toolName: "tool",
      trustedCandidates: [path.join(os.tmpdir(), "missing-wardsen-tool")]
    })).toBe("tool");
  });
});
