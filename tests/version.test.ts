import { describe, expect, it } from "vitest";
import { formatAppVersion, releaseBuildMetadata } from "../apps/web/src/version";

describe("app version label", () => {
  it("uses the package version when no release tag is provided", () => {
    expect(formatAppVersion("0.1.0", "")).toBe("v0.1.0");
  });

  it("prefers the release tag for packaged installer builds", () => {
    expect(formatAppVersion("0.1.0", "v0.1.0-rc.9")).toBe("v0.1.0-rc.9");
  });

  it("embeds release identity metadata when provided by the build", () => {
    expect(releaseBuildMetadata({
      VITE_WARDSEN_RELEASE_TAG: "v0.1.0",
      VITE_WARDSEN_RELEASE_SHA: "abc123",
      VITE_WARDSEN_BUILD_TIMESTAMP: "2026-08-08T18:42:00Z",
      VITE_WARDSEN_RELEASE_SCHEMA_VERSION: "1"
    }, "0.1.0")).toEqual({
      schemaVersion: 1,
      version: "v0.1.0",
      packageVersion: "0.1.0",
      tag: "v0.1.0",
      sha: "abc123",
      buildTimestamp: "2026-08-08T18:42:00Z"
    });
  });
});
