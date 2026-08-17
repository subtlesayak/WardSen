import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Tauri packaging config", () => {
  const config = JSON.parse(readFileSync(path.join(process.cwd(), "apps", "desktop", "src-tauri", "tauri.conf.json"), "utf8"));
  const capability = JSON.parse(readFileSync(path.join(process.cwd(), "apps", "desktop", "src-tauri", "capabilities", "default.json"), "utf8"));
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
    expect(rustLauncher).toContain("proxy_local_service_request");
    expect(rustLauncher).toContain("validate_local_service_proxy_request");
    expect(rustLauncher).toContain("open_terminal_session");
    expect(rustLauncher).toContain("async fn open_terminal_session");
    expect(rustLauncher).toContain("tauri::async_runtime::spawn_blocking");
    expect(rustLauncher).toContain("fetch_terminal_handoff_command");
    expect(rustLauncher).not.toContain("open_terminal_session(command: String)");
    expect(rustLauncher).toContain("WardSen is starting Bitwarden login");
    expect(rustLauncher).toContain("exec /bin/zsh -l");
    expect(rustLauncher).toContain("This PowerShell window stays open");
    expect(rustLauncher).toContain("select_available_local_port");
    expect(rustLauncher).toContain("WARDSEN_PORT\", config.port.to_string()");
    expect(rustLauncher).toContain("restart_server_process");
    expect(rustLauncher).toContain("collect_child_output");
    expect(rustLauncher).toContain("WARDSEN_DATA_DIR");
    expect(rustLauncher).toContain("LOCALAPPDATA");
    expect(rustLauncher).toContain("APPDATA");
    expect(rustLauncher).toContain("WardSen");
    expect(rustLauncher).toContain("data_root_database_size");
    expect(rustLauncher).toContain("dev.wardsen.desktop");
    expect(rustLauncher).not.toContain("fn get_api_token");
    expect(rustLauncher).not.toContain("fn get_local_service_url");
    expect(rustLauncher).toMatch(/tauri::generate_handler!\[[\s\S]*proxy_local_service_request[\s\S]*restart_local_service[\s\S]*local_service_status[\s\S]*\]/);
  });

  it("opens a real PowerShell console first and keeps Windows Terminal as fallback", () => {
    const windowsLauncher = rustLauncher.slice(
      rustLauncher.indexOf("fn launch_windows_powershell"),
      rustLauncher.indexOf("fn windows_terminal_command")
    );
    const powershellConsoleLauncher = rustLauncher.slice(
      rustLauncher.indexOf("fn launch_windows_powershell_console"),
      rustLauncher.indexOf("fn windows_terminal_args")
    );

    expect(windowsLauncher.indexOf("launch_windows_powershell_console")).toBeLessThan(windowsLauncher.indexOf("launch_windows_terminal_tab"));
    expect(windowsLauncher).toContain('Command::new("wt.exe")');
    expect(windowsLauncher).toContain('"WardSen Bitwarden"');
    expect(windowsLauncher).toContain("launch_windows_powershell_console");
    expect(powershellConsoleLauncher).toContain('Command::new("powershell.exe")');
    expect(powershellConsoleLauncher).toContain("creation_flags(CREATE_NEW_CONSOLE)");
    expect(powershellConsoleLauncher).not.toContain(".stdin(Stdio::null())");
    expect(powershellConsoleLauncher).not.toContain(".stdout(Stdio::null())");
    expect(powershellConsoleLauncher).not.toContain(".stderr(Stdio::null())");
  });

  it("does not block the desktop app while macOS Terminal automation runs", () => {
    const macosLauncher = rustLauncher.slice(
      rustLauncher.indexOf("fn launch_macos_terminal"),
      rustLauncher.indexOf("fn macos_terminal_command")
    );

    expect(macosLauncher).toContain('Command::new("osascript")');
    expect(macosLauncher).toContain(".spawn()");
    expect(macosLauncher).not.toContain(".status()");
  });

  it("enforces a desktop content security policy", () => {
    expect(config.app.security.csp).toContain("default-src 'self'");
    expect(config.app.security.csp).toContain("connect-src 'self'");
    expect(config.app.security.csp).not.toContain("127.0.0.1:*");
    expect(config.app.security.csp).toContain("object-src 'none'");
  });

  it("does not expose the Tauri API globally", () => {
    expect(config.app.withGlobalTauri).not.toBe(true);
  });

  it("allows the main window to open trusted help links in the system browser", () => {
    expect(capability.windows).toContain("main");
    expect(capability.permissions).toContain("opener:default");
  });
});
