import { describe, expect, it } from "vitest";
import { formatAppVersion } from "../apps/web/src/version";

describe("app version label", () => {
  it("uses the package version when no release tag is provided", () => {
    expect(formatAppVersion("0.1.0", "")).toBe("v0.1.0");
  });

  it("prefers the release tag for packaged installer builds", () => {
    expect(formatAppVersion("0.1.0", "v0.1.0-rc.9")).toBe("v0.1.0-rc.9");
  });
});
