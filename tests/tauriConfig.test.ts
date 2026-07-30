import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Tauri packaging config", () => {
  const config = JSON.parse(readFileSync(path.join(process.cwd(), "apps", "desktop", "src-tauri", "tauri.conf.json"), "utf8"));

  it("builds the local API server and web frontend before packaging", () => {
    expect(config.build.beforeBuildCommand).toContain("npm run build:server");
    expect(config.build.beforeBuildCommand).toContain("npm run build:web");
  });

  it("bundles the local API server as a desktop resource", () => {
    expect(config.bundle.resources).toMatchObject({
      "../../server/dist/index.cjs": "server/index.cjs"
    });
  });

  it("uses a stable desktop identifier and explicit Windows icon", () => {
    expect(config.identifier).toBe("dev.wardsen.desktop");
    expect(config.bundle.icon).toContain("icons/icon.ico");
  });

  it("keeps the main desktop window explicitly labelled for lifecycle cleanup", () => {
    expect(config.app.windows[0]).toMatchObject({ label: "main", title: "WardSen" });
  });
});
