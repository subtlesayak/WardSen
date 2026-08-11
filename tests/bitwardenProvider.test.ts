import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AccountSessionManager } from "@wardsen/core";
import type { CliCommandInput, CliCommandResult } from "@wardsen/security";
import { BitwardenCredentialProvider } from "@wardsen/provider-bitwarden";

function ok(stdout = "{}"): CliCommandResult {
  return { exitCode: 0, stdout, stderr: "", durationMs: 1 };
}

function handoffPath(profileDir: string, accountId: string) {
  const entropy = createHash("sha256").update(`${accountId}\0${path.resolve(profileDir)}`).digest("hex").slice(0, 16);
  return path.join(profileDir, `.wardsen-session-${entropy}`);
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
      platform: "win32",
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
    ).rejects.toThrow(`$env:BITWARDENCLI_APPDATA_DIR='${expectedProfile}'; $bwResult=bw login 'user@example.com' --raw 2>&1`);
    await expect(provider.login("acct-1", { username: "user@example.com" })).rejects.toThrow("bw unlock --raw");
    await expect(provider.login("acct-1", { username: "user@example.com" })).rejects.toThrow("Set-Content -LiteralPath");
    await expect(provider.login("acct-1", { username: "user@example.com" })).rejects.toThrow(".wardsen-session-");
  });

  it("uses PowerShell environment expansion for local app data profiles", async () => {
    const previous = process.env.LOCALAPPDATA;
    const localAppData = path.resolve("local-app-data");
    process.env.LOCALAPPDATA = localAppData;
    const provider = new BitwardenCredentialProvider({
      platform: "win32",
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

  it("uses macOS shell syntax for terminal login commands on macOS", async () => {
    const previous = process.env.HOME;
    const home = path.resolve("home-root");
    process.env.HOME = home;
    const provider = new BitwardenCredentialProvider({
      platform: "darwin",
      profileRoot: path.join(home, "Library", "Application Support", "dev.wardsen.desktop", "wardsen-data", "profiles"),
      runCommand: async () => ok()
    });

    try {
      const login = provider.login("acct-1", {
        username: "user@example.com",
        password: "vault-password",
        verificationCode: "123456"
      });

      await expect(login).rejects.toThrow("export BITWARDENCLI_APPDATA_DIR=\"$HOME/Library/Application Support/dev.wardsen.desktop/wardsen-data/profiles/acct-1\"; bwResult=\"$(bw login 'user@example.com' --raw 2>&1)\"");
      await expect(provider.login("acct-1", { username: "user@example.com" })).rejects.toThrow("bw unlock --raw");
      await expect(provider.login("acct-1", { username: "user@example.com" })).rejects.not.toThrow("$env:BITWARDENCLI_APPDATA_DIR");
      await expect(provider.login("acct-1", { username: "user@example.com" })).rejects.not.toThrow("Remove-Item Env:");
      await expect(provider.login("acct-1", { username: "user@example.com" })).rejects.toThrow("bwExitCode=$?");
      await expect(provider.login("acct-1", { username: "user@example.com" })).rejects.not.toThrow("status=$?");
    } finally {
      if (previous === undefined) delete process.env.HOME;
      else process.env.HOME = previous;
    }
  });

  it("imports and deletes a terminal-created session handoff on unlock", async () => {
    const sessions = new AccountSessionManager();
    const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wardsen-bw-"));
    const profileDir = path.join(profileRoot, "acct-1");
    fs.mkdirSync(profileDir, { recursive: true });
    const sessionPath = handoffPath(profileDir, "acct-1");
    fs.writeFileSync(sessionPath, "terminal-session\n");
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
      expect(fs.existsSync(sessionPath)).toBe(false);
    } finally {
      fs.rmSync(profileRoot, { recursive: true, force: true });
    }
  });

  it("uses a custom per-account profile directory for Bitwarden commands and terminal handoff", async () => {
    const sessions = new AccountSessionManager();
    const customProfile = fs.mkdtempSync(path.join(os.tmpdir(), "wardsen-custom-bw-"));
    const calls: CliCommandInput[] = [];
    const provider = new BitwardenCredentialProvider({
      platform: "win32",
      profileRoot: "profiles",
      sessions,
      profileDirectoryFor: (accountId) => accountId === "acct-1" ? customProfile : undefined,
      runCommand: async (input) => {
        calls.push(input);
        if (input.args.join(" ") === "unlock --raw") return ok("session-token\n");
        if (input.args[0] === "list") return ok("[]");
        return ok();
      }
    });

    try {
      await expect(provider.login("acct-1", { username: "user@example.com" })).rejects.toThrow("wardsen-custom-bw-");
      const sessionPath = handoffPath(customProfile, "acct-1");
      fs.writeFileSync(sessionPath, "terminal-session\n");
      await provider.unlock("acct-1", {});
      await provider.search("acct-1", "", { page: 1, pageSize: 10 });

      expect(fs.existsSync(sessionPath)).toBe(false);
      expect(calls.at(-1)?.env?.BITWARDENCLI_APPDATA_DIR).toBe(customProfile);
      expect(calls.at(-1)?.env?.BW_SESSION).toBe("terminal-session");
    } finally {
      fs.rmSync(customProfile, { recursive: true, force: true });
    }
  });

  it("rejects stale terminal session handoff files and removes legacy handoff files", async () => {
    const sessions = new AccountSessionManager();
    const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wardsen-bw-stale-"));
    const profileDir = path.join(profileRoot, "acct-1");
    fs.mkdirSync(profileDir, { recursive: true });
    const sessionPath = handoffPath(profileDir, "acct-1");
    fs.writeFileSync(sessionPath, "stale-session\n");
    fs.writeFileSync(path.join(profileDir, ".wardsen-session"), "legacy-session\n");
    const staleDate = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(sessionPath, staleDate, staleDate);
    const provider = new BitwardenCredentialProvider({
      profileRoot,
      sessions,
      runCommand: async () => ok()
    });

    try {
      await expect(provider.unlock("acct-1", {})).rejects.toThrow("Manual same-profile terminal login command:");
      expect(fs.existsSync(sessionPath)).toBe(false);
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

  it("rejects relative Bitwarden CLI environment overrides", () => {
    const previous = process.env.WARDSEN_BITWARDEN_CLI_PATH;
    process.env.WARDSEN_BITWARDEN_CLI_PATH = "tools/bw";
    try {
      expect(() => new BitwardenCredentialProvider({
        profileRoot: "profiles",
        runCommand: async () => ok()
      })).toThrow("WARDSEN_BITWARDEN_CLI_PATH must be an absolute executable path");
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

  it("preserves secret fields when reading a Bitwarden item for delivery", async () => {
    const sessions = new AccountSessionManager();
    sessions.markUnlocked("acct-1", "bitwarden", "session-token");
    const calls: CliCommandInput[] = [];
    const provider = new BitwardenCredentialProvider({
      profileRoot: "profiles",
      sessions,
      runCommand: async (input) => {
        calls.push(input);
        return ok(JSON.stringify({
          id: "item-1",
          name: "Google",
          login: {
            username: "user@example.com",
            password: "real-password",
            totp: "123456",
            uris: [{ uri: "https://accounts.google.com" }]
          },
          notes: "delivery note"
        }));
      }
    });

    await expect(provider.getCredential("acct-1", "item-1")).resolves.toEqual({
      title: "Google",
      username: "user@example.com",
      password: "real-password",
      totp: "123456",
      urls: ["https://accounts.google.com"],
      notes: "delivery note"
    });
    expect(calls[0]?.rawOutput).toBe(true);
    expect(calls[0]?.redact).toContain("session-token");
  });
});
