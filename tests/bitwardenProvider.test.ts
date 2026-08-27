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

const terminalIdentity = {
  username: "work@example.test",
  serverUrl: "https://vault.example.test",
  providerPrincipalId: "user-work"
};

function unlockedTerminalStatus(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    status: "unlocked",
    userEmail: "Work@Example.Test",
    serverUrl: "https://vault.example.test/",
    userId: "user-work",
    ...overrides
  });
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

  it("uses a verified Bitwarden executable selected after the provider was created", async () => {
    const calls: CliCommandInput[] = [];
    let executable = path.resolve("first-bw");
    const provider = new BitwardenCredentialProvider({
      profileRoot: "profiles",
      getExecutable: () => executable,
      runCommand: async (input) => {
        calls.push(input);
        return ok(JSON.stringify({ status: "locked" }));
      }
    });

    await provider.testConnection("acct-1");
    executable = path.resolve("second-bw");
    await provider.testConnection("acct-1");

    expect(calls.map((input) => input.executable)).toEqual([path.resolve("first-bw"), path.resolve("second-bw")]);
  });

  it("validates terminal identity in the managed profile before the server retains the session", async () => {
    const sessions = new AccountSessionManager();
    const calls: CliCommandInput[] = [];
    const provider = new BitwardenCredentialProvider({
      profileRoot: "profiles",
      sessions,
      runCommand: async (input) => {
        calls.push(input);
        return ok(unlockedTerminalStatus());
      }
    });

    await expect(provider.acceptTerminalSessionHandoff("acct-1", "terminal-session", terminalIdentity)).resolves.toEqual({ providerPrincipalId: "user-work" });
    expect(() => sessions.getSessionToken("acct-1", "bitwarden")).toThrow();
    expect(calls[0]).toMatchObject({
      args: ["status", "--nointeraction"],
      env: {
        BITWARDENCLI_APPDATA_DIR: path.join("profiles", "acct-1"),
        BW_SESSION: "terminal-session"
      }
    });
    expect(calls[0]?.redact).toContain("terminal-session");

    sessions.markUnlocked("acct-1", "bitwarden", "terminal-session");

    await expect(provider.testConnection("acct-1")).resolves.toMatchObject({
      ok: true,
      status: "unlocked",
      safeMessage: "WardSen session active"
    });
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["cross-account session substitution", "email_mismatch", { userEmail: "other@example.test" }],
    ["wrong Bitwarden server", "server_mismatch", { serverUrl: "https://other.example.test" }],
    ["changed Bitwarden user ID", "user_id_mismatch", { userId: "user-other" }],
    ["empty Bitwarden status fields", "email_mismatch", { userEmail: "", serverUrl: "", userId: "" }],
    ["locked Bitwarden status", "not_unlocked", { status: "locked" }]
  ])("rejects %s without retaining the candidate session", async (_caseName, reason, overrides) => {
    const sessions = new AccountSessionManager();
    const calls: CliCommandInput[] = [];
    const provider = new BitwardenCredentialProvider({
      profileRoot: "profiles",
      sessions,
      runCommand: async (input) => {
        calls.push(input);
        return ok(unlockedTerminalStatus(overrides));
      }
    });

    await expect(provider.acceptTerminalSessionHandoff("acct-1", "candidate-session", terminalIdentity)).rejects.toMatchObject({ reason });
    expect(() => sessions.getSessionToken("acct-1", "bitwarden")).toThrow();
    expect(calls.map((call) => call.args)).toEqual([["status", "--nointeraction"], ["lock"]]);
    for (const call of calls) {
      expect(call.env).toMatchObject({ BITWARDENCLI_APPDATA_DIR: path.join("profiles", "acct-1"), BW_SESSION: "candidate-session" });
      expect(call.redact).toContain("candidate-session");
    }
  });

  it("rejects malformed Bitwarden terminal status JSON and attempts a lock", async () => {
    const calls: CliCommandInput[] = [];
    const provider = new BitwardenCredentialProvider({
      profileRoot: "profiles",
      runCommand: async (input) => {
        calls.push(input);
        return input.args[0] === "status" ? ok("not-json") : ok();
      }
    });

    await expect(provider.acceptTerminalSessionHandoff("acct-1", "candidate-session", terminalIdentity)).rejects.toMatchObject({ reason: "status_invalid" });
    expect(calls.map((call) => call.args)).toEqual([["status", "--nointeraction"], ["lock"]]);
  });

  it("clears the local session when a Bitwarden lock command fails", async () => {
    const sessions = new AccountSessionManager();
    const provider = new BitwardenCredentialProvider({
      profileRoot: "profiles",
      sessions,
      runCommand: async () => {
        throw new Error("Bitwarden lock command failed");
      }
    });
    sessions.markUnlocked("acct-1", "bitwarden", "terminal-session");

    await expect(provider.lock("acct-1")).rejects.toThrow("Bitwarden lock command failed");
    expect(() => sessions.getSessionToken("acct-1", "bitwarden")).toThrow();
  });

  it("requires WardSen to initiate a terminal-only Bitwarden login", async () => {
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
    ).rejects.toThrow("must be started from WardSen");

    expect(calls.map((call) => call.args)).toEqual([["config", "server", "https://vault.example.test"]]);
    expect(calls[0]?.env?.BITWARDENCLI_APPDATA_DIR).toBe(path.join("profiles", "acct-1"));
  });

  it("builds a PowerShell terminal command that streams the raw session to the one-time local receiver", () => {
    const expectedProfile = path.join("profiles", "acct-1");
    const previous = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = path.resolve("unrelated-local-app-data");
    const provider = new BitwardenCredentialProvider({
      platform: "win32",
      profileRoot: "profiles",
      runCommand: async () => ok()
    });

    try {
      const command = provider.createTerminalSessionHandoffCommand("acct-1", { username: "user@example.com" }, {
        claimUrl: "http://127.0.0.1:4777/api/accounts/acct-1/terminal-handoff/claim",
        token: "one-time-token"
      });

      expect(command).toContain(`$env:BITWARDENCLI_APPDATA_DIR='${expectedProfile}'`);
      expect(command).toContain("& $bwCommand login 'user@example.com'");
      expect(command).toContain("& $bwCommand unlock --raw");
      expect(command).toContain("Invoke-WebRequest");
      expect(command).toContain("X-WardSen-Terminal-Handoff");
      expect(command).not.toContain("Set-Content");
      expect(command).not.toContain(".wardsen-session");
    } finally {
      if (previous === undefined) delete process.env.LOCALAPPDATA;
      else process.env.LOCALAPPDATA = previous;
    }
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
      expect(provider.createTerminalSessionHandoffCommand("acct-1", { username: "user@example.com" }, {
        claimUrl: "http://127.0.0.1:4777/api/accounts/acct-1/terminal-handoff/claim",
        token: "one-time-token"
      })).toContain("$env:BITWARDENCLI_APPDATA_DIR=$(Join-Path $env:LOCALAPPDATA");
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
      const command = provider.createTerminalSessionHandoffCommand("acct-1", {
        username: "user@example.com"
      }, {
        claimUrl: "http://127.0.0.1:4777/api/accounts/acct-1/terminal-handoff/claim",
        token: "one-time-token"
      });

      expect(command).toContain("export BITWARDENCLI_APPDATA_DIR=\"$HOME/Library/Application Support/dev.wardsen.desktop/wardsen-data/profiles/acct-1\"");
      expect(command).toContain("WardSen could not find the Bitwarden CLI");
      expect(command).toContain("$HOME/.local/bin/bw");
      expect(command).toContain("\"$bwCommand\" login 'user@example.com'");
      expect(command).toContain("\"$bwCommand\" unlock --raw");
      expect(command).toContain("curl --fail --silent --show-error");
      expect(command).toContain("X-WardSen-Terminal-Handoff: one-time-token");
      expect(command).not.toContain(".wardsen-session");
      expect(command).not.toContain("$env:BITWARDENCLI_APPDATA_DIR");
      expect(command).not.toContain("Remove-Item Env:");
      expect(command).not.toContain("status=$?");
    } finally {
      if (previous === undefined) delete process.env.HOME;
      else process.env.HOME = previous;
    }
  });

  it("uses a resolved absolute Bitwarden CLI path in macOS terminal commands", () => {
    const provider = new BitwardenCredentialProvider({
      executable: "/opt/homebrew/bin/bw",
      platform: "darwin",
      profileRoot: "profiles",
      runCommand: async () => ok()
    });

    const command = provider.createTerminalSessionHandoffCommand("acct-1", { username: "user@example.com" }, {
      claimUrl: "http://127.0.0.1:4777/api/accounts/acct-1/terminal-handoff/claim",
      token: "one-time-token"
    });
    expect(command).toContain("bwCommand='/opt/homebrew/bin/bw'");
    expect(command).toContain("\"$bwCommand\" login 'user@example.com'");
    expect(command).toContain("\"$bwCommand\" unlock --raw");
    expect(command).not.toContain("; bw login");
    expect(command).not.toContain("| bw unlock --raw");
  });

  it("uses a validated terminal-created session for later credential commands", async () => {
    const sessions = new AccountSessionManager();
    const calls: CliCommandInput[] = [];
    const provider = new BitwardenCredentialProvider({
      profileRoot: "profiles",
      sessions,
      runCommand: async (input) => {
        calls.push(input);
        if (input.args[0] === "list") return ok("[]");
        return ok(unlockedTerminalStatus());
      }
    });

    await provider.acceptTerminalSessionHandoff("acct-1", "terminal-session\n", terminalIdentity);
    sessions.markUnlocked("acct-1", "bitwarden", "terminal-session");
    await provider.search("acct-1", "mail", { page: 1, pageSize: 10 });
    expect(calls[1]?.args).toEqual(["list", "items", "--search", "mail"]);
    expect(calls[1]?.env?.BW_SESSION).toBe("terminal-session");
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
        if (input.args[0] === "list") return ok("[]");
        return ok(unlockedTerminalStatus());
      }
    });

    try {
      const command = provider.createTerminalSessionHandoffCommand("acct-1", { username: "user@example.com" }, {
        claimUrl: "http://127.0.0.1:4777/api/accounts/acct-1/terminal-handoff/claim",
        token: "one-time-token"
      });
      expect(command).toContain("wardsen-custom-bw-");
      await provider.acceptTerminalSessionHandoff("acct-1", "terminal-session", terminalIdentity);
      sessions.markUnlocked("acct-1", "bitwarden", "terminal-session");
      await provider.search("acct-1", "", { page: 1, pageSize: 10 });

      expect(calls.at(-1)?.env?.BITWARDENCLI_APPDATA_DIR).toBe(customProfile);
      expect(calls.at(-1)?.env?.BW_SESSION).toBe("terminal-session");
    } finally {
      fs.rmSync(customProfile, { recursive: true, force: true });
    }
  });

  it("removes stale legacy session files without reading them", () => {
    const profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wardsen-bw-stale-"));
    const profileDir = path.join(profileRoot, "acct-1");
    fs.mkdirSync(profileDir, { recursive: true });
    const sessionPath = path.join(profileDir, ".wardsen-session-old");
    fs.writeFileSync(sessionPath, "stale-session\n");
    fs.writeFileSync(path.join(profileDir, ".wardsen-session"), "legacy-session\n");
    const provider = new BitwardenCredentialProvider({
      profileRoot,
      runCommand: async () => ok()
    });

    try {
      provider.createTerminalSessionHandoffCommand("acct-1", {}, {
        claimUrl: "http://127.0.0.1:4777/api/accounts/acct-1/terminal-handoff/claim",
        token: "one-time-token"
      });
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

    await expect(provider.unlock("acct-1", {})).rejects.toThrow("WardSen will update the account automatically");
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

  it("uses the macOS NPM user-prefix Bitwarden CLI path when it exists", async () => {
    const previousHome = process.env.HOME;
    const previousExecutable = process.env.WARDSEN_BITWARDEN_CLI_PATH;
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "wardsen-npm-prefix-"));
    const executable = path.join(home, ".local", "bin", "bw");
    const calls: CliCommandInput[] = [];
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, "placeholder");
    process.env.HOME = home;
    delete process.env.WARDSEN_BITWARDEN_CLI_PATH;

    try {
      const provider = new BitwardenCredentialProvider({
        profileRoot: "profiles",
        runCommand: async (input) => {
          calls.push(input);
          return ok(JSON.stringify({ status: "locked" }));
        }
      });

      await provider.testConnection("acct-1");

      expect(calls.at(-1)?.executable).toBe(executable);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      if (previousExecutable === undefined) delete process.env.WARDSEN_BITWARDEN_CLI_PATH;
      else process.env.WARDSEN_BITWARDEN_CLI_PATH = previousExecutable;
      fs.rmSync(home, { recursive: true, force: true });
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
