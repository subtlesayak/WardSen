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

  it("keeps unknown errors visible with generic recovery guidance", () => {
    const help = describeError("Provider command exited with code 1.");

    expect(help.title).toBe("WardSen could not complete that action");
    expect(help.detail).toBe("Provider command exited with code 1.");
    expect(help.guidance).toContain("retry");
  });
});
