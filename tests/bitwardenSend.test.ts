import { describe, expect, it } from "vitest";
import type { CliCommandInput, CliCommandResult } from "@wardsen/security";
import { BitwardenSendDeliveryProvider } from "@wardsen/delivery-bitwarden-send";

function ok(stdout = "{}"): CliCommandResult {
  return { exitCode: 0, stdout, stderr: "", durationMs: 1 };
}

function encodedSendPayload(): string {
  return "encoded-send-payload";
}

describe("Bitwarden Send delivery provider", () => {
  it("creates text sends with secret redaction, session env, expiry, and access limits", async () => {
    const calls: CliCommandInput[] = [];
    const provider = new BitwardenSendDeliveryProvider({
      getSessionToken: () => "session-token",
      profileDirectoryFor: (accountId) => `profiles/${accountId}`,
      runCommand: async (input) => {
        calls.push(input);
        if (input.args[0] === "encode") return ok(encodedSendPayload());
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
    expect(calls).toHaveLength(2);
    expect(calls[0].args).toEqual(["encode"]);
    expect(calls[0].stdin).toContain('"object":"send"');
    expect(calls[0].stdin).toContain('"name":"Production Admin"');
    expect(calls[0].stdin).toContain('"deletionDate":"2026-08-01T12:00:00.000Z"');
    expect(calls[0].stdin).toContain('"maxAccessCount":2');
    expect(calls[0].stdin).toContain('"hidden":true');
    expect(calls[0].stdin).toContain("Password: credential-password");
    expect(calls[0].stdin).toContain("TOTP: 123456");
    expect(calls[1].args).toEqual(["send", "--fullObject", "create"]);
    expect(calls[1].args).not.toContain("--expirationDate");
    expect(calls[1].args).not.toContain("--deleteInDays");
    expect(calls[1].stdin).toBe(encodedSendPayload());
    expect(calls[0].env?.BW_SESSION).toBe("session-token");
    expect(calls[1].env?.BW_SESSION).toBe("session-token");
    expect(calls[0].env?.BITWARDENCLI_APPDATA_DIR).toBe("profiles/acct-1");
    expect(calls[1].env?.BITWARDENCLI_APPDATA_DIR).toBe("profiles/acct-1");
    expect(calls[0].redact).toEqual(expect.arrayContaining(["session-token", calls[0].stdin, "Title: Production Admin\nUsername: admin\nPassword: credential-password\nURLs: https://app.example.test\nNotes: Rotate after incident\nTOTP: 123456"]));
    expect(calls[1].redact).toEqual(expect.arrayContaining(["session-token", calls[0].stdin, encodedSendPayload()]));
  });

  it("uses the isolated account profile when checking Bitwarden Send readiness", async () => {
    const calls: CliCommandInput[] = [];
    const provider = new BitwardenSendDeliveryProvider({
      getSessionToken: () => "session-token",
      profileDirectoryFor: (accountId) => `profiles/${accountId}`,
      runCommand: async (input) => {
        calls.push(input);
        return ok("[]");
      }
    });

    await expect(provider.testConnection("acct-1")).resolves.toEqual({ ok: true, status: "unlocked" });

    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(["send", "list"]);
    expect(calls[0].env?.BW_SESSION).toBe("session-token");
    expect(calls[0].env?.BITWARDENCLI_APPDATA_DIR).toBe("profiles/acct-1");
  });

  it("pipes Bitwarden Send payloads through stdin without exposing the secret as an argument", async () => {
    const calls: CliCommandInput[] = [];
    const provider = new BitwardenSendDeliveryProvider({
      getSessionToken: () => "session-token",
      runCommand: async (input) => {
        calls.push(input);
        if (input.args[0] === "encode") return ok(encodedSendPayload());
        return ok(JSON.stringify({ id: "send-1", accessUrl: "https://send.example.test/#abc" }));
      }
    });

    await provider.createDelivery({
      deliveryAccountId: "acct-1",
      expiresAt: new Date(Date.now() + 49 * 60 * 60 * 1000),
      sourceCredential: { title: "Admin", password: "credential-password", urls: [] }
    });

    expect(calls[0].args).toEqual(["encode"]);
    expect(calls[1].args).toEqual(["send", "--fullObject", "create"]);
    expect(calls[0].args.join(" ")).not.toContain("credential-password");
    expect(calls[1].args.join(" ")).not.toContain("credential-password");
    expect(calls[1].args.join(" ")).not.toContain(encodedSendPayload());
    expect(calls[0].stdin).toContain("credential-password");
    expect(calls[1].stdin).toBe(encodedSendPayload());
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
          if (input.args[0] === "encode") return ok(encodedSendPayload());
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
      runCommand: async (input) => input.args[0] === "encode" ? ok(encodedSendPayload()) : ok("{broken")
    });

    await expect(
      provider.createDelivery({
        deliveryAccountId: "acct-1",
        expiresAt: new Date("2026-08-01T12:00:00.000Z"),
        sourceCredential: { title: "Admin", urls: [] }
      })
    ).rejects.toThrow("Bitwarden Send create response returned invalid JSON");
  });

  it("rejects missing encoded Send payloads with a safe error", async () => {
    const provider = new BitwardenSendDeliveryProvider({
      getSessionToken: () => "session-token",
      runCommand: async () => ok("")
    });

    await expect(
      provider.createDelivery({
        deliveryAccountId: "acct-1",
        expiresAt: new Date("2026-08-01T12:00:00.000Z"),
        sourceCredential: { title: "Admin", urls: [] }
      })
    ).rejects.toThrow("Bitwarden CLI did not encode the Send payload");
  });
});
