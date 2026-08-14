import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountSessionManager } from "@wardsen/core";
import type {
  ConnectionResult,
  CreateDeliveryInput,
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
  SensitiveCredential
} from "@wardsen/core";
import { SqliteWardSenRepository } from "@wardsen/database";
import { buildApp } from "../apps/server/src/app";

describe("generated secret canary non-persistence", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) rmSync(tempDir, { recursive: true, force: true });
  });

  it("keeps a provider-echoed canary out of SQLite, API responses, audit output and diagnostics", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "wardsen-canary-"));
    tempDirs.push(tempDir);
    const canary = `WARD-SEN-CANARY-${randomUUID()}`;
    const repository = new SqliteWardSenRepository(path.join(tempDir, "wardsen.sqlite"));
    const sessions = new AccountSessionManager();
    const source = new CanaryCredentialProvider(canary);
    const delivery = new CanaryDeliveryProvider();
    const app = await buildApp({
      repository,
      sessions,
      registerBuiltInProviders: false,
      credentialProviders: [source],
      deliveryProviders: [delivery]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };

    try {
      await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: source.id, label: "Canary source" } });
      await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: source.id, label: "Canary delivery account" } });
      sessions.markUnlocked("source", source.id, "source-session");
      sessions.markUnlocked("delivery", source.id, "delivery-session");

      const created = await app.inject({
        method: "POST",
        url: "/api/deliveries",
        headers,
        payload: canaryDeliveryPayload("canary-success", source.id, delivery.id)
      });
      expect(created.statusCode).toBe(200);
      expect(created.body).not.toContain(canary);

      delivery.echoCanaryInError = true;
      const failed = await app.inject({
        method: "POST",
        url: "/api/deliveries",
        headers,
        payload: canaryDeliveryPayload("canary-failure", source.id, delivery.id)
      });
      expect(failed.statusCode).toBe(400);
      expect(failed.body).not.toContain(canary);
      expect(failed.body).toContain("[REDACTED]");

      const [deliveries, audit, diagnostics] = await Promise.all([
        app.inject({ method: "GET", url: "/api/deliveries?page=1&pageSize=100", headers: { host: "127.0.0.1:4777" } }),
        app.inject({ method: "GET", url: "/api/audit-log?page=1&pageSize=100", headers: { host: "127.0.0.1:4777" } }),
        app.inject({ method: "GET", url: `/api/provider-diagnostics/${delivery.id}`, headers: { host: "127.0.0.1:4777" } })
      ]);
      for (const response of [deliveries, audit, diagnostics]) expect(response.body).not.toContain(canary);
    } finally {
      await app.close();
      repository.close();
    }

    for (const artifact of readdirSync(tempDir)) {
      expect(readFileSync(path.join(tempDir, artifact)).toString("utf8")).not.toContain(canary);
    }
  });
});

function canaryDeliveryPayload(operationId: string, sourceProviderId: string, deliveryProviderId: string) {
  return {
    operationId,
    sourceProviderId,
    sourceAccountId: "source",
    sourceItemId: "canary-item",
    deliveryProviderId,
    deliveryAccountId: "delivery",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  };
}

class CanaryCredentialProvider implements CredentialProvider {
  readonly id = "canary-source";
  readonly displayName = "Canary Source";

  constructor(private readonly canary: string) {}

  async getCapabilities(): Promise<CredentialProviderCapabilities> {
    return { searchItems: true, multipleAccounts: true, customServers: false, localVaults: false, synchronization: false, locking: true };
  }
  async testConnection(_accountId: string): Promise<ConnectionResult> { return { ok: true, status: "unlocked" }; }
  async login(_accountId: string, _input: ProviderLoginInput): Promise<void> {}
  async unlock(_accountId: string, _input: ProviderUnlockInput): Promise<void> {}
  async lock(_accountId: string): Promise<void> {}
  async logout(_accountId: string): Promise<void> {}
  async sync(_accountId: string): Promise<void> {}
  async search(accountId: string, _query: string, _pagination: PaginationInput): Promise<CredentialSummary[]> {
    return [{ id: "canary-item", accountId, providerId: this.id, title: "Canary credential", itemType: "login" }];
  }
  async getCredential(_accountId: string, _itemId: string): Promise<SensitiveCredential> {
    return { title: "Canary credential", username: "canary-user", password: this.canary, notes: this.canary, urls: [] };
  }
}

class CanaryDeliveryProvider implements DeliveryProvider {
  readonly id = "canary-delivery";
  readonly displayName = "Canary Delivery";
  echoCanaryInError = false;

  async getCapabilities(): Promise<DeliveryProviderCapabilities> {
    return { externalLinks: true, recipientEmailRestriction: false, arbitraryViewLimit: true, viewOnce: false, customExpiry: true, accessPassword: false, hideText: false, revokeLink: true, accessCount: true, statusLookup: true };
  }
  async testConnection(_accountId: string): Promise<ConnectionResult> { return { ok: true, status: "unlocked" }; }
  async createDelivery(input: CreateDeliveryInput): Promise<DeliveryResult> {
    if (this.echoCanaryInError) throw new Error(`Provider rejected ${input.sourceCredential.password}`);
    return { deliveryId: "canary-provider-delivery", url: "https://delivery.invalid/canary", expiresAt: input.expiresAt };
  }
  async revoke(_accountId: string, _deliveryId: string): Promise<void> {}
  async getStatus(_accountId: string, deliveryId: string): Promise<DeliveryStatus> { return { deliveryId, status: "active" }; }
}
