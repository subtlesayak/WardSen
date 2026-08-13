import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { OnetimeSecretDeliveryProvider, PasswordPusherDeliveryProvider, YopassDeliveryProvider } from "@wardsen/delivery-external";

const passwordPusherLive = process.env.WARDSEN_PASSWORD_PUSHER_LIVE_TEST === "true";
const onetimeSecretLive = process.env.WARDSEN_ONETIME_SECRET_LIVE_TEST === "true";
const yopassLive = process.env.WARDSEN_YOPASS_LIVE_TEST === "true" && process.env.WARDSEN_YOPASS_LIVE_TEST_ALLOW_CREATE === "true";

describe.skipIf(!passwordPusherLive)("Password Pusher live contract", () => {
  it("creates, reads and expires a disposable one-access link", async () => {
    const provider = new PasswordPusherDeliveryProvider();
    let deliveryId: string | undefined;
    try {
      const created = await provider.createDelivery(liveInput());
      deliveryId = created.deliveryId;
      expect(created.url).toMatch(/^https:\/\//);
      expect(created.status).toBe("active");
      expect(created.viewLimit).toBe(1);
      const status = await provider.getStatus("live-contract", deliveryId);
      expect(["active", "viewed", "limit_reached", "expired"]).toContain(status.status);
    } finally {
      if (deliveryId) await provider.revoke("live-contract", deliveryId);
    }
  }, 30_000);
});

describe.skipIf(!onetimeSecretLive)("Onetime Secret live contract", () => {
  it("creates, reads and burns a disposable one-time receipt", async () => {
    const provider = new OnetimeSecretDeliveryProvider();
    let deliveryId: string | undefined;
    try {
      const created = await provider.createDelivery({
        ...liveInput(),
        accessPassword: `live-passphrase-${randomUUID()}`
      });
      deliveryId = created.deliveryId;
      expect(created.url).toMatch(/^https:\/\//);
      expect(created.status).toBe("active");
      expect(created.viewLimit).toBe(1);
      const status = await provider.getStatus("live-contract", deliveryId);
      expect(["active", "viewed", "expired", "revoked"]).toContain(status.status);
    } finally {
      if (deliveryId) await provider.revoke("live-contract", deliveryId);
    }
  }, 30_000);
});

describe.skipIf(!yopassLive)("Yopass live contract", () => {
  it("creates a disposable one-time link only after explicit creation acknowledgement", async () => {
    const provider = new YopassDeliveryProvider();
    const created = await provider.createDelivery(liveInput());
    expect(created.url).toMatch(/^https:\/\//);
    expect(created.deliveryId).toMatch(/^yopass-/);
    expect(created.status).toBe("active");
    expect(created.viewLimit).toBe(1);
  }, 30_000);
});

function liveInput() {
  return {
    operationId: `live-contract-${randomUUID()}`,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    viewOnce: true,
    sourceCredential: {
      title: "WardSen disposable delivery contract test",
      username: "live-contract",
      password: `disposable-${randomUUID()}`,
      urls: [],
      notes: "This test payload contains no production credential material."
    }
  };
}
