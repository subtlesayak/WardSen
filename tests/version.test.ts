import { describe, expect, it } from "vitest";
import { formatAppVersion, releaseBuildMetadata } from "../apps/web/src/version";

describe("app version label", () => {
  it("uses the package version when no release tag is provided", () => {
    expect(formatAppVersion("0.11.4", "")).toBe("v0.11.4");
  });

  it("prefers the release tag for packaged installer builds", () => {
    expect(formatAppVersion("0.11.4", "v0.12.0-rc.1")).toBe("v0.12.0-rc.1");
  });

  it("embeds release identity metadata when provided by the build", () => {
    expect(releaseBuildMetadata({
      VITE_WARDSEN_RELEASE_TAG: "v0.11.4",
      VITE_WARDSEN_RELEASE_SHA: "abc123",
      VITE_WARDSEN_BUILD_TIMESTAMP: "2026-08-08T18:42:00Z",
      VITE_WARDSEN_RELEASE_SCHEMA_VERSION: "1"
    }, "0.11.4")).toEqual({
      schemaVersion: 1,
      version: "v0.11.4",
      packageVersion: "0.11.4",
      tag: "v0.11.4",
      sha: "abc123",
      buildTimestamp: "2026-08-08T18:42:00Z"
    });
  });
});
