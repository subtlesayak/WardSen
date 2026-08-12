import { describe, expect, it } from "vitest";
import { assertDeliveryOptionsSupported, assertFutureExpiry, parseViewLimit } from "@wardsen/core";

describe("delivery validation", () => {
  it("accepts blank view limits and rejects unsafe values", () => {
    expect(parseViewLimit("")).toBeUndefined();
    expect(parseViewLimit("5")).toBe(5);
    expect(() => parseViewLimit("0")).toThrow();
    expect(() => parseViewLimit("-1")).toThrow();
    expect(() => parseViewLimit("1.5")).toThrow();
  });

  it("fails unsupported features explicitly", () => {
    expect(() =>
      assertDeliveryOptionsSupported(
        {
          externalLinks: true,
          recipientEmailRestriction: false,
          arbitraryViewLimit: false,
          viewOnce: true,
          customExpiry: true,
          accessPassword: false,
          hideText: false,
          revokeLink: true,
          accessCount: true,
          statusLookup: true
        },
        { viewLimit: 2 }
      )
    ).toThrow(/arbitrary view limits/);
  });

  it("requires future expiry", () => {
    expect(() => assertFutureExpiry(new Date(Date.now() - 1000))).toThrow();
  });
});
