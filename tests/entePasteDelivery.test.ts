import { describe, expect, it } from "vitest";
import { EntePasteManualDeliveryProvider, formatCredentialText } from "../packages/delivery-ente-paste/src";

describe("Ente Paste manual delivery provider", () => {
  it("copies a formatted credential to the local clipboard and returns a handoff URL", async () => {
    const clipboard: string[] = [];
    const provider = new EntePasteManualDeliveryProvider({
      writeClipboard: async (text) => { clipboard.push(text); },
      now: () => new Date("2026-08-12T00:00:00.000Z")
    });

    const result = await provider.createDelivery({
      operationId: "delivery-test",
      deliveryAccountId: "account-1",
      expiresAt: new Date("2026-08-15T00:00:00.000Z"),
      viewOnce: true,
      sourceCredential: {
        title: "Admin Console",
        username: "asha",
        password: "Secret123",
        urls: ["https://admin.example.test"],
        notes: "Use during incident only."
      }
    });

    expect(result).toMatchObject({
      url: "https://paste.ente.com/",
      expiresAt: new Date("2026-08-13T00:00:00.000Z"),
      viewLimit: 1,
      status: "handoff_pending"
    });
    expect(result.deliveryId).toMatch(/^ente-manual-/);
    expect(clipboard).toEqual([
      [
        "Title: Admin Console",
        "Username: asha",
        "Password: Secret123",
        "URL: https://admin.example.test",
        "",
        "Notes:",
        "Use during incident only."
      ].join("\n")
    ]);

    await provider.clearHandoffClipboard();
    expect(clipboard.at(-1)).toBe("");
  });

  it("rejects handoff text above Ente Paste's public character limit before touching the clipboard", async () => {
    const clipboard: string[] = [];
    const provider = new EntePasteManualDeliveryProvider({ writeClipboard: async (text) => { clipboard.push(text); } });

    await expect(provider.createDelivery({
      deliveryAccountId: "account-1",
      expiresAt: new Date(Date.now() + 3600000),
      sourceCredential: { title: "Large Secret", password: "x".repeat(4100), urls: [] }
    })).rejects.toThrow(/4000 characters/);
    expect(clipboard).toEqual([]);
  });

  it("does not claim sender-side revoke or status telemetry", async () => {
    const provider = new EntePasteManualDeliveryProvider({ writeClipboard: async () => {} });

    await expect(provider.revoke("account-1", "ente-manual-1")).rejects.toThrow(/does not expose sender-side revoke/);
    await expect(provider.getStatus("account-1", "ente-manual-1")).resolves.toEqual({
      deliveryId: "ente-manual-1",
      status: "handoff_pending"
    });
  });

  it("formats only the local handoff text and not a URL-bearing secret", () => {
    const text = formatCredentialText({
      title: "CMS",
      username: "mira",
      password: "Password123",
      urls: ["https://example.com"]
    });

    expect(text).toContain("Password: Password123");
    expect(text).not.toContain("paste.ente.com");
  });
});
