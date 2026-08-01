import { describe, expect, it } from "vitest";
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

  it("redacts safe error messages with explicit secrets", () => {
    const message = safeErrorMessage(new Error("failed password=hunter2 session=token-1 raw-token"), ["raw-token"]);
    expect(message).toBe("failed password=[REDACTED] session=[REDACTED] [REDACTED]");
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
