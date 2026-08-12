import { describe, expect, it } from "vitest";
import { parseBatchDeliveryRevokeResult, parseBulkDeliveryResult, parseCreatedDeliveryRecord, parseDeliveryAccessEvent, parseDeliveryList, parseDeliveryRecord } from "@wardsen/contracts";

const delivery = {
  id: "delivery-1",
  providerDeliveryId: "send-1",
  credentialName: "Server admin",
  personId: "person-1",
  sourceProviderId: "bitwarden",
  sourceAccountId: "vault-1",
  sourceItemId: "item-1",
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

  it("parses delivery audit records with a durable first-view timestamp", () => {
    const parsed = parseDeliveryList({
      items: [{ ...delivery, firstViewedAt: "2026-08-08T18:50:00.000Z" }],
      page: 1,
      pageSize: 50,
      total: 1
    });

    expect(parsed.items[0]?.firstViewedAt).toBe("2026-08-08T18:50:00.000Z");
  });

  it("rejects a malformed individual delivery response before the UI uses it", () => {
    expect(() => parseDeliveryRecord({ ...delivery, accessCount: -1 })).toThrow();
  });

  it("parses batch containment results without exposing delivery URLs", () => {
    const result = parseBatchDeliveryRevokeResult({
      batchId: "batch-1",
      revokedCount: 2,
      inactiveCount: 1,
      failed: [{ deliveryId: "delivery-3", error: "provider unavailable" }]
    });

    expect(result).toMatchObject({ batchId: "batch-1", revokedCount: 2, failed: [{ deliveryId: "delivery-3" }] });
  });

  it("rejects unverified device metadata in viewer attribution events", () => {
    expect(() => parseDeliveryAccessEvent({
      deliveryId: "delivery-1",
      observedAt: "2026-08-08T18:50:00.000Z",
      accessCount: 1,
      source: "provider",
      confidence: "recipient_link",
      ipAddress: "203.0.113.10"
    })).toThrow();
    expect(parseDeliveryAccessEvent({
      deliveryId: "delivery-1",
      observedAt: "2026-08-08T18:50:00.000Z",
      accessCount: 1,
      source: "provider",
      confidence: "provider_verified",
      providerEmail: "asha@example.com"
    }).providerEmail).toBe("asha@example.com");
  });
});
