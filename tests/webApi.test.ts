import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { apiGet, apiSend, apiUrl, canRestartLocalService, copyExternalUrl, getLocalServiceStatus, openExternalUrl, restartLocalService } from "../apps/web/src/api";

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
      headers: expect.objectContaining({ "content-type": "application/json" })
    }));
  });

  it("returns parsed JSON from mutating requests", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "delivery-1" }), { status: 200 })));
    await expect(apiSend<{ id: string }>("/api/deliveries", { body: "{}" })).resolves.toEqual({ id: "delivery-1" });
  });

  it("targets the localhost API when packaged under Tauri", () => {
    vi.stubGlobal("window", { location: { protocol: "tauri:", hostname: "localhost" } });

    expect(apiUrl("/api/health")).toBe("http://127.0.0.1:4777/api/health");
  });

  it("adds the desktop API token when packaged under Tauri", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(invoke).mockResolvedValueOnce("desktop-token");
    vi.stubGlobal("window", {
      location: { protocol: "tauri:", hostname: "localhost" }
    });

    await apiGet("/api/health");

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4777/api/health", {
      headers: { "x-wardsen-api-token": "desktop-token" }
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

  it("copies help links for users whose default browser cannot open", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await copyExternalUrl("https://bitwarden.com/help/cli/");

    expect(writeText).toHaveBeenCalledWith("https://bitwarden.com/help/cli/");
  });

  it("rejects non-web copy links", async () => {
    await expect(copyExternalUrl("file:///C:/Windows/System32/calc.exe")).rejects.toThrow("HTTP or HTTPS");
  });

  it("rejects absolute API URLs", () => {
    expect(() => apiUrl("https://example.com/api/health")).toThrow("WardSen API paths must be local application paths");
  });
});
