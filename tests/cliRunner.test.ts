import { describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCliCommand, safeErrorMessage } from "@wardsen/security";

describe("CLI runner", () => {
  it("handles harmless stderr when exit code is zero", async () => {
    const result = await runCliCommand({
      executable: process.execPath,
      args: ["-e", "console.error('first run notice'); console.log('ok')"]
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("ok");
    expect(result.stderr).toContain("first run notice");
  });

  it("redacts configured secrets", async () => {
    const result = await runCliCommand({
      executable: process.execPath,
      args: ["-e", "console.log('token=abc123')"],
      redact: ["abc123"]
    });
    expect(result.stdout).not.toContain("abc123");
  });

  it("can preserve raw successful stdout while still redacting failed command messages", async () => {
    const result = await runCliCommand({
      executable: process.execPath,
      args: ["-e", "console.log('{\"password\":\"abc123\"}')"],
      redact: ["abc123"],
      rawOutput: true
    });

    expect(result.stdout).toContain("abc123");
    try {
      await runCliCommand({
        executable: process.execPath,
        args: ["-e", "console.error('{\"password\":\"abc123\"}'); process.stdout.write('abc123'); process.exit(2)"],
        redact: ["abc123"],
        rawOutput: true
      });
      throw new Error("expected command to fail");
    } catch (error) {
      expect(error).toMatchObject({
        result: {
          stdout: "[REDACTED]",
          stderr: "{\"password\":\"[REDACTED]\"}"
        }
      });
    }

    await expect(runCliCommand({
      executable: process.execPath,
      args: ["-e", "console.error('{\"password\":\"abc123\"}'); process.exit(2)"],
      redact: ["abc123"],
      rawOutput: true
    })).rejects.toThrow('{"password":"[REDACTED]"}');
  });

  it("passes explicit env without inheriting unrelated parent secrets", async () => {
    process.env.WARDSEN_SECRET_PROBE = "parent-secret";
    try {
      const result = await runCliCommand({
        executable: process.execPath,
        args: ["-e", "console.log(`${process.env.WARDSEN_ALLOWED_TEST ?? 'missing'}:${process.env.WARDSEN_SECRET_PROBE ?? 'not-inherited'}`)"],
        env: { WARDSEN_ALLOWED_TEST: "allowed" }
      });
      expect(result.stdout.trim()).toBe("allowed:not-inherited");
    } finally {
      delete process.env.WARDSEN_SECRET_PROBE;
    }
  });

  it("adds the local service Node runtime to provider PATH", async () => {
    const previousPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const result = await runCliCommand({
        executable: process.execPath,
        args: ["-e", "process.stdout.write(process.env.PATH ?? '')"],
        rawOutput: true
      });

      expect(result.stdout.split(path.delimiter)).toContain(path.dirname(process.execPath));
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  it.runIf(process.platform !== "win32")("runs Node-based provider wrappers when the inherited PATH is empty", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-node-wrapper-"));
    const launcher = path.join(tempDir, "bw");
    const previousPath = process.env.PATH;
    writeFileSync(launcher, "#!/usr/bin/env node\nprocess.stdout.write('wrapper-ready')\n");
    chmodSync(launcher, 0o700);
    process.env.PATH = "";
    try {
      await expect(runCliCommand({ executable: launcher, args: [] })).resolves.toMatchObject({ stdout: "wrapper-ready" });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("turns missing provider executables into actionable errors", async () => {
    await expect(runCliCommand({
      executable: "wardsen-missing-cli-for-test",
      args: ["status"]
    })).rejects.toThrow('Provider command "wardsen-missing-cli-for-test" was not found');
  });

  it("includes safe provider output when a command fails", async () => {
    await expect(runCliCommand({
      executable: process.execPath,
      args: ["-e", "console.error('invalid login'); process.exit(2)"]
    })).rejects.toThrow("invalid login");
  });

  it("explains long-running provider commands instead of hanging indefinitely", async () => {
    await expect(runCliCommand({
      executable: process.execPath,
      args: ["-e", "setTimeout(() => {}, 1000)"],
      timeoutMs: 10
    })).rejects.toThrow("timed out after");
  });

  it("bounds provider output capture", async () => {
    const result = await runCliCommand({
      executable: process.execPath,
      args: ["-e", "process.stdout.write('x'.repeat(2048))"],
      maxOutputBytes: 32
    });

    expect(result.stdout).toContain("[WardSen truncated stdout after 32 bytes]");
    expect(result.stdout.length).toBeLessThan(100);
  });

  it.runIf(process.platform !== "win32")("terminates POSIX child process groups on timeout", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-cli-tree-"));
    const marker = path.join(tempDir, "grandchild-lived.txt");
    const childCode = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "still alive"), 700)`;
    try {
      await expect(runCliCommand({
        executable: process.execPath,
        args: ["-e", `
          const { spawn } = require("node:child_process");
          const childCode = ${JSON.stringify(childCode)};
          spawn(process.execPath, ["-e", childCode], { stdio: "ignore" });
          setTimeout(() => {}, 2000);
        `],
        timeoutMs: 50
      })).rejects.toThrow("timed out after");

      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("redacts safe error messages with explicit secrets", () => {
    const message = safeErrorMessage(new Error("failed password=hunter2 session=token-1 raw-token"), ["raw-token"]);
    expect(message).toBe("failed password=[REDACTED] session=[REDACTED] [REDACTED]");
  });

  it("does not corrupt copyable PowerShell commands while redacting safe errors", () => {
    const message = safeErrorMessage(new Error("Manual same-profile terminal login command: $env:BITWARDENCLI_APPDATA_DIR='profiles/acct'; $bwResult=bw login 'user@example.com' --raw; if ($LASTEXITCODE -eq 0 -and $bwResult) { Set-Content -LiteralPath 'profiles/acct/.wardsen-session' -Value $bwResult.Trim() -NoNewline }; Remove-Item Env:\\BITWARDENCLI_APPDATA_DIR"));
    expect(message).toContain("$bwResult=bw login");
    expect(message).not.toContain("[REDACTED] login");
  });

  it("redacts colon and JSON-style secret fields", () => {
    const message = safeErrorMessage(new Error('Password: hunter2 {"totp":"123456","accessPassword":"send-pass"}'));
    expect(message).toBe('Password: [REDACTED] {"totp":"[REDACTED]","accessPassword":"[REDACTED]"}');
  });

  it("redacts local user paths from safe errors", () => {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return;

    const message = safeErrorMessage(new Error(`EPERM mkdir '${localAppData}\\WardSen\\data\\profiles\\acct\\data.json.lock'`));

    expect(message).toContain("%LOCALAPPDATA%\\WardSen");
    expect(message).not.toContain(localAppData);
  });

  it("removes terminal control noise and repeated Bitwarden prompts", () => {
    const message = safeErrorMessage(new Error("\u001b[37D\u001b[37C\u001b[2K\u001b[G? Master password: [input is hidden]\r\u001b[37D\u001b[37C\u001b[2K\u001b[G? Master password: [input is hidden]\r? New device verification required. Enter OTP sent to login email."));

    expect(message).toContain("Master password: [REDACTED]");
    expect(message).toContain("New device verification required");
    expect(message).not.toContain("\u001b");
    expect(message.match(/Master password/g)?.length).toBe(1);
  });
});
