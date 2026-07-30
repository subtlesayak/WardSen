import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("macOS installer scripts", () => {
  const installScript = readFileSync(path.join(process.cwd(), "installers", "macos", "macos-install.sh"), "utf8");
  const updateScript = readFileSync(path.join(process.cwd(), "installers", "macos", "macos-update.sh"), "utf8");

  it("supports provider-only, start, and desktop packaging modes", () => {
    expect(installScript).toContain("--providers-only");
    expect(installScript).toContain("--start");
    expect(installScript).toContain("--package-desktop");
  });

  it("checks macOS native packaging prerequisites before Tauri build", () => {
    expect(installScript).toContain("xcode-select -p");
    expect(installScript).toContain("require_command rustup rustup-init");
    expect(installScript).toContain("command -v cargo");
  });

  it("enforces the current Node.js runtime floor", () => {
    expect(installScript).toContain("require_node_version");
    expect(installScript).toContain("Node.js 20.19.0 or newer");
    expect(installScript).toContain("Node.js 22.12.0 or newer");
  });

  it("builds server and web artifacts before desktop packaging", () => {
    expect(installScript).toContain("npm ci");
    expect(installScript).toContain("npm run build:server");
    expect(installScript).toContain("npm run build:web");
    expect(installScript).toContain("npm run desktop:build");
  });

  it("updates existing checkouts with explicit server and web builds", () => {
    expect(updateScript).toContain("npm run build:server");
    expect(updateScript).toContain("npm run build:web");
    expect(updateScript).toContain("npm run build");
  });
});
