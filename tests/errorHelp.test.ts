import { describe, expect, it } from "vitest";
import { describeError } from "../apps/web/src/errorHelp";

describe("web error help", () => {
  it("turns cross-origin failures into actionable help", () => {
    const help = describeError("Cross-origin request blocked: received Origin http://evil.example.test.");

    expect(help.title).toBe("WardSen blocked a cross-origin request");
    expect(help.detail).toContain("http://evil.example.test");
    expect(help.guidance).toContain("local app URL");
    expect(help.guidance).toContain("rejected");
  });

  it("tells desktop users to restart the local service when fetch fails", () => {
    const help = describeError("Could not connect to WardSen local service at http://127.0.0.1:4777/api/providers. Browser detail: Failed to fetch");

    expect(help.title).toBe("WardSen could not reach the local service");
    expect(help.detail).toContain("Failed to fetch");
    expect(help.guidance).toContain("Restart service and retry");
    expect(help.guidance).toContain("close and reopen WardSen");
  });

  it("explains when a provider CLI is missing", () => {
    const help = describeError('Provider command "bw" was not found. Install the Bitwarden CLI, then close and reopen WardSen so the desktop app can see the updated PATH.');

    expect(help.title).toBe("WardSen could not find a provider tool");
    expect(help.detail).toContain('"bw"');
    expect(help.guidance).toContain("local tools folder");
    expect(help.guidance).toContain("PATH");
    expect(help.actionLabel).toBe("Open Bitwarden CLI install guide");
    expect(help.actionHref).toBe("https://bitwarden.com/help/cli/");
    expect(help.setupNotes?.join("\n")).toContain("%LOCALAPPDATA%\\WardSen\\tools");
    expect(help.setupNotes?.join("\n")).toContain("Windows x64");
    expect(help.setupNotes?.join("\n")).toContain("macOS Apple Silicon");
    expect(help.setupNotes?.join("\n")).toContain("bw --version");
    expect(help.terminalCommands?.map((item) => item.command)).toContain("npm install -g @bitwarden/cli");
    expect(help.terminalCommands?.map((item) => item.command)).toContain("choco install bitwarden-cli");
    expect(help.terminalCommands?.map((item) => item.command)).not.toContain("brew install bitwarden-cli");
  });

  it("explains when KeePassXC CLI is missing", () => {
    const help = describeError('Provider command "keepassxc-cli" was not found.');

    expect(help.title).toBe("WardSen could not find a provider tool");
    expect(help.detail).toContain('"keepassxc-cli"');
    expect(help.guidance).toContain("No terminal is required");
    expect(help.actionLabel).toBe("Open KeePassXC download");
    expect(help.actionHref).toBe("https://keepassxc.org/download/");
    expect(help.terminalCommands?.map((item) => item.command)).toContain("winget install KeePassXCTeam.KeePassXC");
    expect(help.terminalCommands?.map((item) => item.command)).toContain("brew install --cask keepassxc");
  });

  it("explains provider command timeouts", () => {
    const help = describeError('Provider command "bw login" timed out after 45 seconds.');

    expect(help.title).toBe("Provider login took too long");
    expect(help.guidance).toContain("SSO");
    expect(help.guidance).toContain("does not sign in this WardSen vault account");
  });

  it("preserves provider command failure detail", () => {
    const help = describeError('Provider command "bw login" failed. Detail: Username or password is incorrect.');

    expect(help.title).toBe("Provider tool reported an error");
    expect(help.detail).toContain("Username or password is incorrect");
    expect(help.guidance).toContain("Login first");
  });

  it("explains Bitwarden local profile lock failures", () => {
    const help = describeError("Provider command \"bw status\" failed. Detail: EPERM mkdir '%LOCALAPPDATA%\\WardSen\\data\\profiles\\acct\\data.json.lock'");

    expect(help.title).toBe("Bitwarden CLI could not write its local profile");
    expect(help.guidance).toContain("folder permissions");
    expect(help.guidance).toContain("data.json.lock");
  });

  it("keeps unknown errors visible with generic recovery guidance", () => {
    const help = describeError("Provider command exited with code 1.");

    expect(help.title).toBe("WardSen could not complete that action");
    expect(help.detail).toBe("Provider command exited with code 1.");
    expect(help.guidance).toContain("retry");
  });
});
