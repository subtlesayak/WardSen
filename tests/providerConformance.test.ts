import { describe, expect, it } from "vitest";
import {
  builtInProviderManifests,
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
      accessCount: true
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
