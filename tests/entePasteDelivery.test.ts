import { describe, expect, it } from "vitest";
import { EntePasteManualDeliveryProvider, formatCredentialText } from "../packages/delivery-ente-paste/src";

describe("Ente Paste manual delivery provider", () => {
  it("copies only the required credential fields to the local clipboard and returns a handoff URL", async () => {
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
        totp: "JBSWY3DPEHPK3PXP",
        notes: "Use during incident only."
      }
    });

    expect(result).toMatchObject({
      url: "https://paste.ente.com/",
      expiresAt: new Date("2026-08-13T00:00:00.000Z"),
      viewLimit: 1,
      status: "handoff_pending"
    });
    expect(result.deliveryId).toBe("ente-manual-delivery-test");
    expect(clipboard).toEqual([
      [
        "Title: Admin Console",
        "Username: asha",
        "Password: Secret123"
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

  it("keeps the provider delivery id independent from secret contents", async () => {
    const provider = new EntePasteManualDeliveryProvider({ writeClipboard: async () => {} });
    const createDelivery = (password: string) => provider.createDelivery({
      operationId: "opaque-operation-id",
      deliveryAccountId: "account-1",
      expiresAt: new Date(Date.now() + 3600000),
      sourceCredential: {
        title: "CMS",
        password,
        urls: ["https://example.com"],
        totp: "JBSWY3DPEHPK3PXP",
        notes: "Never persist this."
      }
    });

    const [first, second] = await Promise.all([createDelivery("Password123"), createDelivery("DifferentPassword456")]);

    expect(first.deliveryId).toBe("ente-manual-opaque-operation-id");
    expect(second.deliveryId).toBe(first.deliveryId);
    expect(first.deliveryId).not.toContain("Password123");
    expect(second.deliveryId).not.toContain("DifferentPassword456");
  });

  it("excludes URLs, TOTP secrets and notes from the local handoff text", () => {
    const text = formatCredentialText({
      title: "CMS",
      username: "mira",
      password: "Password123",
      urls: ["https://example.com"],
      totp: "JBSWY3DPEHPK3PXP",
      notes: "Private operator note."
    });

    expect(text).toBe(["Title: CMS", "Username: mira", "Password: Password123"].join("\n"));
    expect(text).not.toContain("example.com");
    expect(text).not.toContain("JBSWY3DPEHPK3PXP");
    expect(text).not.toContain("Private operator note.");
  });
});
