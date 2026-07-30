import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiSend, apiUrl } from "../apps/web/src/api";

afterEach(() => {
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
});
