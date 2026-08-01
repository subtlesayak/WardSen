import path from "node:path";
import { describe, expect, it } from "vitest";
import { AccountSessionManager } from "@wardsen/core";
import type { CliCommandInput, CliCommandResult } from "@wardsen/security";
import { BitwardenCredentialProvider } from "@wardsen/provider-bitwarden";

function ok(stdout = "{}"): CliCommandResult {
  return { exitCode: 0, stdout, stderr: "", durationMs: 1 };
}

describe("Bitwarden credential provider", () => {
  it("maps Bitwarden CLI status without exposing raw command details", async () => {
    const provider = new BitwardenCredentialProvider({
      profileRoot: "profiles",
      runCommand: async () => ok(JSON.stringify({ status: "locked" }))
    });

    await expect(provider.testConnection("acct-1")).resolves.toMatchObject({
      ok: true,
      status: "locked",
      safeMessage: "locked"
    });
  });

  it("uses isolated account profiles and redacts login passwords", async () => {
    const calls: CliCommandInput[] = [];
    const provider = new BitwardenCredentialProvider({
      profileRoot: "profiles",
      runCommand: async (input) => {
        calls.push(input);
        return ok();
      }
    });

    await provider.login("acct-1", {
      username: "user@example.com",
      password: "vault-password",
      verificationCode: "123456",
      serverUrl: "https://vault.example.test"
    });

    expect(calls.map((call) => call.args)).toEqual([
      ["config", "server", "https://vault.example.test"],
      ["login", "user@example.com", "--passwordenv", "WARDSEN_BW_PASSWORD", "--method", "1", "--code", "123456"]
    ]);
    expect(calls.every((call) => call.env?.BITWARDENCLI_APPDATA_DIR === path.join("profiles", "acct-1"))).toBe(true);
    expect(calls[1].stdin).toBeUndefined();
    expect(calls[1].env?.WARDSEN_BW_PASSWORD).toBe("vault-password");
    expect(calls[1].redact).toContain("vault-password");
    expect(calls[1].redact).toContain("123456");
  });

  it("maps Bitwarden verification code types to CLI method ids", async () => {
    const calls: CliCommandInput[] = [];
    const provider = new BitwardenCredentialProvider({
      profileRoot: "profiles",
      runCommand: async (input) => {
        calls.push(input);
        return ok();
      }
    });

    await provider.login("acct-1", {
      username: "user@example.com",
      password: "vault-password",
      verificationCode: "654321",
      verificationMethod: "authenticator"
    });

    expect(calls.at(-1)?.args).toEqual(["login", "user@example.com", "--passwordenv", "WARDSEN_BW_PASSWORD", "--method", "0", "--code", "654321"]);
    expect(calls.at(-1)?.env?.WARDSEN_BW_PASSWORD).toBe("vault-password");
  });

  it("uses a configured local Bitwarden CLI path when available", async () => {
    const previous = process.env.WARDSEN_BITWARDEN_CLI_PATH;
    process.env.WARDSEN_BITWARDEN_CLI_PATH = process.execPath;
    const calls: CliCommandInput[] = [];
    try {
      const provider = new BitwardenCredentialProvider({
        profileRoot: "profiles",
        runCommand: async (input) => {
          calls.push(input);
          return ok();
        }
      });

      await provider.login("acct-1", { username: "user@example.com" });

      expect(calls.at(-1)?.executable).toBe(process.execPath);
      expect(calls.at(-1)?.timeoutMs).toBe(45_000);
    } finally {
      if (previous === undefined) delete process.env.WARDSEN_BITWARDEN_CLI_PATH;
      else process.env.WARDSEN_BITWARDEN_CLI_PATH = previous;
    }
  });

  it("unlocks once, searches with the session token, paginates, and filters malformed items", async () => {
    const sessions = new AccountSessionManager();
    const calls: CliCommandInput[] = [];
    const provider = new BitwardenCredentialProvider({
      profileRoot: "profiles",
      sessions,
      runCommand: async (input) => {
        calls.push(input);
        if (input.args.join(" ") === "unlock --raw") return ok("session-token\n");
        if (input.args.join(" ") === "list items --search mail") {
          return ok(
            JSON.stringify([
              { id: "bad-row" },
              { id: "item-1", name: "Email", type: 1, login: { username: "hello", uris: [{ uri: "https://mail.example.com/login" }] } },
              { id: "item-2", name: "Admin", type: 2, login: { uris: [{ uri: "not a url" }] } }
            ])
          );
        }
        return ok();
      }
    });

    await provider.unlock("acct-1", { password: "vault-password" });
    const results = await provider.search("acct-1", "mail", { page: 1, pageSize: 10 });

    expect(results).toEqual([
      {
        id: "item-1",
        accountId: "acct-1",
        providerId: "bitwarden",
        title: "Email",
        username: "hello",
        domain: "mail.example.com",
        uriPreview: "mail.example.com",
        itemType: "login"
      },
      {
        id: "item-2",
        accountId: "acct-1",
        providerId: "bitwarden",
        title: "Admin",
        username: undefined,
        domain: undefined,
        uriPreview: undefined,
        itemType: "other"
      }
    ]);
    const searchCall = calls.find((call) => call.args[0] === "list");
    expect(searchCall?.env?.BW_SESSION).toBe("session-token");
    expect(searchCall?.redact).toContain("session-token");
    expect(searchCall?.env?.BITWARDENCLI_APPDATA_DIR).toBe(path.join("profiles", "acct-1"));
  });

  it("returns a clear error for invalid item JSON", async () => {
    const sessions = new AccountSessionManager();
    sessions.markUnlocked("acct-1", "bitwarden", "session-token");
    const provider = new BitwardenCredentialProvider({
      profileRoot: "profiles",
      sessions,
      runCommand: async () => ok("{broken")
    });

    await expect(provider.getCredential("acct-1", "item-1")).rejects.toThrow("Bitwarden item returned invalid JSON");
  });
});
