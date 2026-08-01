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
    expect(help.guidance).toContain("Install the missing provider CLI");
    expect(help.guidance).toContain("PATH");
  });

  it("keeps unknown errors visible with generic recovery guidance", () => {
    const help = describeError("Provider command exited with code 1.");

    expect(help.title).toBe("WardSen could not complete that action");
    expect(help.detail).toBe("Provider command exited with code 1.");
    expect(help.guidance).toContain("retry");
  });
});
