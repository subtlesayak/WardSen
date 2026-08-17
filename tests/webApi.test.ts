import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { apiGet, apiSend, apiUrl, canLaunchTerminalSession, canRestartLocalService, copyExternalUrl, copyTextToClipboard, getLocalServiceStatus, openExternalUrl, openMailDraft, openTerminalSession, restartLocalService } from "../apps/web/src/api";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined)
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(async () => undefined)
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("web API helpers", () => {
  it("parses successful JSON responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    await expect(apiGet<{ ok: boolean }>("/api/health")).resolves.toEqual({ ok: true });
  });

  it("throws response body on failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(apiGet("/api/fail")).rejects.toThrow("nope");
  });

  it("unwraps JSON API error messages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Cross-origin request blocked: use http://127.0.0.1:4777." }), { status: 400 })));
    await expect(apiGet("/api/fail")).rejects.toThrow("Cross-origin request blocked: use http://127.0.0.1:4777.");
  });

  it("defaults mutating requests to JSON POST", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiSend("/api/accounts", { body: JSON.stringify({ label: "Ops" }) });
    expect(fetchMock).toHaveBeenCalledWith("/api/accounts", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ label: "Ops" }),
      headers: expect.objectContaining({ "content-type": "application/json" })
    }));
  });

  it("sends an empty JSON object for actions without an input body", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiSend("/api/accounts/work/lock");

    expect(fetchMock).toHaveBeenCalledWith("/api/accounts/work/lock", expect.objectContaining({ body: "{}" }));
  });

  it("returns parsed JSON from mutating requests", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "delivery-1" }), { status: 200 })));
    await expect(apiSend<{ id: string }>("/api/deliveries", { body: "{}" })).resolves.toEqual({ id: "delivery-1" });
  });

  it("proxies desktop API requests without exposing a local service URL or token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "proxy_local_service_request") {
        return { statusCode: 200, body: JSON.stringify({ ok: true }), contentType: "application/json" };
      }
      return undefined;
    });
    vi.stubGlobal("window", {
      location: { protocol: "tauri:", hostname: "localhost" }
    });

    await expect(apiGet<{ ok: boolean }>("/api/health")).resolves.toEqual({ ok: true });

    expect(invoke).toHaveBeenCalledWith("proxy_local_service_request", {
      request: { path: "/api/health", method: "GET", body: undefined, employeeSession: undefined }
    });
    expect(invoke).not.toHaveBeenCalledWith("get_local_service_url");
    expect(invoke).not.toHaveBeenCalledWith("get_api_token");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards the employee portal session only through the desktop proxy", async () => {
    vi.mocked(invoke).mockResolvedValue({ statusCode: 200, body: "{}", contentType: "application/json" });
    vi.stubGlobal("window", { location: { protocol: "tauri:", hostname: "localhost" } });

    await apiSend("/api/employee-portal/credential-requests", {
      headers: { "x-wardsen-employee-session": "employee-session" },
      body: JSON.stringify({ reason: "needed" })
    });

    expect(invoke).toHaveBeenCalledWith("proxy_local_service_request", {
      request: {
        path: "/api/employee-portal/credential-requests",
        method: "POST",
        body: JSON.stringify({ reason: "needed" }),
        employeeSession: "employee-session"
      }
    });
  });

  it("can restart the local service when packaged under Tauri", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    vi.stubGlobal("window", {
      location: { protocol: "tauri:", hostname: "localhost" }
    });

    expect(canRestartLocalService()).toBe(true);
    await restartLocalService();

    expect(invoke).toHaveBeenCalledWith("restart_local_service");
  });

  it("opens a terminal session from an opaque server-issued launch reference", async () => {
    vi.stubGlobal("window", {
      location: { protocol: "tauri:", hostname: "localhost" }
    });

    expect(canLaunchTerminalSession()).toBe(true);
    await openTerminalSession("work", "launch-123");

    expect(invoke).toHaveBeenCalledWith("open_terminal_session", { accountId: "work", launchId: "launch-123" });
  });

  it("does not try to restart the local service from the browser build", async () => {
    vi.stubGlobal("window", {
      location: { protocol: "http:", hostname: "127.0.0.1" }
    });

    expect(canRestartLocalService()).toBe(false);
    await restartLocalService();

    expect(invoke).not.toHaveBeenCalled();
  });

  it("reads local service diagnostics when packaged under Tauri", async () => {
    const status = {
      running: false,
      port: 43127,
      portOpen: false,
      nodeRuntimeFound: true,
      serverBundleFound: true,
      lastExit: "exited with code 1"
    };
    vi.mocked(invoke).mockResolvedValueOnce(status);
    vi.stubGlobal("window", {
      location: { protocol: "tauri:", hostname: "localhost" }
    });

    await expect(getLocalServiceStatus()).resolves.toEqual(status);

    expect(invoke).toHaveBeenCalledWith("local_service_status");
  });

  it("opens help links through the Tauri opener in the desktop app", async () => {
    vi.stubGlobal("window", {
      location: { protocol: "tauri:", hostname: "localhost" }
    });

    await openExternalUrl("https://bitwarden.com/help/cli/");

    expect(openUrl).toHaveBeenCalledWith("https://bitwarden.com/help/cli/");
  });

  it("opens help links with a browser fallback in the web build", async () => {
    const open = vi.fn(() => ({ closed: false }));
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: { protocol: "http:", hostname: "127.0.0.1", assign },
      open
    });

    await openExternalUrl("https://keepassxc.org/download/");

    expect(open).toHaveBeenCalledWith("https://keepassxc.org/download/", "_blank", "noopener,noreferrer");
    expect(assign).not.toHaveBeenCalled();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("rejects non-web external links", async () => {
    await expect(openExternalUrl("file:///C:/Windows/System32/calc.exe")).rejects.toThrow("HTTP or HTTPS");
  });

  it("opens mail drafts through the Tauri opener without accepting arbitrary protocols", async () => {
    vi.stubGlobal("window", {
      location: { protocol: "tauri:", hostname: "localhost" }
    });

    await openMailDraft("mailto:ravi@example.com?subject=WardSen%20code");

    expect(openUrl).toHaveBeenCalledWith("mailto:ravi@example.com?subject=WardSen%20code");
    await expect(openMailDraft("https://example.com")).rejects.toThrow("mailto protocol");
  });

  it("opens mail drafts with location fallback in the web build", async () => {
    const location = { protocol: "http:", hostname: "127.0.0.1", href: "" };
    vi.stubGlobal("window", { location });

    await openMailDraft("mailto:ravi@example.com?subject=WardSen%20code");

    expect(location.href).toBe("mailto:ravi@example.com?subject=WardSen%20code");
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("copies help links for users whose default browser cannot open", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await copyExternalUrl("https://bitwarden.com/help/cli/");

    expect(writeText).toHaveBeenCalledWith("https://bitwarden.com/help/cli/");
  });

  it("copies terminal commands", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await copyTextToClipboard("npm install -g @bitwarden/cli");

    expect(writeText).toHaveBeenCalledWith("npm install -g @bitwarden/cli");
  });

  it("rejects non-web copy links", async () => {
    await expect(copyExternalUrl("file:///C:/Windows/System32/calc.exe")).rejects.toThrow("HTTP or HTTPS");
  });

  it("rejects absolute API URLs", async () => {
    await expect(apiUrl("https://example.com/api/health")).rejects.toThrow("WardSen API paths must be local application paths");
  });
});
