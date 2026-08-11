import { describe, expect, it } from "vitest";
import { parseBulkDeliveryResult, parseCreatedDeliveryRecord } from "@wardsen/contracts";

const delivery = {
  id: "delivery-1",
  providerDeliveryId: "send-1",
  credentialName: "Server admin",
  personId: "person-1",
  sourceProviderId: "bitwarden",
  sourceAccountId: "vault-1",
  deliveryProviderId: "bitwarden-send",
  deliveryAccountId: "send-account-1",
  batchId: "batch-1",
  deliveryMethod: "email",
  createdAt: "2026-08-08T18:42:00.000Z",
  expiresAt: "2026-08-09T18:42:00.000Z",
  viewLimit: 1,
  accessCount: 0,
  status: "active",
  oneTimeDeliveryUrl: "https://send.bitwarden.com/#example"
};

describe("shared API contracts", () => {
  it("parses bulk delivery results with per-recipient handoff links", () => {
    const parsed = parseBulkDeliveryResult({
      batchId: "batch-1",
      requestedCount: 1,
      completedCount: 1,
      failedCount: 0,
      results: [{ recipientId: "person-1", ok: true, delivery }]
    });

    expect(parsed.results[0]?.delivery?.oneTimeDeliveryUrl).toBe("https://send.bitwarden.com/#example");
  });

  it("rejects bulk delivery results that omit the results array", () => {
    expect(() => parseBulkDeliveryResult({
      batchId: "batch-1",
      requestedCount: 1,
      completedCount: 1,
      failedCount: 0
    })).toThrow();
  });

  it("rejects created deliveries without a one-time handoff URL", () => {
    const { oneTimeDeliveryUrl: _oneTimeDeliveryUrl, ...missingUrl } = delivery;

    expect(() => parseCreatedDeliveryRecord(missingUrl)).toThrow();
  });
});
