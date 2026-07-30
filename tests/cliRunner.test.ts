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

  it("redacts safe error messages with explicit secrets", () => {
    const message = safeErrorMessage(new Error("failed password=hunter2 session=token-1 raw-token"), ["raw-token"]);
    expect(message).toBe("failed password=[REDACTED] session=[REDACTED] [REDACTED]");
  });
});
