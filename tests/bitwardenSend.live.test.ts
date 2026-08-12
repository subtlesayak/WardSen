import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BitwardenSendDeliveryProvider } from "@wardsen/delivery-bitwarden-send";

const liveTestEnabled = process.env.WARDSEN_BITWARDEN_LIVE_TEST === "true";
const liveSessionToken = process.env.WARDSEN_BITWARDEN_LIVE_SESSION;
const liveProfileDirectory = process.env.WARDSEN_BITWARDEN_LIVE_PROFILE_DIR;

if (liveTestEnabled) {
  describe("Bitwarden Send live contract", () => {
    it("creates, reads, and revokes a short-lived disposable Send", async () => {
      if (!liveSessionToken) {
        throw new Error("WARDSEN_BITWARDEN_LIVE_SESSION is required when WARDSEN_BITWARDEN_LIVE_TEST=true.");
      }

      const runId = randomUUID();
      const provider = new BitwardenSendDeliveryProvider({
        executable: process.env.WARDSEN_BITWARDEN_CLI_PATH,
        getSessionToken: () => liveSessionToken,
        profileDirectoryFor: () => liveProfileDirectory
      });
      let deliveryId: string | undefined;

      try {
        await expect(provider.testConnection("live-smoke")).resolves.toMatchObject({ ok: true, status: "unlocked" });

        const created = await provider.createDelivery({
          operationId: `live-smoke-${runId}`,
          deliveryAccountId: "live-smoke",
          expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          viewLimit: 1,
          hideText: true,
          sourceCredential: {
            title: `WardSen disposable live smoke ${runId}`,
            username: "live-smoke",
            password: `WardSen-disposable-${runId}`,
            urls: []
          }
        });
        deliveryId = created.deliveryId;
        expect(created.url).toMatch(/^https:\/\//);

        const status = await provider.getStatus("live-smoke", deliveryId);
        expect(status).toMatchObject({ deliveryId, status: "active", accessCount: 0 });
      } finally {
        if (deliveryId) await provider.revoke("live-smoke", deliveryId);
      }
    }, 90_000);
  });
} else {
  describe.skip("Bitwarden Send live contract", () => {
    it("requires explicit operator opt-in", () => undefined);
  });
}
