import { describe, expect, it, vi } from "vitest";
import {
  OnetimeSecretDeliveryProvider,
  PasswordPusherDeliveryProvider,
  YopassDeliveryProvider,
  type DeliveryFetch
} from "@wardsen/delivery-external";

const now = new Date("2026-08-13T10:00:00.000Z");
const sourceCredential = {
  title: "Production CMS",
  username: "mira",
  password: "Password123",
  urls: ["https://admin.example.test"],
  totp: "JBSWY3DPEHPK3PXP",
  notes: "Never send this operator note."
};

describe("external delivery providers", () => {
  it("creates, checks and expires a Password Pusher link without projecting extra credential fields", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ url_token: "push-1", html_url: "https://push.example.test/p/push-1/r" }))
      .mockResolvedValueOnce(jsonResponse({ url_token: "push-1", expired: false }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const provider = new PasswordPusherDeliveryProvider({
      baseUrl: "https://push.example.test",
      apiToken: "pwp-token",
      fetch: fetch as unknown as DeliveryFetch,
      now: () => now
    });

    const created = await provider.createDelivery({
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      viewOnce: true,
      sourceCredential
    });

    expect(created).toMatchObject({ deliveryId: "push-1", status: "active", viewLimit: 1 });
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    expect(String(init.body)).toContain("password%5Bpayload%5D=Title%3A+Production+CMS");
    expect(String(init.body)).toContain("password%5Bexpire_after_views%5D=1");
    expect(String(init.body)).not.toContain("admin.example.test");
    expect(String(init.body)).not.toContain("JBSWY3DPEHPK3PXP");
    expect(String(init.body)).not.toContain("operator+note");
    expect(init.headers).toMatchObject({ Authorization: "Bearer pwp-token" });

    await expect(provider.getStatus("audit", "push-1")).resolves.toEqual({ deliveryId: "push-1", status: "active", expiresAt: undefined });
    await expect(provider.revoke("audit", "push-1")).resolves.toBeUndefined();
    expect(fetch.mock.calls[2]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("creates, observes and burns an authenticated Onetime Secret receipt without exposing extras", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        record: { receipt: { identifier: "receipt-1", share_url: "https://us.onetimesecret.com/secret/secret-1", expiration: "2026-08-14T10:00:00.000Z" } }
      }))
      .mockResolvedValueOnce(jsonResponse({ record: { state: "revealed", expiration: "2026-08-14T10:00:00.000Z" } }))
      .mockResolvedValueOnce(jsonResponse({ record: { state: "burned" } }));
    const provider = new OnetimeSecretDeliveryProvider({
      baseUrl: "https://us.onetimesecret.com",
      username: "operator@example.test",
      apiToken: "ots-token",
      fetch: fetch as unknown as DeliveryFetch,
      now: () => now
    });

    const created = await provider.createDelivery({
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      accessPassword: "SeparatePassphrase",
      recipient: { id: "asha", name: "Asha", email: "asha@example.test" },
      sourceCredential
    });

    expect(created).toMatchObject({ deliveryId: "receipt-1", status: "active", viewLimit: 1 });
    const body = String((fetch.mock.calls[0]?.[1] as RequestInit).body);
    expect(body).toContain("Title: Production CMS");
    expect(body).toContain("SeparatePassphrase");
    expect(body).not.toContain("admin.example.test");
    expect(body).not.toContain("JBSWY3DPEHPK3PXP");
    expect(body).not.toContain("operator note");

    await expect(provider.getStatus("audit", "receipt-1")).resolves.toMatchObject({ deliveryId: "receipt-1", status: "viewed" });
    await expect(provider.revoke("audit", "receipt-1")).resolves.toBeUndefined();
    expect(fetch.mock.calls[2]?.[0]).toBe("https://us.onetimesecret.com/api/v2/receipt/receipt-1/burn");
  });

  it("requires local API credentials before Password Pusher or Onetime Secret are selectable", async () => {
    await expect(new PasswordPusherDeliveryProvider({ apiToken: "" }).testConnection("audit"))
      .rejects.toThrow("WARDSEN_PASSWORD_PUSHER_API_TOKEN");
    await expect(new OnetimeSecretDeliveryProvider({ username: "", apiToken: "" }).testConnection("audit"))
      .rejects.toThrow("WARDSEN_ONETIME_SECRET_USERNAME");
  });

  it("uses the Yopass CLI for one-time encrypted delivery and keeps its persisted id opaque", async () => {
    const runCommand = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: "yopass 14.0.0", stderr: "", durationMs: 1 })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "Share this: https://yopass.example.test/#/s/link-key-material", stderr: "", durationMs: 1 });
    const provider = new YopassDeliveryProvider({
      executable: "yopass",
      apiUrl: "https://api.yopass.example.test",
      publicUrl: "https://yopass.example.test",
      runCommand,
      now: () => now
    });

    await expect(provider.testConnection("audit")).resolves.toMatchObject({ ok: true, status: "unlocked" });
    const created = await provider.createDelivery({
      operationId: "delivery-opaque-id",
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      viewOnce: true,
      sourceCredential
    });

    expect(created).toMatchObject({ deliveryId: "yopass-delivery-opaque-id", viewLimit: 1 });
    expect(created.deliveryId).not.toContain("link-key-material");
    const command = runCommand.mock.calls[1]?.[0];
    expect(command.args).toEqual(["--api", "https://api.yopass.example.test", "--url", "https://yopass.example.test", "--expiration", "1d", "--one-time"]);
    expect(command.stdin).toContain("Password: Password123");
    expect(command.stdin).not.toContain("admin.example.test");
    expect(command.stdin).not.toContain("JBSWY3DPEHPK3PXP");
    await expect(provider.revoke("audit", created.deliveryId)).rejects.toThrow("does not expose sender-side revoke");
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}
