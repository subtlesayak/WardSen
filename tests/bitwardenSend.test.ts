import { describe, expect, it } from "vitest";
import type { CliCommandInput, CliCommandResult } from "@wardsen/security";
import { BitwardenSendDeliveryProvider } from "@wardsen/delivery-bitwarden-send";

function ok(stdout = "{}"): CliCommandResult {
  return { exitCode: 0, stdout, stderr: "", durationMs: 1 };
}

describe("Bitwarden Send delivery provider", () => {
  it("creates text sends with secret redaction, session env, expiry, and access limits", async () => {
    const calls: CliCommandInput[] = [];
    const provider = new BitwardenSendDeliveryProvider({
      getSessionToken: () => "session-token",
      runCommand: async (input) => {
        calls.push(input);
        return ok(JSON.stringify({ id: "send-1", accessUrl: "https://send.example.test/#abc" }));
      }
    });
    const expiresAt = new Date("2026-08-01T12:00:00.000Z");

    const result = await provider.createDelivery({
      deliveryAccountId: "acct-1",
      expiresAt,
      viewLimit: 2,
      hideText: true,
      sourceCredential: {
        title: "Production Admin",
        username: "admin",
        password: "credential-password",
        urls: ["https://app.example.test"],
        notes: "Rotate after incident",
        totp: "123456"
      }
    });

    expect(result).toEqual({
      deliveryId: "send-1",
      url: "https://send.example.test/#abc",
      expiresAt,
      viewLimit: 2
    });
    expect(calls[0].args).toEqual([
      "send",
      "text",
      "Production Admin",
      "--notes",
      "Created by WardSen",
      "--expirationDate",
      "2026-08-01T12:00:00.000Z",
      "--maxAccessCount",
      "2",
      "--hidden"
    ]);
    expect(calls[0].stdin).toContain("Password: credential-password");
    expect(calls[0].stdin).toContain("TOTP: 123456");
    expect(calls[0].env?.BW_SESSION).toBe("session-token");
    expect(calls[0].redact).toEqual(expect.arrayContaining(["session-token", calls[0].stdin]));
  });

  it("does not support access passwords because bw exposes them through process args", async () => {
    const provider = new BitwardenSendDeliveryProvider({
      getSessionToken: () => "session-token",
      runCommand: async () => ok()
    });

    await expect(provider.getCapabilities()).resolves.toMatchObject({ accessPassword: false });
    await expect(
      provider.createDelivery({
        deliveryAccountId: "acct-1",
        expiresAt: new Date("2026-08-01T12:00:00.000Z"),
        accessPassword: "send-password",
        sourceCredential: { title: "Admin", urls: [] }
      })
    ).rejects.toThrow("access passwords are disabled");
  });

  it("uses a configured local Bitwarden CLI path when available", async () => {
    const previous = process.env.WARDSEN_BITWARDEN_CLI_PATH;
    process.env.WARDSEN_BITWARDEN_CLI_PATH = process.execPath;
    const calls: CliCommandInput[] = [];
    try {
      const provider = new BitwardenSendDeliveryProvider({
        getSessionToken: () => "session-token",
        runCommand: async (input) => {
          calls.push(input);
          return ok(JSON.stringify({ id: "send-1", accessUrl: "https://send.example.test/#abc" }));
        }
      });

      await provider.createDelivery({
        deliveryAccountId: "acct-1",
        expiresAt: new Date("2026-08-01T12:00:00.000Z"),
        sourceCredential: { title: "Admin", urls: [] }
      });

      expect(calls[0].executable).toBe(process.execPath);
    } finally {
      if (previous === undefined) delete process.env.WARDSEN_BITWARDEN_CLI_PATH;
      else process.env.WARDSEN_BITWARDEN_CLI_PATH = previous;
    }
  });

  it("maps disabled sends as revoked and past expiries as expired", async () => {
    const provider = new BitwardenSendDeliveryProvider({
      getSessionToken: () => "session-token",
      runCommand: async (input) => {
        if (input.args.at(-1) === "revoked-send") {
          return ok(JSON.stringify({ id: "revoked-send", disabled: true, accessCount: 3 }));
        }
        return ok(JSON.stringify({ id: "expired-send", expirationDate: "2000-01-01T00:00:00.000Z" }));
      }
    });

    await expect(provider.getStatus("acct-1", "revoked-send")).resolves.toMatchObject({
      deliveryId: "revoked-send",
      status: "revoked",
      accessCount: 3
    });
    await expect(provider.getStatus("acct-1", "expired-send")).resolves.toMatchObject({
      deliveryId: "expired-send",
      status: "expired",
      expiresAt: new Date("2000-01-01T00:00:00.000Z")
    });
  });

  it("rejects malformed create responses with a safe error", async () => {
    const provider = new BitwardenSendDeliveryProvider({
      getSessionToken: () => "session-token",
      runCommand: async () => ok("{broken")
    });

    await expect(
      provider.createDelivery({
        deliveryAccountId: "acct-1",
        expiresAt: new Date("2026-08-01T12:00:00.000Z"),
        sourceCredential: { title: "Admin", urls: [] }
      })
    ).rejects.toThrow("Bitwarden Send create response returned invalid JSON");
  });
});
