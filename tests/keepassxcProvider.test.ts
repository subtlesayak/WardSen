import { describe, expect, it } from "vitest";
import type { CliCommandInput, CliCommandResult } from "@wardsen/security";
import { KeePassXCCredentialProvider } from "@wardsen/provider-keepassxc";

function ok(stdout = ""): CliCommandResult {
  return { exitCode: 0, stdout, stderr: "", durationMs: 1 };
}

describe("KeePassXC credential provider", () => {
  it("unlocks a local database with password and key-file arguments", async () => {
    const calls: CliCommandInput[] = [];
    const provider = new KeePassXCCredentialProvider({
      runCommand: async (input) => {
        calls.push(input);
        return ok("Database: Ops");
      }
    });

    await provider.unlock("acct-1", {
      databasePath: "D:\\vaults\\ops.kdbx",
      keyFilePath: "D:\\vaults\\ops.key",
      password: "database-password"
    });

    expect(calls[0].args).toEqual(["db-info", "--key-file", "D:\\vaults\\ops.key", "D:\\vaults\\ops.kdbx"]);
    expect(calls[0].stdin).toBe("database-password");
    expect(calls[0].redact).toContain("database-password");
    await expect(provider.testConnection("acct-1")).resolves.toEqual({ ok: true, status: "unlocked" });
  });

  it("searches unlocked databases and paginates entry paths", async () => {
    const provider = new KeePassXCCredentialProvider({
      runCommand: async (input) => {
        if (input.args[0] === "search") return ok("Internet/Email\nInternet/Admin\n");
        return ok();
      }
    });
    await provider.unlock("acct-1", { databasePath: "ops.kdbx", password: "database-password" });

    const results = await provider.search("acct-1", "Internet", { page: 2, pageSize: 1 });

    expect(results).toEqual([
      {
        id: "Internet/Admin",
        accountId: "acct-1",
        providerId: "keepassxc",
        title: "Admin",
        itemType: "login"
      }
    ]);
  });

  it("extracts protected fields, multiple URLs, notes, and TOTP from show output", async () => {
    const provider = new KeePassXCCredentialProvider({
      runCommand: async (input) => {
        if (input.args[0] === "show") {
          return ok(
            [
              "Title: Admin Portal",
              "UserName: sayak",
              "Password: super-secret",
              "URLs: https://admin.example.test, https://backup.example.test",
              "Notes: rotate quarterly",
              "TOTP: 123456"
            ].join("\n")
          );
        }
        return ok();
      }
    });
    await provider.unlock("acct-1", { databasePath: "ops.kdbx", password: "database-password" });

    await expect(provider.getCredential("acct-1", "Internet/Admin")).resolves.toEqual({
      title: "Admin Portal",
      username: "sayak",
      password: "super-secret",
      urls: ["https://admin.example.test", "https://backup.example.test"],
      notes: "rotate quarterly",
      totp: "123456"
    });
  });

  it("requires unlock before reading a database", async () => {
    const provider = new KeePassXCCredentialProvider({ runCommand: async () => ok() });

    await expect(provider.search("acct-1", "anything", { page: 1, pageSize: 10 })).rejects.toThrow("KeePassXC account is locked");
  });
});
