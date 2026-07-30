import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Windows installer script", () => {
  const script = readFileSync(path.join(process.cwd(), "installers", "windows", "windows-install.ps1"), "utf8");

  it("enforces the current Node.js runtime floor", () => {
    expect(script).toContain("Require-NodeVersion");
    expect(script).toContain("Node.js 20.19.0 or newer");
    expect(script).toContain("Node.js 22.12.0 or newer");
  });

  it("uses lockfile-clean installs for desktop packaging", () => {
    expect(script).toContain("npm ci");
    expect(script).toContain("npm run build:server");
    expect(script).toContain("npm run build:web");
    expect(script).toContain("npm run desktop:build");
  });
});
