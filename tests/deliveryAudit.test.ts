import { describe, expect, it } from "vitest";
import { accessEvent, accessLabel, attributionLabel, firstObservedLabel, leakSignal, leakSignalRank } from "../apps/web/src/deliveryAudit";

const baseDelivery = {
  id: "delivery-1",
  credentialName: "Production CMS",
  sourceProviderId: "bitwarden",
  sourceAccountId: "ops",
  sourceItemId: "cms",
  deliveryProviderId: "bitwarden-send",
  deliveryAccountId: "ops",
  createdAt: "2026-08-08T18:40:00.000Z",
  expiresAt: "2026-08-09T18:40:00.000Z",
  personId: "asha",
  status: "viewed" as const,
  accessCount: 1,
  viewLimit: 1,
  firstViewedAt: "2026-08-08T18:42:00.000Z",
  lastCheckedAt: "2026-08-08T18:43:00.000Z"
};

describe("delivery audit signals", () => {
  it("attributes a viewed unique link without claiming the named person viewed it", () => {
    expect(attributionLabel(baseDelivery, () => "Asha")).toBe("Asha's link was viewed");
    expect(accessLabel(baseDelivery)).toBe("1 / 1");
    expect(firstObservedLabel(baseDelivery)).not.toBe("No access observed");
    expect(leakSignal(baseDelivery)).toMatchObject({ label: "Low", level: "low" });
  }, 10_000);

  it("treats unexpected repeat access as a high-priority leak signal", () => {
    const suspicious = { ...baseDelivery, status: "limit_reached" as const, accessCount: 2 };

    expect(leakSignal(suspicious)).toMatchObject({ label: "Unexpected access", level: "high" });
    expect(leakSignalRank(suspicious)).toBeGreaterThan(leakSignalRank(baseDelivery));
  }, 10_000);

  it("does not invent a first-view timestamp for historical records", () => {
    const historical = { ...baseDelivery, firstViewedAt: undefined };

    expect(firstObservedLabel(historical)).toBe("Observed before WardSen recorded first-view time");
  });

  it("models access as an assigned-link signal without device or identity claims", () => {
    expect(accessEvent(baseDelivery)).toEqual({
      deliveryId: "delivery-1",
      recipientId: "asha",
      observedAt: "2026-08-08T18:42:00.000Z",
      accessCount: 1,
      source: "provider",
      confidence: "recipient_link"
    });
    expect(accessEvent({ ...baseDelivery, accessCount: 0, status: "active" })).toBeUndefined();
  });
});
