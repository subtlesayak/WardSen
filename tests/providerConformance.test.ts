import { describe, expect, it } from "vitest";
import {
  builtInProviderManifests,
  verifyProviderManifestCatalog,
  verifyCredentialProviderConformance,
  verifyDeliveryProviderConformance
} from "@wardsen/core";
import type {
  ConnectionResult,
  CredentialProvider,
  CredentialProviderCapabilities,
  CredentialSummary,
  DeliveryProvider,
  DeliveryProviderCapabilities,
  DeliveryResult,
  DeliveryStatus,
  PaginationInput,
  ProviderLoginInput,
  ProviderUnlockInput,
  SensitiveCredential,
  CreateDeliveryInput
} from "@wardsen/core";

describe("provider conformance", () => {
  it("passes active credential providers with matching manifests", async () => {
    const manifest = builtInProviderManifests.find((item) => item.id === "bitwarden");
    expect(manifest).toBeTruthy();

    const report = await verifyCredentialProviderConformance(new ConformantCredentialProvider(), manifest!);

    expect(report).toEqual({ providerId: "bitwarden", kind: "credential", passed: true, failures: [] });
  });

  it("fails planned providers so scaffolds cannot be promoted silently", async () => {
    const manifest = builtInProviderManifests.find((item) => item.id === "onepassword");
    expect(manifest).toBeTruthy();

    const report = await verifyCredentialProviderConformance(new PlannedCredentialProvider(), manifest!);

    expect(report.passed).toBe(false);
    expect(report.failures).toEqual(expect.arrayContaining([
      "Provider onepassword cannot be registered as functional while maturity is planned",
      "Provider onepassword cannot be registered as functional while disabled by default"
    ]));
  });

  it("passes active delivery providers with matching manifests", async () => {
    const manifest = builtInProviderManifests.find((item) => item.id === "bitwarden-send");
    expect(manifest).toBeTruthy();

    const report = await verifyDeliveryProviderConformance(new ConformantDeliveryProvider(), manifest!);

    expect(report).toEqual({ providerId: "bitwarden-send", kind: "delivery", passed: true, failures: [] });
  });

  it("keeps secure-link candidates planned and disabled until they have a safe integration path", () => {
    for (const providerId of ["password-pusher", "yopass", "onetime-secret", "onepassword-item-share"]) {
      const manifest = builtInProviderManifests.find((item) => item.id === providerId);
      expect(manifest).toMatchObject({
        id: providerId,
        kind: "delivery",
        maturity: "planned",
        enabledByDefault: false,
        delivery: expect.objectContaining({
          secureLinkCreation: "unknown",
          viewerIdentity: "unknown"
        })
      });
      expect(manifest?.delivery?.promotionBlockedBy.length).toBeGreaterThan(0);
    }
  });

  it("enables Ente Paste only as an experimental manual handoff provider", () => {
    const manifest = builtInProviderManifests.find((item) => item.id === "ente-paste");

    expect(manifest).toMatchObject({
      maturity: "experimental",
      enabledByDefault: true,
      documentationUrl: "https://paste.ente.com/",
      delivery: {
        integrationSurface: "web_only",
        secureLinkCreation: "manual",
        revoke: "unsupported",
        statusLookup: "unsupported",
        accessCount: "unsupported",
        viewerIdentity: "unsupported",
        promotionBlockedBy: expect.arrayContaining(["official API or CLI contract", "operator confirmation of browser-side one-time paste creation"])
      }
    });
  });

  it("passes Ente Paste conformance as an experimental manual delivery provider", async () => {
    const manifest = builtInProviderManifests.find((item) => item.id === "ente-paste");
    expect(manifest).toBeTruthy();

    const report = await verifyDeliveryProviderConformance(new ManualEnteDeliveryProvider(), manifest!);

    expect(report).toEqual({ providerId: "ente-paste", kind: "delivery", passed: true, failures: [] });
  });

  it("validates the provider manifest catalog before provider expansion", () => {
    const report = verifyProviderManifestCatalog(builtInProviderManifests);

    expect(report).toEqual({ providerId: "provider-catalog", kind: "delivery", passed: true, failures: [] });
  });

  it("requires active delivery providers to declare supported lifecycle metadata", async () => {
    const manifest = builtInProviderManifests.find((item) => item.id === "bitwarden-send");
    expect(manifest).toBeTruthy();

    const report = await verifyDeliveryProviderConformance(new ConformantDeliveryProvider(), {
      ...manifest!,
      delivery: { ...manifest!.delivery!, revoke: "unknown" }
    });

    expect(report.passed).toBe(false);
    expect(report.failures).toContain("Delivery readiness revoke must be supported when the capability is enabled");
  });
});

