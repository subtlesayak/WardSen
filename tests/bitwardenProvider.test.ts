import fs from "node:fs";
import os from "node:os";
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

  it("uses terminal-only first login guidance instead of hidden password or OTP prompts", async () => {
    const calls: CliCommandInput[] = [];
    const provider = new BitwardenCredentialProvider({
      profileRoot: "profiles",
      runCommand: async (input) => {
        calls.push(input);
        return ok();
      }
    });

    await expect(
      provider.login("acct-1", {
        username: "user@example.com",
        password: "vault-password",
        verificationCode: "123456",
        serverUrl: "https://vault.example.test"
      })
    ).rejects.toThrow("Manual same-profile terminal login command:");

    expect(calls.map((call) => call.args)).toEqual([["config", "server", "https://vault.example.test"]]);
    expect(calls[0]?.env?.BITWARDENCLI_APPDATA_DIR).toBe(path.join("profiles", "acct-1"));
  });

  it("builds a same-profile terminal command that captures the raw Bitwarden session", async () => {
    const expectedProfile = path.join("profiles", "acct-1");
    const provider = new BitwardenCredentialProvider({
      profileRoot: "profiles",
      runCommand: async () => ok()
    });

    await expect(
      provider.login("acct-1", {
        username: "user@example.com",
        password: "vault-password",
        verificationCode: "123456"
      })
    ).rejects.toThrow("Manual same-profile terminal login command:");
    await expect(
      provider.login("acct-1", {
        username: "user@example.com",
        password: "vault-password",
        verificationCode: "123456"
      })
    ).rejects.toThrow(`$env:BITWARDENCLI_APPDATA_DIR='${expectedProfile}'; $session=bw login 'user@example.com' --raw`);
    await expect(provider.login("acct-1", { username: "user@example.com" })).rejects.toThrow("Set-Content -LiteralPath");
  });

  it("uses PowerShell environment expansion for local app data profiles", async () => {
    const previous = process.env.LOCALAPPDATA;
    const localAppData = path.resolve("local-app-data");
    process.env.LOCALAPPDATA = localAppData;
    const provider = new BitwardenCredentialProvider({
      profileRoot: path.join(localAppData, "WardSen", "data", "profiles"),
      runCommand: async () => ok()
    });

    try {
      await expect(
        provider.login("acct-1", {
          username: "user@example.com",
          password: "vault-password",
          verificationCode: "123456"
        })
      ).rejects.toThrow("$env:BITWARDENCLI_APPDATA_DIR=$(Join-Path $env:LOCALAPPDATA");
    } finally {
      if (previous === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previous;
    }
  });

  it("imports and deletes a terminal-created session handoff on unlock", async () => {
    const sessions = new AccountSessionManager();
    const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wardsen-bw-"));
    const profileDir = path.join(profileRoot, "acct-1");
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(path.join(profileDir, ".wardsen-session"), "terminal-session\n");
    const calls: CliCommandInput[] = [];
    const provider = new BitwardenCredentialProvider({
      profileRoot,
      sessions,
      runCommand: async (input) => {
        calls.push(input);
        if (input.args[0] === "list") return ok("[]");
        return ok();
      }
    });

    try {
      await provider.unlock("acct-1", {});
      await provider.search("acct-1", "mail", { page: 1, pageSize: 10 });
      expect(calls[0]?.args).toEqual(["list", "items", "--search", "mail"]);
      expect(calls[0]?.env?.BW_SESSION).toBe("terminal-session");
      expect(fs.existsSync(path.join(profileDir, ".wardsen-session"))).toBe(false);
    } finally {
      fs.rmSync(profileRoot, { recursive: true, force: true });
    }
  });

  it("does not spawn an interactive unlock when no password or terminal session is available", async () => {
    const calls: CliCommandInput[] = [];
    const provider = new BitwardenCredentialProvider({
      profileRoot: "profiles",
      runCommand: async (input) => {
        calls.push(input);
        return ok();
      }
    });

    await expect(provider.unlock("acct-1", {})).rejects.toThrow("Manual same-profile terminal login command:");
    expect(calls).toEqual([]);
  });

  it("uses a configured local Bitwarden CLI path when checking status", async () => {
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

      await provider.testConnection("acct-1");

      expect(calls.at(-1)?.executable).toBe(process.execPath);
      expect(calls.at(-1)?.args).toEqual(["status"]);
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
