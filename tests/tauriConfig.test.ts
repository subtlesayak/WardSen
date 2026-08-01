import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Tauri packaging config", () => {
  const config = JSON.parse(readFileSync(path.join(process.cwd(), "apps", "desktop", "src-tauri", "tauri.conf.json"), "utf8"));
  const rustLauncher = readFileSync(path.join(process.cwd(), "apps", "desktop", "src-tauri", "src", "lib.rs"), "utf8");

  it("builds the local API server and web frontend before packaging", () => {
    expect(config.build.beforeBuildCommand).toContain("npm run prepare:desktop-runtime");
    expect(config.build.beforeBuildCommand).toContain("npm run build:server");
    expect(config.build.beforeBuildCommand).toContain("npm run build:web");
    expect(config.build.beforeBundleCommand).toBe("npm run prepare:desktop-runtime");
  });

  it("bundles the local API server and Node runtime as desktop resources", () => {
    expect(config.bundle.resources).toMatchObject({
      "../../server/dist/index.cjs": "server/index.cjs",
      "gen/runtime": "runtime"
    });
  });

  it("uses a stable desktop identifier and platform icons", () => {
    expect(config.identifier).toBe("dev.wardsen.desktop");
    expect(config.bundle.icon).toContain("icons/icon.png");
    expect(config.bundle.icon).toContain("icons/icon.ico");
  });

  it("keeps the main desktop window explicitly labelled for lifecycle cleanup", () => {
    expect(config.app.windows[0]).toMatchObject({ label: "main", title: "WardSen" });
  });

  it("exposes a local-service restart command for desktop recovery", () => {
    expect(rustLauncher).toContain("restart_local_service");
    expect(rustLauncher).toContain("local_service_status");
    expect(rustLauncher).toContain("restart_server_process");
    expect(rustLauncher).toContain("collect_child_output");
    expect(rustLauncher).toContain("WARDSEN_DATA_DIR");
    expect(rustLauncher).toContain("LOCALAPPDATA");
    expect(rustLauncher).toContain("WardSen");
    expect(rustLauncher).toMatch(/tauri::generate_handler!\[[\s\S]*get_api_token[\s\S]*restart_local_service[\s\S]*local_service_status[\s\S]*\]/);
  });

  it("enforces a desktop content security policy", () => {
    expect(config.app.security.csp).toContain("default-src 'self'");
    expect(config.app.security.csp).toContain("connect-src 'self' http://127.0.0.1:4777");
    expect(config.app.security.csp).toContain("object-src 'none'");
  });

  it("does not expose the Tauri API globally", () => {
    expect(config.app.withGlobalTauri).not.toBe(true);
  });
});