class ConformantCredentialProvider implements CredentialProvider {
  readonly id: string = "bitwarden";
  readonly displayName: string = "Bitwarden";
  async getCapabilities(): Promise<CredentialProviderCapabilities> {
    return { searchItems: true, multipleAccounts: true, customServers: true, localVaults: false, synchronization: true, locking: true };
  }
  async testConnection(_accountId: string): Promise<ConnectionResult> {
    return { ok: true, status: "unlocked" };
  }
  async login(_accountId: string, _input: ProviderLoginInput): Promise<void> {}
  async unlock(_accountId: string, _input: ProviderUnlockInput): Promise<void> {}
  async lock(_accountId: string): Promise<void> {}
  async logout(_accountId: string): Promise<void> {}
  async sync(_accountId: string): Promise<void> {}
  async search(_accountId: string, _query: string, _pagination: PaginationInput): Promise<CredentialSummary[]> {
    return [];
  }
  async getCredential(_accountId: string, _itemId: string): Promise<SensitiveCredential> {
    return { title: "Example", urls: [] };
  }
}

class PlannedCredentialProvider extends ConformantCredentialProvider {
  readonly id = "onepassword";
  readonly displayName = "1Password";
}

class ConformantDeliveryProvider implements DeliveryProvider {
  readonly id: string = "bitwarden-send";
  readonly displayName: string = "Bitwarden Send";
  async getCapabilities(): Promise<DeliveryProviderCapabilities> {
    return {
      externalLinks: true,
      recipientEmailRestriction: false,
      arbitraryViewLimit: true,
      viewOnce: false,
      customExpiry: true,
      accessPassword: true,
      hideText: true,
      revokeLink: true,
      accessCount: true,
      statusLookup: true
    };
  }
  async testConnection(_accountId: string): Promise<ConnectionResult> {
    return { ok: true, status: "unlocked" };
  }
  async createDelivery(input: CreateDeliveryInput): Promise<DeliveryResult> {
    return { deliveryId: "send-1", url: "https://send.example.test/1", expiresAt: input.expiresAt };
  }
  async revoke(_accountId: string, _deliveryId: string): Promise<void> {}
  async getStatus(_accountId: string, deliveryId: string): Promise<DeliveryStatus> {
    return { deliveryId, status: "active" };
  }
}

class ManualEnteDeliveryProvider extends ConformantDeliveryProvider {
  readonly id = "ente-paste";
  readonly displayName = "Ente Paste (experimental manual)";
  async getCapabilities(): Promise<DeliveryProviderCapabilities> {
    return {
      externalLinks: true,
      recipientEmailRestriction: false,
      arbitraryViewLimit: false,
      viewOnce: true,
      customExpiry: false,
      accessPassword: false,
      hideText: false,
      revokeLink: false,
      accessCount: false,
      statusLookup: false
    };
  }
  async createDelivery(input: CreateDeliveryInput): Promise<DeliveryResult> {
    return { deliveryId: "ente-manual-1", url: "https://paste.ente.com/", expiresAt: input.expiresAt, viewLimit: 1, status: "handoff_pending" };
  }
  async revoke(_accountId: string, _deliveryId: string): Promise<void> {
    throw new Error("unsupported");
  }
  async getStatus(_accountId: string, deliveryId: string): Promise<DeliveryStatus> {
    return { deliveryId, status: "handoff_pending" };
  }
}
